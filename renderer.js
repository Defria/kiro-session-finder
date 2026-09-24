'use strict';

const termEl = document.getElementById('term');
const searchBtn = document.getElementById('searchBtn');
const btnLabel = searchBtn.querySelector('.btn-label');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const toastEl = document.getElementById('toast');
const openDirBtn = document.getElementById('openDir');
const modeToggle = document.getElementById('modeToggle');
const modeSlider = document.getElementById('modeSlider');
const modeBtns = Array.from(modeToggle.querySelectorAll('.mode-btn'));
const modelPill = document.getElementById('modelPill');
const modelLabel = document.getElementById('modelLabel');
const progressWrap = document.getElementById('progressWrap');
const progressStatus = document.getElementById('progressStatus');
const progressFill = document.getElementById('progressFill');
const hintEl = document.getElementById('hint');

const SCOPE_ITEMS = [
  { value: 'user', label: 'Your prompts' },
  { value: 'all', label: 'Whole chat' }
];
const MODE_ITEMS = [
  { value: 'ai', label: 'AI (semantic)' },
  { value: 'keyword', label: 'Keyword' }
];

// Search-bar scope select (shadcn-style).
const scopeSel = createSelect({
  items: SCOPE_ITEMS,
  value: 'user',
  ariaLabel: 'Search scope',
  onChange: () => { if (termEl.value.trim()) doSearch(); }
});
document.getElementById('scopeSelect').appendChild(scopeSel.el);

let mode = 'ai';

// ---------- helpers ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function highlight(text, term) {
  const safe = esc(text);
  if (!term) return safe;
  const re = new RegExp(esc(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return safe.replace(re, (m) => '<mark>' + m + '</mark>');
}
function fmtDate(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ---------- mode toggle ----------
function positionSlider() {
  const active = modeToggle.querySelector('.mode-btn.active');
  if (!active) return;
  modeSlider.style.width = active.offsetWidth + 'px';
  modeSlider.style.transform = 'translateX(' + (active.offsetLeft - 4) + 'px)';
}
modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    modeBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    mode = btn.dataset.mode;
    positionSlider();
    hintEl.textContent = mode === 'ai'
      ? 'AI mode: search by meaning, e.g. "deployment speed" finds "how long does deploy take"'
      : 'Keyword mode: exact text match.';
    if (termEl.value.trim()) doSearch();
  });
});
window.addEventListener('resize', positionSlider);
setTimeout(positionSlider, 60);

// ---------- Init overlay controller ----------
const initOverlay = document.getElementById('initOverlay');
const initPct = document.getElementById('initPct');
const initTitle = document.getElementById('initTitle');
const initSub = document.getElementById('initSub');
const initRing = document.querySelector('.init-ring');
const ringProgress = document.querySelector('.ring-progress');
const RING_CIRC = 326.7; // 2*pi*52
const stepEls = {
  model: document.querySelector('.init-step[data-step="model"]'),
  index: document.querySelector('.init-step[data-step="index"]')
};
let initDismissed = false;

function setRing(pct) {
  // pct 0..100; null => indeterminate spinner
  if (pct == null) {
    initRing.classList.add('spin');
    initPct.textContent = '';
  } else {
    initRing.classList.remove('spin');
    const clamped = Math.max(0, Math.min(100, pct));
    ringProgress.style.strokeDashoffset = String(RING_CIRC * (1 - clamped / 100));
    initPct.textContent = Math.round(clamped) + '%';
  }
}
function setInitStep(name, state) {
  const el = stepEls[name];
  if (!el) return;
  el.classList.remove('active', 'complete');
  if (state) el.classList.add(state);
}
function setInitText(title, sub) {
  if (title != null) initTitle.textContent = title;
  if (sub != null) initSub.textContent = sub;
}
function dismissInit() {
  if (initDismissed) return;
  initDismissed = true;
  setRing(100);
  setInitStep('model', 'complete');
  setInitStep('index', 'complete');
  setInitText('Ready', 'Search your chat history');
  setTimeout(() => initOverlay.classList.add('done'), 450);
}

// If everything is already cached, the phases fly by; show a brief spinner.
setRing(null);
setInitStep('model', 'active');
setInitText('Getting ready…', 'Preparing the AI engine');

// Safety net: never leave the user staring at a stuck overlay. If no
// completion event arrives in time, dismiss so the app is usable.
setTimeout(() => { if (!initDismissed) dismissInit(); }, 180000);

// ---------- model status ----------
let modelReady = false;

async function refreshModelStatus() {
  try {
    const s = await window.kiro.modelStatus();
    if (s.cached) {
      modelReady = true;
      modelPill.classList.remove('loading');
      modelPill.classList.add('ready');
      modelLabel.textContent = 'AI ready';
    } else if (!modelReady) {
      modelLabel.textContent = 'AI (preparing...)';
    }
    modelPill.title = s.model;
  } catch (e) { /* ignore */ }
}
refreshModelStatus();

