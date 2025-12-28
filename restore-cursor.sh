#!/bin/bash

# Script to restore Cursor from backup

set -e

CURSOR_APP="/Applications/Cursor.app"
WORKBENCH_JS="$CURSOR_APP/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.js"
BACKUP_DIR="./backups"

echo "🔍 Looking for backups..."

if [ ! -d "$BACKUP_DIR" ]; then
    echo "❌ No backup directory found"
    exit 1
fi

# Find the most recent backup
LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/workbench_*.js 2>/dev/null | head -1)

if [ -z "$LATEST_BACKUP" ]; then
    echo "❌ No backup files found in $BACKUP_DIR"
    exit 1
fi

echo "📦 Found latest backup: $(basename $LATEST_BACKUP)"
echo "🔄 Restoring workbench.js..."

cp "$LATEST_BACKUP" "$WORKBENCH_JS"

echo "✅ Cursor restored from backup!"
echo ""
echo "📝 You can now restart Cursor to see the original version."
echo ""
