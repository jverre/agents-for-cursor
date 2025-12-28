#!/bin/bash

# Simple test script to patch Cursor with a console.log

set -e

CURSOR_APP="/Applications/Cursor.app"
WORKBENCH_JS="$CURSOR_APP/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.js"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "🔍 Checking if Cursor is installed..."
if [ ! -d "$CURSOR_APP" ]; then
    echo "❌ Cursor not found at $CURSOR_APP"
    exit 1
fi

echo "✅ Found Cursor at $CURSOR_APP"

echo "📦 Creating backup directory..."
mkdir -p "$BACKUP_DIR"

echo "💾 Backing up original workbench.js..."
cp "$WORKBENCH_JS" "$BACKUP_DIR/workbench_${TIMESTAMP}.js"
echo "✅ Backup saved to $BACKUP_DIR/workbench_${TIMESTAMP}.js"

echo "🔧 Patching workbench.js with console.log..."

# Create a temporary file with our console.log at the beginning
cat > /tmp/cursor_patch_header.js << 'EOF'
console.log("🎉 CURSOR PATCHED SUCCESSFULLY! This message proves the patching process works.");
EOF

# Prepend our console.log to the original file
cat /tmp/cursor_patch_header.js "$WORKBENCH_JS" > /tmp/cursor_patched_workbench.js

# Replace the original file
cp /tmp/cursor_patched_workbench.js "$WORKBENCH_JS"

# Clean up temp files
rm /tmp/cursor_patch_header.js /tmp/cursor_patched_workbench.js

echo "✅ Patching complete!"
echo ""
echo "📝 To test:"
echo "  1. Close Cursor if it's running"
echo "  2. Open Cursor"
echo "  3. Open DevTools (Cmd+Option+I or Help > Toggle Developer Tools)"
echo "  4. Check the Console tab for the message: '🎉 CURSOR PATCHED SUCCESSFULLY!'"
echo ""
echo "🔄 To restore the original:"
echo "  cp $BACKUP_DIR/workbench_${TIMESTAMP}.js $WORKBENCH_JS"
echo ""
