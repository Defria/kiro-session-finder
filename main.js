'use strict';

const { app, BrowserWindow, ipcMain, clipboard, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ai = require('./ai');
const config = require('./config');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0a0b10',
    title: 'Kiro Session Finder',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  config.init(app.getPath('userData'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- Session parsing ----------

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return null; }
}

function contentToText(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const item of content) {
    if (item && item.kind === 'text' && typeof item.data === 'string') parts.push(item.data);
  }
  return parts.join('\n');
}

function readLog(jsonlPath) {
  const userPrompts = [];
  const allTextChunks = [];
  let raw;
  try { raw = fs.readFileSync(jsonlPath, 'utf8'); }
  catch (e) { return { userPrompts, allText: '' }; }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let d;
    try { d = JSON.parse(t); } catch (e) { continue; }
    if (d.kind === 'Prompt' && d.data) {
      const text = contentToText(d.data.content);
      if (text) { userPrompts.push(text); allTextChunks.push(text); }
    } else if (d.kind === 'AssistantMessage' && d.data) {
      const text = contentToText(d.data.content || d.data);
      if (text) allTextChunks.push(text);
    }
  }
  return { userPrompts, allText: allTextChunks.join('\n') };
}

// Load all sessions from every configured directory.
function loadSessions(scope) {
  const dirs = config.get().sessionDirs || [];
  const docs = [];
  const errors = [];
  const seen = new Set();

  for (const dir of dirs) {
    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch (e) {
      errors.push(dir + ' (' + e.code + ')');
      continue;
    }
    for (const jsonFile of files) {
      const jsonPath = path.join(dir, jsonFile);
      const meta = readJsonSafe(jsonPath) || {};
      const sessionId = meta.session_id || path.basename(jsonFile, '.json');
      if (seen.has(sessionId)) continue; // avoid dupes across dirs
      seen.add(sessionId);
      const jsonlPath = path.join(dir, sessionId + '.jsonl');
      const { userPrompts, allText } = readLog(jsonlPath);
      const body = scope === 'all' ? allText : userPrompts.join('\n');
      const title = meta.title || '';
      docs.push({
        id: sessionId + '::' + scope,
        sessionId,
        sourceDir: dir,
        jsonPath,
        jsonlPath,
        cwd: meta.cwd || '',
        title,
        createdAt: meta.created_at || '',
        updatedAt: meta.updated_at || '',
        body,
        text: (title ? title + '\n' : '') + body,
        userPrompts
      });
    }
  }

  // Only a hard error if EVERY directory failed.
  let error = null;
  if (docs.length === 0 && errors.length && errors.length === dirs.length) {
    error = 'Could not read any session directory: ' + errors.join(', ');
  }
  return { error, docs, errors };
}

function makeSnippet(text, term, radius) {
  radius = radius || 90;
  if (!text) return '';
  if (!term) return text.slice(0, radius * 2).replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const idx = lower.indexOf(term.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) s = '... ' + s;
  if (end < text.length) s = s + ' ...';
  return s;
}

