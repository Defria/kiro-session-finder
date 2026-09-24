'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(os.homedir(), '.kiro', 'session-finder-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'embeddings-v3.json');
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MODELS_DIR = path.join(CACHE_DIR, 'models');
const CHUNK_LEN = 256; // shorter than before (was 400) -> faster embedding

let extractorPromise = null;
let cache = null;            // { [chunkKey]: { hash, vector: number[] } }
let globalVecCache = null;   // { [textHash]: number[] } dedupe identical chunks across sessions

function ensureCacheDir() { try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {} }

function loadCache() {
  if (cache) return cache;
  ensureCacheDir();
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    cache = parsed.byKey || {};
    globalVecCache = parsed.byHash || {};
  } catch (e) {
    cache = {};
    globalVecCache = {};
  }
  return cache;
}

let saveTimer = null;
function saveCacheSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCacheNow, 400);
}
function saveCacheNow() {
  try {
    ensureCacheDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ byKey: cache, byHash: globalVecCache }));
  } catch (e) { /* ignore */ }
}

function hashText(text) { return crypto.createHash('sha1').update(text).digest('hex'); }

async function getExtractor(onStatus) {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowRemoteModels = true;
    env.cacheDir = MODELS_DIR;
    // Let the WASM backend use all available cores.
    try { env.backends.onnx.wasm.numThreads = Math.max(1, os.cpus().length); } catch (e) {}
    if (onStatus) onStatus('Loading AI model (first run downloads ~23MB)...');
    const extractor = await pipeline('feature-extraction', MODEL_ID, {
      progress_callback: (p) => {
        if (onStatus && p && p.status === 'progress' && p.file && typeof p.progress === 'number') {
          onStatus('Downloading ' + p.file + ' (' + p.progress.toFixed(0) + '%)');
        }
      }
    });
    if (onStatus) onStatus('AI model ready.');
    return extractor;
  })();
  return extractorPromise;
}

async function embedOne(extractor, text) {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

function cosine(a, b) {
  let s = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function chunksFor(doc) {
  const chunks = [];
  if (doc.title) chunks.push(doc.title.slice(0, CHUNK_LEN));
  const prompts = doc.userPrompts || [];
  for (const p of prompts) {
    const t = p.replace(/\s+/g, ' ').trim();
    if (t) chunks.push(t.slice(0, CHUNK_LEN));
  }
  return Array.from(new Set(chunks)).slice(0, 200);
}

function isModelCached() {
  try { return fs.existsSync(MODELS_DIR) && fs.readdirSync(MODELS_DIR).length > 0; }
  catch (e) { return false; }
}

// Batched embedding on the main thread. onProgress(done,total).
async function embedMany(extractor, texts, onProgress) {
  const total = texts.length;
  const vectors = new Array(total);
  const BATCH = 96;
  let done = 0;
  for (let i = 0; i < total; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const out = await extractor(slice, { pooling: 'mean', normalize: true });
    const d = out.dims[1];
    for (let j = 0; j < slice.length; j++) {
      vectors[i + j] = Array.from(out.data.subarray(j * d, (j + 1) * d));
    }
    done += slice.length;
    if (onProgress) onProgress(done, total);
  }
  return vectors;
}

/**
 * Build/refresh the embedding index for the given docs (embeds only misses).
 * Safe to call in the background (e.g. at startup). Returns { indexed }.
 */
async function buildIndex(docs, { onStatus, onProgress } = {}) {
  const c = loadCache();
  const extractor = await getExtractor(onStatus);

  const missTexts = [];
  const missRefs = []; // { key, hash }
  const seenHash = new Set();

  for (const doc of docs) {
    const chunks = chunksFor(doc);
    for (let i = 0; i < chunks.length; i++) {
      const key = doc.sessionId + ':' + i;
      const h = hashText(chunks[i]);
      const hit = c[key];
      if (hit && hit.hash === h) continue;               // per-key cached
      if (globalVecCache[h]) { c[key] = { hash: h }; continue; } // dedup: same text embedded elsewhere
      if (seenHash.has(h)) { missRefs.push({ key, hash: h, dup: true }); continue; }
      seenHash.add(h);
      missTexts.push(chunks[i]);
      missRefs.push({ key, hash: h });
    }
  }

  if (missTexts.length) {
    if (onStatus) onStatus('Indexing ' + missTexts.length + ' new items...');
    const vecs = await embedMany(extractor, missTexts, onProgress);
    // Map unique-text vectors back into the global hash cache.
    let vi = 0;
    for (const ref of missRefs) {
      if (ref.dup) continue;
      globalVecCache[ref.hash] = vecs[vi++];
    }
    for (const ref of missRefs) {
      c[ref.key] = { hash: ref.hash };
    }
    saveCacheNow();
  }
  return { indexed: missTexts.length };
}

/**
 * Rank sessions by best-matching chunk similarity to the query.
 */
async function semanticRank(query, docs, { onStatus, onProgress, minScore = 0.25, topK = 60 } = {}) {
  const c = loadCache();
  const extractor = await getExtractor(onStatus);
  const qvec = await embedOne(extractor, query);

  // Ensure everything is indexed (embeds only missing chunks).
  await buildIndex(docs, { onStatus, onProgress });

  const scored = [];
  for (const doc of docs) {
    const chunks = chunksFor(doc);
    let best = -1, bestIdx = -1;
    for (let i = 0; i < chunks.length; i++) {
      const h = hashText(chunks[i]);
      const v = globalVecCache[h];
      if (!v) continue;
      const s = cosine(qvec, v);
      if (s > best) { best = s; bestIdx = i; }
    }
    if (best >= minScore) {
      scored.push(Object.assign({}, doc, {
        score: best,
        bestChunk: bestIdx >= 0 ? chunks[bestIdx] : ''
      }));
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

function cacheInfo() {
  loadCache();
  return { entries: Object.keys(globalVecCache || {}).length, modelCached: isModelCached() };
}

function clearEmbeddings() {
  loadCache();
  const removed = Object.keys(globalVecCache || {}).length;
  cache = {};
  globalVecCache = {};
  saveCacheNow();
  return removed;
}

module.exports = {
  semanticRank, buildIndex, getExtractor, isModelCached, cacheInfo, clearEmbeddings,
  MODEL_ID, CACHE_DIR
};