// Pre-fetch the model in the background right away, since AI is the default
// mode and we will use it anyway. Keeps the first search instant.
function warmUpModel() {
  modelPill.classList.remove('ready');
  modelPill.classList.add('loading');
  modelLabel.textContent = 'AI warming up...';
  window.kiro.warmModel().catch(() => {});
}
warmUpModel();

window.kiro.onWarmDone((d) => {
  modelPill.classList.remove('loading');
  if (d && d.ok) {
    modelReady = true;
    modelPill.classList.add('ready');
    modelLabel.textContent = 'AI ready';
    progressStatus.textContent = '';
    // Model phase complete -> move to indexing phase in the overlay.
    setInitStep('model', 'complete');
    setInitStep('index', 'active');
    setInitText('Indexing your sessions', 'Building the semantic search index');
    setRing(null); // indeterminate until index-progress arrives
  } else {
    modelLabel.textContent = 'AI (will load on search)';
    // Could not load (e.g. offline). Let the user in anyway.
    setInitText('Ready', 'AI will load on your first search');
    dismissInit();
  }
});

// Background indexing status (runs after warm-up).
window.kiro.onIndexStatus((d) => {
  if (!d) return;
  if (d.state === 'start') {
    modelPill.classList.add('loading');
    modelLabel.textContent = 'Indexing...';
    setInitStep('model', 'complete');
    setInitStep('index', 'active');
    if (d.total) {
      setRing(0);
      setInitText('Indexing your sessions', 'Preparing ' + d.total + ' sessions');
    } else {
      setRing(null);
    }
  } else if (d.state === 'done') {
    modelPill.classList.remove('loading');
    modelPill.classList.add('ready');
    modelReady = true;
    modelLabel.textContent = 'AI ready';
    dismissInit();
  } else if (d.state === 'error') {
    // Indexing failed; still let the user in (search will index on demand).
    dismissInit();
  }
});
window.kiro.onIndexProgress((d) => {
  const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
  modelLabel.textContent = 'Indexing ' + pct + '%';
  if (!initDismissed) {
    setRing(pct);
    setInitText('Indexing your sessions', d.done + ' of ' + d.total + ' items');
  }
});

window.kiro.onAiStatus((d) => {
  modelPill.classList.remove('ready');
  modelPill.classList.add('loading');
  progressStatus.textContent = d.msg;
  modelLabel.textContent = d.warmup ? 'AI warming up...' : 'AI working...';
  // Reflect model download/loading detail in the overlay while it's up.
  if (!initDismissed && d.warmup) {
    setInitStep('model', 'active');
    // Downloading messages include a % we can surface.
    const m = /\((\d+)%\)/.exec(d.msg || '');
    if (m) { setRing(parseInt(m[1], 10)); setInitText('Downloading AI model', d.msg); }
    else { setRing(null); setInitText('Loading AI model', d.msg || 'Preparing the AI engine'); }
  }
});
window.kiro.onAiProgress((d) => {
  const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
  progressFill.style.width = pct + '%';
  progressStatus.textContent = 'Analyzing sessions ' + d.done + ' / ' + d.total + ' (' + pct + '%)';
});

// ---------- render ----------
function scorePct(score) {
  // cosine typically 0..0.8 for good matches; scale for display
  return Math.max(4, Math.min(100, Math.round((score / 0.8) * 100)));
}

