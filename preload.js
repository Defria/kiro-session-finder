'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiro', {
  // search
  keywordSearch: (opts) => ipcRenderer.invoke('keyword-search', opts),
  aiSearch: (opts) => ipcRenderer.invoke('ai-search', opts),
  modelStatus: () => ipcRenderer.invoke('model-status'),
  warmModel: () => ipcRenderer.invoke('warm-model'),
  cacheInfo: () => ipcRenderer.invoke('cache-info'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  // actions
  copyCommand: (payload) => ipcRenderer.invoke('copy-command', payload),
  revealFile: (payload) => ipcRenderer.invoke('reveal-file', payload),
  launchTerminal: (payload) => ipcRenderer.invoke('launch-terminal', payload),
  openDir: () => ipcRenderer.invoke('open-dir'),
  // preferences
  getPrefs: () => ipcRenderer.invoke('get-prefs'),
  setPrefs: (patch) => ipcRenderer.invoke('set-prefs', patch),
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),
  // events
  onAiStatus: (cb) => ipcRenderer.on('ai-status', (e, d) => cb(d)),
  onAiProgress: (cb) => ipcRenderer.on('ai-progress', (e, d) => cb(d)),
  onWarmDone: (cb) => ipcRenderer.on('warm-done', (e, d) => cb(d)),
  onIndexStatus: (cb) => ipcRenderer.on('index-status', (e, d) => cb(d)),
  onIndexProgress: (cb) => ipcRenderer.on('index-progress', (e, d) => cb(d))
});
