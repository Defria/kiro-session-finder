<div align="center">

<img src="assets/icon.png" alt="Kiro Session Finder" width="120" />

# Kiro Session Finder

**AI-powered semantic search for your Kiro CLI chat history.**

Find any past conversation by meaning, not just keywords, then jump straight back into it with one click.

![Platform](https://img.shields.io/badge/platform-Linux-1f6feb)
![Electron](https://img.shields.io/badge/Electron-32-47848F)
![License](https://img.shields.io/badge/license-MIT-3ecf8e)
![AI](https://img.shields.io/badge/AI-local%20%26%20offline-7c5cff)

</div>

---

## Overview

Kiro CLI stores every chat session on disk, but there is no built-in way to search across them by content. If you remember *what* you talked about but not *which* session, you are stuck grepping JSON files.

**Kiro Session Finder** solves that. It indexes your sessions with a small, local Hugging Face embedding model and lets you search semantically. Ask for *"how long does deployment take"* and it finds the session where you typed *"do know how long the deployment take generally in minutes?"* even though the words differ.

Everything runs **locally and offline**. No API keys, no tokens, no data leaves your machine.

## Features

- **AI semantic search** — find sessions by meaning using a local `all-MiniLM-L6-v2` model (~23 MB, downloaded once, then cached).
- **Keyword search** — instant exact-text matching as a fallback.
- **One-click resume** — every result generates a ready-to-run command:
  ```
  cd /path/to/project && kiro-cli chat --trust-all-tools --resume-id <session-id>
  ```
  Copy it, open it directly in a terminal, or reveal the session file in your file manager.
- **Multiple session directories** — point it at any number of Kiro session folders.
- **Fast** — sessions are embedded once at startup in the background; searches then return in tens of milliseconds.
- **Clear startup feedback** — an animated progress ring shows model loading and indexing so it never looks frozen.
- **Polished dark UI** — glassmorphic theme with custom (shadcn-style) dropdowns and result cards with similarity scores.
- **Preferences** — configure session directories, default mode/scope, terminal command, and clear/re-index the AI cache. Open with `Ctrl+,`.

## Screenshots

**Semantic search results** — ranked by meaning, each with a similarity score, a ready-to-run resume command, and quick actions (copy, open in terminal, reveal file).

![Semantic search results](assets/screenshots/search.png)

**Startup** — an animated progress ring shows the model loading and session indexing, so the app never looks frozen.

![Startup indexing overlay](assets/screenshots/startup.png)

**Preferences** — configure session directories, default mode and scope, terminal command, and manage the AI cache.

![Preferences panel](assets/screenshots/preferences.png)

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│  Kiro CLI sessions (~/.kiro/sessions/cli/*.json + *.jsonl)   │
└───────────────────────────────┬─────────────────────────────┘
                                 │  read + parse
                                 ▼
             ┌───────────────────────────────────┐
             │  Chunk each session's prompts      │
             │  (title + user messages)           │
             └───────────────────┬───────────────┘
                                 │  embed (local model)
                                 ▼
             ┌───────────────────────────────────┐
             │  Vector cache (disk + memory)      │  ← built once, incremental
             └───────────────────┬───────────────┘
                                 │  cosine similarity vs query
                                 ▼
             ┌───────────────────────────────────┐
             │  Ranked results + resume commands  │
             └───────────────────────────────────┘
```

- **Embedding model:** [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) via [Transformers.js](https://github.com/xenova/transformers.js), running on the WASM backend.
- **Scoring:** each session is scored by the similarity of its *best-matching chunk* to your query, so a single relevant prompt in a long session still ranks highly.
- **Caching:** embeddings are cached under `~/.kiro/session-finder-cache/` keyed by content hash, with global de-duplication of identical prompts. Only new or changed content is re-embedded.

## Requirements

- **Linux** (x64). The packaged build target is AppImage.
- **Node.js** 18+ (developed on Node 24).
- **npm**.
- Kiro CLI sessions on disk (defaults to `~/.kiro/sessions/cli/`).

## Getting started

```bash
git clone https://github.com/Defria/kiro-session-finder.git
cd kiro-session-finder
npm install
npm start
```

On first launch the app downloads the embedding model (~23 MB) once, then indexes your sessions in the background. Subsequent launches are near-instant.

## Building a distributable

Package the app into a single clickable **AppImage**:

```bash
npm run dist
```

The output is written to `dist/KiroSessionFinder-<version>.AppImage`. It is self-contained — no installation required. Make it executable and run it:

```bash
chmod +x dist/KiroSessionFinder-*.AppImage
./dist/KiroSessionFinder-*.AppImage
```

For a faster unpacked build (useful when debugging packaging):

```bash
npm run dist:dir   # output in dist/linux-unpacked/
```

## Desktop launcher (optional)

To add the app to your application menu when running from source:

```bash
./install-shortcut.sh
```

This generates a `.desktop` entry pointing at your local checkout and installs it to `~/.local/share/applications/`.

## Usage

1. **Type what you remember** about the conversation.
2. Pick **AI** (semantic) or **Keyword** mode.
3. Choose the **scope**: *Your prompts* or *Whole chat*.
4. Press **Enter**.
5. On any result, use **Copy command**, **Open in terminal**, or **Reveal file**.

Open **Preferences** (`Ctrl+,` or the gear icon) to:

- Add or remove Kiro session directories.
- Set the default search mode and scope.
- Set a preferred terminal command (defaults to auto-detect).
- Clear the AI cache and re-index.

## Project structure

| File | Responsibility |
|------|----------------|
| `main.js` | Electron main process: session parsing, search IPC, actions, preferences |
| `preload.js` | Secure context bridge between main and renderer |
| `renderer.js` | UI logic, search dispatch, init overlay, preferences |
| `ai.js` | Embedding model, vector cache, semantic ranking, background indexing |
| `config.js` | Preference persistence (session dirs, defaults, terminal) |
| `select.js` | Reusable shadcn-style custom dropdown component |
| `index.html` / `styles.css` | Markup and dark-theme styling |
| `assets/` | Application icon (SVG source + PNG) |

## Privacy

Kiro Session Finder is **fully local**:

- The embedding model runs on your machine (downloaded once from the Hugging Face Hub).
- Your session content and embeddings never leave your device.
- No telemetry, no external API calls at search time.

## Tech stack

- [Electron](https://www.electronjs.org/) 32
- [Transformers.js](https://github.com/xenova/transformers.js) (`@xenova/transformers` 2.17.2)
- [electron-builder](https://www.electron.build/) 24 (packaging)

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first to discuss the direction.

## License

[MIT](LICENSE) © 2026 Defria
