#!/usr/bin/env bash
# Generates a desktop launcher for the current install location and
# installs it to the user's applications folder.
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$DIR/Kiro Session Finder.desktop.template"
LOCAL="$DIR/Kiro Session Finder.desktop"
TARGET="$HOME/.local/share/applications/kiro-session-finder.desktop"

if [ ! -f "$TEMPLATE" ]; then
  echo "Template not found: $TEMPLATE" >&2
  exit 1
fi

# Substitute the placeholder with the real install directory.
sed "s|__APP_DIR__|$DIR|g" "$TEMPLATE" > "$LOCAL"
chmod +x "$LOCAL" 2>/dev/null || true

mkdir -p "$(dirname "$TARGET")"
cp "$LOCAL" "$TARGET"
chmod +x "$TARGET" 2>/dev/null || true

echo "Desktop launcher installed:"
echo "  $TARGET"
echo "You may need to log out/in or refresh your app menu to see it."