function bestLine(userPrompts, query) {
  if (!userPrompts || !userPrompts.length) return '';
  const qWords = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  let best = userPrompts[0], bestScore = -1;
  for (const p of userPrompts) {
    const pl = p.toLowerCase();
    let score = 0;
    for (const w of qWords) if (pl.includes(w)) score++;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function shellQuote(s) {
  if (s === '') return "''";
  if (/^[A-Za-z0-9_\/.:@%+=-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function buildCommand(cwd, sessionId) {
  const cwdPart = cwd ? 'cd ' + shellQuote(cwd) + ' && ' : '';
  return cwdPart + 'kiro-cli chat --trust-all-tools --resume-id ' + sessionId;
}

function toResult(doc, extra) {
  return Object.assign({
    sessionId: doc.sessionId,
    cwd: doc.cwd,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    jsonPath: doc.jsonPath,
    jsonlPath: doc.jsonlPath,
    sourceDir: doc.sourceDir,
    command: buildCommand(doc.cwd, doc.sessionId)
  }, extra);
}

// ---------- Search IPC ----------

ipcMain.handle('keyword-search', async (event, opts) => {
  const term = (opts && opts.term ? String(opts.term) : '').trim();
  const scope = (opts && opts.scope) || 'user';
  const result = { ok: true, term, matches: [], scanned: 0, error: null, warnings: [], mode: 'keyword' };
  if (!term) { result.ok = false; result.error = 'Please enter a search term.'; return result; }

  const { error, docs, errors } = loadSessions(scope);
  if (error) { result.ok = false; result.error = error; return result; }
  result.warnings = errors;
  result.scanned = docs.length;
  const termLower = term.toLowerCase();

  for (const doc of docs) {
    const inBody = doc.body.toLowerCase().includes(termLower);
    const inTitle = doc.title.toLowerCase().includes(termLower);
    if (!inBody && !inTitle) continue;
    let count = 0;
    if (inBody) {
      const hl = doc.body.toLowerCase();
      let from = 0;
      while (true) { const i = hl.indexOf(termLower, from); if (i === -1) break; count++; from = i + termLower.length; }
    }
    result.matches.push(toResult(doc, {
      matchCount: count,
      matchedIn: inTitle && !inBody ? 'title' : (inTitle ? 'title+body' : 'body'),
      snippet: makeSnippet(inBody ? doc.body : doc.title, term)
    }));
  }
  result.matches.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return result;
});

ipcMain.handle('ai-search', async (event, opts) => {
  const term = (opts && opts.term ? String(opts.term) : '').trim();
  const scope = (opts && opts.scope) || 'user';
  const result = { ok: true, term, matches: [], scanned: 0, error: null, warnings: [], mode: 'ai' };
  if (!term) { result.ok = false; result.error = 'Please enter a search term.'; return result; }

  const { error, docs, errors } = loadSessions(scope);
  if (error) { result.ok = false; result.error = error; return result; }
  result.warnings = errors;
  const usable = docs.filter((d) => (d.text || '').trim().length > 0);
  result.scanned = usable.length;

  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };

  try {
    const ranked = await ai.semanticRank(term, usable, {
      minScore: 0.3,
      topK: 40,
      onStatus: (msg) => send('ai-status', { msg }),
      onProgress: (done, total) => send('ai-progress', { done, total })
    });
    for (const doc of ranked) {
      result.matches.push(toResult(doc, {
        score: doc.score,
        snippet: (doc.bestChunk || bestLine(doc.userPrompts, term) || makeSnippet(doc.body, '')).slice(0, 240)
      }));
    }
  } catch (e) {
    result.ok = false;
    result.error = 'AI search failed: ' + (e && e.message ? e.message : String(e));
  }
  return result;
});

ipcMain.handle('model-status', async () => ({ cached: ai.isModelCached(), model: ai.MODEL_ID }));

// Pre-load (warm up) the embedding model in the background so the first
// AI search is instant. Streams status via 'ai-status' and finishes with
// 'warm-done'. Safe to call repeatedly; getExtractor caches the promise.
let warming = false;
ipcMain.handle('warm-model', async () => {
  if (warming) return { ok: true, already: true };
  warming = true;
  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
  try {
    await ai.getExtractor((msg) => send('ai-status', { msg, warmup: true }));
    send('warm-done', { ok: true });

    // Then build the embedding index in the background so the first real
    // search hits the fast warm path. Uses the default scope ('user').
    try {
      const { docs } = loadSessions('user');
      const usable = docs.filter((d) => (d.text || '').trim().length > 0);
      send('index-status', { state: 'start', total: usable.length });
      const res = await ai.buildIndex(usable, {
        onStatus: (msg) => send('ai-status', { msg, warmup: true }),
        onProgress: (done, total) => send('index-progress', { done, total })
      });
      send('index-status', { state: 'done', indexed: res.indexed });
    } catch (e) {
      send('index-status', { state: 'error', error: e && e.message ? e.message : String(e) });
    }
    return { ok: true };
  } catch (e) {
    send('warm-done', { ok: false, error: e && e.message ? e.message : String(e) });
    return { ok: false, error: e && e.message ? e.message : String(e) };
  } finally {
    warming = false;
  }
});

ipcMain.handle('cache-info', async () => ai.cacheInfo());

ipcMain.handle('clear-cache', async () => {
  const removed = ai.clearEmbeddings();
  return { ok: true, removed };
});

// ---------- Actions IPC ----------

ipcMain.handle('copy-command', async (event, { cwd, sessionId }) => {
  const cmd = buildCommand(cwd, sessionId);
  clipboard.writeText(cmd);
  return cmd;
});

// Reveal the session .json file in the OS file manager.
ipcMain.handle('reveal-file', async (event, { filePath }) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return { ok: true };
  }
  return { ok: false, error: 'File not found: ' + filePath };
});

// Launch a terminal that runs the resume command.
ipcMain.handle('launch-terminal', async (event, { cwd, sessionId }) => {
  const cmd = buildCommand(cwd, sessionId);
  // Keep the shell open after the command so the session is interactive.
  const bashLine = cmd + '; exec bash';
  const pref = (config.get().terminal || 'auto');

  const candidates = [];
  if (pref && pref !== 'auto') {
    candidates.push({ bin: pref, args: ['--', 'bash', '-lc', bashLine] });
  }
  candidates.push(
    { bin: 'gnome-terminal', args: ['--', 'bash', '-lc', bashLine] },
    { bin: 'konsole', args: ['-e', 'bash', '-lc', bashLine] },
    { bin: 'xfce4-terminal', args: ['-e', 'bash -lc ' + JSON.stringify(bashLine)] },
    { bin: 'tilix', args: ['-e', 'bash', '-lc', bashLine] },
    { bin: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', bashLine] },
    { bin: 'xterm', args: ['-e', 'bash', '-lc', bashLine] }
  );

  for (const c of candidates) {
    try {
      const child = spawn(c.bin, c.args, { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, terminal: c.bin };
    } catch (e) {
      // try next
    }
  }
  return { ok: false, error: 'No supported terminal found. Command copied instead.', command: cmd };
});

// ---------- Preferences IPC ----------

ipcMain.handle('get-prefs', async () => {
  const cfg = config.get();
  return {
    prefs: cfg,
    dirInfo: (cfg.sessionDirs || []).map((d) => config.inspectDir(d)),
    defaultDir: config.DEFAULT_DIR
  };
});

ipcMain.handle('set-prefs', async (event, patch) => {
  const cfg = config.update(patch || {});
  return {
    prefs: cfg,
    dirInfo: (cfg.sessionDirs || []).map((d) => config.inspectDir(d))
  };
});

ipcMain.handle('pick-directory', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a Kiro sessions directory',
    properties: ['openDirectory']
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  const dir = res.filePaths[0];
  return { canceled: false, dir, info: config.inspectDir(dir) };
});

ipcMain.handle('open-dir', async () => {
  const dirs = config.get().sessionDirs || [];
  if (dirs[0]) shell.openPath(dirs[0]);
  return true;
});
