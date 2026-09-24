'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Default Kiro CLI sessions directory.
const DEFAULT_DIR = path.join(os.homedir(), '.kiro', 'sessions', 'cli');

let configPath = null; // set by init()
let config = null;

function defaults() {
  return {
    sessionDirs: [DEFAULT_DIR],
    defaultMode: 'ai',      // 'ai' | 'keyword'
    defaultScope: 'user',   // 'user' | 'all'
    terminal: 'auto'        // 'auto' or an explicit command
  };
}

function init(userDataDir) {
  configPath = path.join(userDataDir, 'preferences.json');
  load();
  return config;
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = Object.assign(defaults(), raw);
    if (!Array.isArray(config.sessionDirs) || config.sessionDirs.length === 0) {
      config.sessionDirs = [DEFAULT_DIR];
    }
  } catch (e) {
    config = defaults();
    save();
  }
  return config;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

function get() { return config || defaults(); }

function update(patch) {
  config = Object.assign(get(), patch || {});
  if (!Array.isArray(config.sessionDirs) || config.sessionDirs.length === 0) {
    config.sessionDirs = [DEFAULT_DIR];
  }
  // Normalize + de-dupe directories.
  config.sessionDirs = Array.from(new Set(config.sessionDirs.map((d) => String(d).trim()).filter(Boolean)));
  save();
  return config;
}

// Validate a directory: exists + how many session .json files it holds.
function inspectDir(dir) {
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return { dir, exists: false, isDir: false, sessionCount: 0 };
    const count = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
    return { dir, exists: true, isDir: true, sessionCount: count };
  } catch (e) {
    return { dir, exists: false, isDir: false, sessionCount: 0 };
  }
}

module.exports = { init, load, save, get, update, inspectDir, DEFAULT_DIR };