function render(data, term) {
  resultsEl.innerHTML = '';
  if (!data.ok) {
    statusEl.textContent = data.error || 'Search failed.';
    statusEl.classList.add('error');
    return;
  }
  statusEl.classList.remove('error');

  const n = data.matches.length;
  const modeName = data.mode === 'ai' ? 'AI semantic' : 'keyword';
  statusEl.textContent = n === 0
    ? 'No ' + modeName + ' matches in ' + data.scanned + ' sessions.'
    : n + ' match' + (n === 1 ? '' : 'es') + ' (' + modeName + ', scanned ' + data.scanned + ').';

  if (n === 0) {
    resultsEl.innerHTML =
      '<div class="empty"><div class="big">◇</div><div>Nothing matched "' + esc(term) + '".</div>' +
      '<div style="margin-top:6px;font-size:12px;">' +
      (data.mode === 'ai' ? 'Try different wording or switch scope to "Whole chat".'
                          : 'Try AI mode for meaning-based search.') +
      '</div></div>';
    return;
  }

  data.matches.forEach((m, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.animationDelay = Math.min(i * 40, 400) + 'ms';

    const rightBadge = (data.mode === 'ai' && typeof m.score === 'number')
      ? '<div class="score">' +
          '<div class="score-label">' + (m.score * 100).toFixed(0) + '% match</div>' +
          '<div class="score-meter"><div class="score-bar" style="width:' + scorePct(m.score) + '%"></div></div>' +
        '</div>'
      : '<div class="badge">' + (m.matchCount > 0 ? m.matchCount + ' hit' + (m.matchCount === 1 ? '' : 's') : (m.matchedIn || 'match')) + '</div>';

    card.innerHTML =
      '<div class="card-head">' +
        '<div class="card-title">' +
          (m.title ? highlight(m.title, data.mode === 'keyword' ? term : '') : '<span class="muted">(untitled session)</span>') +
        '</div>' + rightBadge +
      '</div>' +
      '<div class="meta-row">' +
        '<span><span class="k">dir:</span> <code>' + esc(m.cwd || '(none)') + '</code></span>' +
        '<span><span class="k">updated:</span> ' + esc(fmtDate(m.updatedAt)) + '</span>' +
        '<span><span class="k">id:</span> <code>' + esc(m.sessionId) + '</code></span>' +
      '</div>' +
      (m.snippet ? '<div class="snippet">' + highlight(m.snippet, data.mode === 'keyword' ? term : '') + '</div>' : '') +
      '<div class="cmd-row">' +
        '<div class="cmd">' + esc(m.command) + '</div>' +
      '</div>' +
      '<div class="action-row">' +
        '<button class="act-btn copy-btn">Copy command</button>' +
        '<button class="act-btn term-btn">Open in terminal</button>' +
        '<button class="act-btn reveal-btn">Reveal file</button>' +
      '</div>';

    const btn = card.querySelector('.copy-btn');
    btn.addEventListener('click', async () => {
      await window.kiro.copyCommand({ cwd: m.cwd, sessionId: m.sessionId });
      btn.textContent = 'Copied';
      btn.classList.add('copied');
      showToast('Command copied to clipboard');
      setTimeout(() => { btn.textContent = 'Copy command'; btn.classList.remove('copied'); }, 1500);
    });

    const termBtn = card.querySelector('.term-btn');
    termBtn.addEventListener('click', async () => {
      const res = await window.kiro.launchTerminal({ cwd: m.cwd, sessionId: m.sessionId });
      if (res && res.ok) {
        showToast('Launched in ' + res.terminal);
      } else {
        // Fallback: command was copied by main; inform the user.
        await window.kiro.copyCommand({ cwd: m.cwd, sessionId: m.sessionId });
        showToast((res && res.error) ? res.error : 'Could not open terminal; command copied.');
      }
    });

    const revealBtn = card.querySelector('.reveal-btn');
    revealBtn.addEventListener('click', async () => {
      const res = await window.kiro.revealFile({ filePath: m.jsonPath });
      if (!(res && res.ok)) showToast((res && res.error) ? res.error : 'Could not reveal file.');
    });

    resultsEl.appendChild(card);
  });
}

// ---------- search ----------
async function doSearch() {
  const term = termEl.value.trim();
  if (!term) { statusEl.textContent = 'Enter a search term.'; return; }

  statusEl.classList.remove('error');
  searchBtn.disabled = true;
  btnLabel.innerHTML = '<span class="spinner"></span>';
  resultsEl.innerHTML = '';

  const isAi = mode === 'ai';
  if (isAi) {
    progressWrap.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressStatus.textContent = 'Preparing AI model...';
    statusEl.textContent = 'Running semantic search...';
  } else {
    progressWrap.classList.add('hidden');
    statusEl.textContent = 'Searching...';
  }

  try {
    const data = isAi
      ? await window.kiro.aiSearch({ term, scope: scopeSel.getValue() })
      : await window.kiro.keywordSearch({ term, scope: scopeSel.getValue() });
    render(data, term);
    if (isAi) {
      modelPill.classList.remove('loading');
      modelPill.classList.add('ready');
      modelLabel.textContent = 'AI ready';
    }
  } catch (e) {
    statusEl.classList.add('error');
    statusEl.textContent = 'Error: ' + (e && e.message ? e.message : String(e));
  } finally {
    searchBtn.disabled = false;
    btnLabel.textContent = 'Search';
    progressWrap.classList.add('hidden');
  }
}

searchBtn.addEventListener('click', doSearch);
termEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
openDirBtn.addEventListener('click', () => window.kiro.openDir());

// ---------- Preferences ----------
const prefsBtn = document.getElementById('prefsBtn');
const prefsOverlay = document.getElementById('prefsOverlay');
const prefsClose = document.getElementById('prefsClose');
const prefsSave = document.getElementById('prefsSave');
const dirList = document.getElementById('dirList');
const dirInput = document.getElementById('dirInput');
const dirAdd = document.getElementById('dirAdd');
const dirBrowse = document.getElementById('dirBrowse');
const prefTerminal = document.getElementById('prefTerminal');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const cacheInfoEl = document.getElementById('cacheInfo');

