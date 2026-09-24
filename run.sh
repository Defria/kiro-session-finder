#!/usr/bin/env bash
# Launcher for Kiro Session Finder.
# On first run it installs Electron locally, then starts the app.
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ ! -d "node_modules/electron" ]; then
  echo "First run: installing Electron (this may take a minute)..."
  npm install
fi

exec npm start