// Custom shadcn-style selects in preferences.
const prefModeSel = createSelect({ items: MODE_ITEMS, value: 'ai', ariaLabel: 'Default search mode' });
const prefScopeSel = createSelect({ items: SCOPE_ITEMS, value: 'user', ariaLabel: 'Default scope' });
document.getElementById('prefModeSelect').appendChild(prefModeSel.el);
document.getElementById('prefScopeSelect').appendChild(prefScopeSel.el);

let editingDirs = [];

function renderDirList(dirInfo) {
  dirList.innerHTML = '';
  if (!editingDirs.length) {
    dirList.innerHTML = '<div class="dir-empty">No directories. Add at least one.</div>';
    return;
  }
  editingDirs.forEach((dir, i) => {
    const info = (dirInfo || []).find((d) => d.dir === dir) || {};
    const row = document.createElement('div');
    row.className = 'dir-row';
    const status = info.exists
      ? '<span class="dir-ok">' + (info.sessionCount || 0) + ' sessions</span>'
      : (info.dir ? '<span class="dir-bad">not found</span>' : '');
    row.innerHTML =
      '<div class="dir-path"><code>' + esc(dir) + '</code> ' + status + '</div>' +
      '<button class="dir-remove" title="Remove">✕</button>';
    row.querySelector('.dir-remove').addEventListener('click', () => {
      editingDirs.splice(i, 1);
      renderDirList(dirInfo);
    });
    dirList.appendChild(row);
  });
}

async function refreshCacheInfo() {
  try {
    const info = await window.kiro.cacheInfo();
    cacheInfoEl.textContent = info.entries
      ? info.entries + ' cached embeddings. Clearing forces a fresh re-index on next AI search.'
      : 'No embeddings cached yet. They build automatically on your first AI search.';
  } catch (e) { /* ignore */ }
}

async function openPrefs() {
  const { prefs, dirInfo } = await window.kiro.getPrefs();
  editingDirs = (prefs.sessionDirs || []).slice();
  prefModeSel.setValue(prefs.defaultMode || 'ai');
  prefScopeSel.setValue(prefs.defaultScope || 'user');
  prefTerminal.value = (prefs.terminal && prefs.terminal !== 'auto') ? prefs.terminal : '';
  renderDirList(dirInfo);
  await refreshCacheInfo();
  prefsOverlay.classList.remove('hidden');
}

function closePrefs() {
  prefModeSel.close();
  prefScopeSel.close();
  prefsOverlay.classList.add('hidden');
}

function addDir(dir) {
  const d = (dir || '').trim();
  if (!d) return;
  if (!editingDirs.includes(d)) editingDirs.push(d);
  dirInput.value = '';
  renderDirList();
}

dirAdd.addEventListener('click', () => addDir(dirInput.value));
dirInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addDir(dirInput.value); });
dirBrowse.addEventListener('click', async () => {
  const res = await window.kiro.pickDirectory();
  if (!res.canceled && res.dir) addDir(res.dir);
});

clearCacheBtn.addEventListener('click', async () => {
  const res = await window.kiro.clearCache();
  await refreshCacheInfo();
  await refreshModelStatus();
  showToast(res && res.ok ? 'AI cache cleared (' + res.removed + ' entries)' : 'Could not clear cache');
});

prefsBtn.addEventListener('click', openPrefs);
prefsClose.addEventListener('click', closePrefs);
prefsOverlay.addEventListener('click', (e) => { if (e.target === prefsOverlay) closePrefs(); });

prefsSave.addEventListener('click', async () => {
  const { prefs, dirInfo } = await window.kiro.setPrefs({
    sessionDirs: editingDirs,
    defaultMode: prefModeSel.getValue(),
    defaultScope: prefScopeSel.getValue(),
    terminal: prefTerminal.value.trim() || 'auto'
  });
  renderDirList(dirInfo);
  applyDefaults(prefs);
  showToast('Preferences saved');
  closePrefs();
  await refreshModelStatus();
});

function applyDefaults(prefs) {
  const targetMode = prefs.defaultMode || 'ai';
  const btn = modeBtns.find((b) => b.dataset.mode === targetMode);
  if (btn && !btn.classList.contains('active')) {
    modeBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    mode = targetMode;
    positionSlider();
  }
  scopeSel.setValue(prefs.defaultScope || 'user');
}

// Global keyboard shortcuts: Ctrl+, opens preferences; Escape closes.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    if (prefsOverlay.classList.contains('hidden')) openPrefs(); else closePrefs();
  } else if (e.key === 'Escape' && !prefsOverlay.classList.contains('hidden')) {
    closePrefs();
  }
});

// Load defaults at startup.
window.kiro.getPrefs().then(({ prefs }) => applyDefaults(prefs)).catch(() => {});
