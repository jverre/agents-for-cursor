# Cursor File Tracking System

## Overview

Cursor implements a comprehensive file tracking system that monitors, persists, and displays information about edited files. The system consists of three main components:

1. **File Change Detection** - Native file watchers and editor event listeners that detect when files are created, modified, or deleted
2. **Edit History Storage** - SQLite database that persists edit history, diffs, and metadata for all conversations
3. **UI Indicators** - Visual decorations in tabs, file trees, and editor gutters that indicate file modification state

This document provides a detailed technical analysis of how each component works, based on reverse-engineering the Cursor application.

---

## File Change Detection

### Primary Technology: @parcel/watcher

Cursor uses **@parcel/watcher** version `2.5.1-cursor` (a custom fork) as its primary file watching infrastructure.

**Location**: `/Applications/Cursor.app/Contents/Resources/app/node_modules/@parcel/watcher`

**Type**: Native C++ Node.js addon (Mach-O universal binary for x86_64 and arm64)

**Repository**: https://github.com/parcel-bundler/watcher

#### Core API

```javascript
// From wrapper.js
exports.subscribe(dir, fn, opts)         // Subscribe to filesystem changes
exports.unsubscribe(dir, fn, opts)       // Unsubscribe from changes
exports.writeSnapshot(dir, snapshot, opts)  // Write filesystem snapshot
exports.getEventsSince(dir, snapshot, opts) // Get changes since snapshot
```

**Features**:
- Native performance using platform-specific APIs (FSEvents on macOS)
- Supports glob patterns for ignore lists via `micromatch`
- Converts JavaScript regex to C++ compatible patterns (no lookbehinds)
- Resolves absolute paths for watched directories

### VSCode FileSystemWatcher API

Cursor inherits VSCode's standard file watching API, defined in TypeScript declarations.

**Location**: `/Applications/Cursor.app/Contents/Resources/app/out/vscode-dts/vscode.d.ts`

#### FileSystemWatcher Interface

```typescript
export interface FileSystemWatcher extends Disposable {
    readonly ignoreCreateEvents: boolean;
    readonly ignoreChangeEvents: boolean;
    readonly ignoreDeleteEvents: boolean;
    readonly onDidCreate: Event<Uri>;
    readonly onDidChange: Event<Uri>;
    readonly onDidDelete: Event<Uri>;
}
```

#### Creating Watchers

```typescript
workspace.createFileSystemWatcher(
    globPattern: GlobPattern,
    ignoreCreateEvents?: boolean,
    ignoreChangeEvents?: boolean,
    ignoreDeleteEvents?: boolean
): FileSystemWatcher
```

### Text Document Change Events

For tracking changes within open text documents, Cursor uses the `TextDocumentChangeEvent` API:

```typescript
export interface TextDocumentChangeEvent {
    readonly document: TextDocument;
    readonly contentChanges: readonly TextDocumentContentChangeEvent[];
    readonly reason?: TextDocumentChangeReason; // Undo=1, Redo=2
}
```

**Event subscription**:
```typescript
workspace.onDidChangeTextDocument: Event<TextDocumentChangeEvent>
```

This event fires when:
- Text content changes
- Document dirty state changes
- Other document metadata changes

### File Change Event Types

Cursor tracks different types of file changes:

```typescript
enum FileChangeType {
    UPDATED = 0,
    ADDED = 1,
    DELETED = 2
}

// Alternative enum used in some contexts
enum FileChangeType2 {
    UPDATED = 2,
    ADDED = 4,
    DELETED = 8
}
```

### Watcher Implementation

**Main implementation**: `/Applications/Cursor.app/Contents/Resources/app/out/vs/platform/files/node/watcher/watcherMain.js` (minified, 46 lines)

**Watcher Modes**:
- **Recursive watchers** - Monitor directories and all subdirectories
- **Non-recursive watchers** - Monitor only direct children
- **Polling watchers** - Fallback for systems without native file watching

**Statistics tracked** (from minified code analysis):
```javascript
// Evidence from watcherMain.js line 32-33
[Recursive Requests (${n.length}, suspended: ${l.suspended}, polling: ${l.polling})]
[Non-Recursive Requests (${h.length}, suspended: ${y.suspended}, polling: ${y.polling})]
```

### FileSystemProvider Interface

Extensions can provide custom file systems via the `FileSystemProvider` interface:

```typescript
export interface FileSystemProvider {
    readonly onDidChangeFile: Event<FileChangeEvent[]>;
    watch(uri: Uri, options: {
        recursive: boolean,
        excludes: string[]
    }): Disposable;
}
```

**Requirements**:
- Must fire `onDidChangeFile` events for watched resources
- Must update `mtime` metadata for proper change detection
- Must respect exclude patterns from `files.watcherExclude` settings

### Event Propagation Pattern

All file change notifications use the **EventEmitter** pattern:

```typescript
export class EventEmitter<T> {
    event: Event<T>;
    fire(data: T): void;  // Notify all subscribers
    dispose(): void;
}
```

---

## Edit History Storage & Persistence

### Primary Storage: SQLite Database

**Location**: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`

Cursor persists all edit history and conversation state in a SQLite database.

### Database Structure

**Tables**:
1. `ItemTable` - General key-value storage
2. `cursorDiskKV` - Cursor-specific data including chat bubbles and edit history

**Schema** (both tables):
```sql
CREATE TABLE cursorDiskKV (
    key TEXT UNIQUE,
    value BLOB
);
```

### Storage Format

#### Key Format

**Bubble entries**:
```
bubbleId:<conversationId>:<bubbleId>
```

**Example**:
```
bubbleId:11aeea53-f279-4700-9eca-2ff166bd86b4:4df925ce-eb28-45ff-8752-2624a0fbeb23
```

**Checkpoint entries**:
```
checkpointId:<conversationId>:<checkpointId>
```

#### Value Format

Values are JSON objects stored as TEXT/BLOB. See the [Cursor Tool Bubble Format](./cursor-tool-bubble-format.md) documentation for complete schema details.

### Edit-Related Fields in Bubbles

Each chat bubble JSON object contains multiple fields tracking edit history:

#### 1. assistantSuggestedDiffs (array)
Stores diffs suggested by the AI assistant during the conversation.

#### 2. diffsSinceLastApply (array)
Tracks diffs that have been suggested but not yet applied by the user. Maintains state between user approvals.

#### 3. diffHistories (array)
Complete chronological history of all diffs in the conversation. This is the primary record of edit evolution.

#### 4. fileDiffTrajectories (array)
Tracks the trajectory/path of edits across multiple files, showing how edits evolved over time.

#### 5. humanChanges (array)
Tracks manual edits made by the user (non-AI). Distinguishes between AI-generated and human modifications.

#### 6. deletedFiles (array)
Records files that have been deleted during the conversation session.

#### 7. editTrailContexts (array)
Context information about the edit trail. Used for understanding the sequence and relationships between edits.

#### 8. recentlyViewedFiles (array)
Tracks files the user has recently viewed. Helps with context management and understanding user intent.

#### 9. recentLocationsHistory (array)
History of cursor/editor locations. Tracks where the user has been navigating in the codebase.

### Example Bubble Structure

```json
{
  "_v": 3,
  "type": 2,
  "bubbleId": "4df925ce-eb28-45ff-8752-2624a0fbeb23",
  "assistantSuggestedDiffs": [],
  "diffHistories": [],
  "fileDiffTrajectories": [],
  "humanChanges": [],
  "deletedFiles": [],
  "editTrailContexts": [],
  "recentlyViewedFiles": [],
  "recentLocationsHistory": [],
  "attachedCodeChunks": [],
  "toolFormerData": {},
  "toolResults": [],
  ...
}
```

### Additional Metadata

Bubbles also store rich metadata about the editing context:

- **attachedCodeChunks** - Code snippets attached to messages
- **attachedFolders** - Folders referenced in the conversation
- **attachedFoldersListDirResults** - Directory listing results
- **suggestedCodeBlocks** - Code blocks suggested by AI
- **userResponsesToSuggestedCodeBlocks** - User approval/rejection of suggestions
- **diffsForCompressingFiles** - Compressed diff format for storage efficiency

### Database Statistics

Example from a production database:
- Contains 1,093 bubble entries
- Individual bubbles can be 90KB+ for complex conversations
- Checkpoint entries are smaller (~142 bytes each)

### Persistence Characteristics

1. **No separate edit history database** - Edit history is embedded within chat bubble JSON objects
2. **Persistent across sessions** - Data stored in SQLite survives application restarts
3. **Per-conversation tracking** - Each conversation (composerId) has isolated edit history
4. **Rich metadata** - Extensive tracking of context, user interactions, and file state
5. **Large data volumes** - Complex conversations generate substantial storage

---

## UI Indicators

Cursor uses multiple visual indicators to show which files have been edited (dirty state).

### Tab Indicators

#### 1. Dirty Border Top

**CSS Class**: `.dirty-border-top`

**Location**: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`

```css
.monaco-workbench .part.editor>.content .editor-group-container>.title
  .tabs-container>.tab.dirty-border-top:not(:focus)>.tab-border-top-container {
  background-color: var(--tab-dirty-border-top-color);
  height: 2px;
  top: 0;
  z-index: 6;
}
```

**Visual effect**: A 2px colored border appears at the top of edited tabs using the CSS variable `--tab-dirty-border-top-color`

#### 2. Filled Circle Icon (Dirty Indicator)

**CSS Class**: `.dirty`

**Icon**: Uses `codicon-circle-filled` (a filled circle icon)

```css
.monaco-workbench .part.editor>.content .editor-group-container.active>.title
  .tabs-container>.tab.dirty>.tab-actions .action-label:not(:hover):before,
.monaco-workbench .part.editor>.content .editor-group-container>.title
  .tabs-container>.tab.dirty>.tab-actions .action-label:not(:hover):before {
  content: var(--vscode-icon-circle-filled-content);
  font-family: var(--vscode-icon-circle-filled-font-family);
}
```

**Visual effect**: When a file is dirty and not being hovered, the close button (X) is replaced with a filled circle icon

#### 3. Pinned Dirty State

**Combined Class**: `.sticky.dirty`

```css
.monaco-workbench .part.editor>.content .editor-group-container.active>.title
  .tabs-container>.tab.sticky.dirty>.tab-actions .action-label:not(:hover):before,
.monaco-workbench .part.editor>.content .editor-group-container>.title
  .tabs-container>.tab.sticky.dirty>.tab-actions .action-label:not(:hover):before {
  content: var(--vscode-icon-pinned-dirty-content);
  font-family: var(--vscode-icon-pinned-dirty-font-family);
}
```

**Visual effect**: Pinned tabs that are dirty show a special "pinned-dirty" icon

### File Tree Decorations

#### Open Editors Panel

**CSS Class**: `.open-editors .monaco-list .monaco-list-row.dirty`

```css
.open-editors .monaco-list .monaco-list-row.dirty:not(:hover)
  >.monaco-action-bar .codicon-close:before {
  content: var(--vscode-icon-circle-filled-content);
  font-family: var(--vscode-icon-circle-filled-font-family);
}
```

**Visual effect**: Files in the Open Editors view show a filled circle icon when dirty

#### Dirty Count Badge

**CSS Class**: `.open-editors-dirty-count-container > .dirty-count`

```css
.pane-header .open-editors-dirty-count-container {
  align-items: center;
  display: flex;
  min-width: fit-content;
}

.pane-header .open-editors-dirty-count-container>.dirty-count.monaco-count-badge {
  margin-left: 6px;
  min-height: auto;
  padding: 2px 4px;
}
```

**Visual effect**: Shows a count badge indicating the number of dirty files in the Open Editors panel header

### Editor Gutter Decorations (Dirty Diff)

Cursor shows line-level change indicators in the editor gutter, comparing current content to the last saved state.

#### Added Lines

**CSS Class**: `.dirty-diff-added`

```css
.monaco-editor .dirty-diff-added {
  border-left-color: var(--vscode-editorGutter-addedBackground);
  border-left-style: solid;
}
```

**Visual effect**: Green vertical bar in the gutter for newly added lines

#### Modified Lines

**CSS Class**: `.dirty-diff-modified`

```css
.monaco-editor .dirty-diff-modified {
  border-left-color: var(--vscode-editorGutter-modifiedBackground);
  border-left-style: solid;
}
```

**Visual effect**: Blue vertical bar in the gutter for modified lines

#### Base Glyph Styling

```css
.monaco-editor .dirty-diff-glyph {
  margin-left: 5px;
  z-index: 5;
}

.monaco-editor .dirty-diff-glyph:before {
  content: "";
  height: 100%;
  left: -2px;
  position: absolute;
  width: 0;
}
```

### SCM/Git Integration

#### Modified File Badge

**Visual**: Blue square with white "M" letter

**Location**: `/Applications/Cursor.app/Contents/Resources/app/extensions/git/resources/icons/status-modified.svg`

**SVG Structure**:
```svg
<svg width="14px" height="14px" viewBox="0 0 100 100">
  <rect fill="#1B80B2" x="0" y="0" width="100" height="100" rx="35" ry="35"/>
  <text x="50" y="75" font-size="75" text-anchor="middle" fill="white">M</text>
</svg>
```

**Available in**: Both light and dark theme variants

### CSS Variables

All UI indicators use theme-aware CSS custom properties:

- `--tab-dirty-border-top-color` - Color for the top border on dirty tabs
- `--vscode-icon-circle-filled-content` - Unicode content for the filled circle icon
- `--vscode-icon-circle-filled-font-family` - Font family for the icon
- `--vscode-icon-pinned-dirty-content` - Icon for pinned dirty tabs
- `--vscode-editorGutter-addedBackground` - Color for added lines in gutter
- `--vscode-editorGutter-modifiedBackground` - Color for modified lines in gutter

These can be customized via VSCode's `workbench.colorCustomizations` settings.

### FileDecorationProvider API

Extensions can provide custom file decorations via the `FileDecorationProvider` API.

**Location**: `/Applications/Cursor.app/Contents/Resources/app/out/vscode-dts/vscode.d.ts` (lines ~8203-8262)

**Key Interfaces**:
- `FileDecoration` - Class representing file decoration metadata (badge, color, tooltip)
- `FileDecorationProvider` - Interface for providing file decorations
- `window.registerFileDecorationProvider()` - Method to register decoration providers

---

## Key Files Reference

### Cursor Application Files

#### Core Infrastructure
- **Main CSS**: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`
- **Main Workbench**: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` (~28MB minified)
- **Extension Host**: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js`

#### File Watching
- **Watcher Main**: `/Applications/Cursor.app/Contents/Resources/app/out/vs/platform/files/node/watcher/watcherMain.js`
- **Parcel Watcher**: `/Applications/Cursor.app/Contents/Resources/app/node_modules/@parcel/watcher/`
  - `index.js` - Entry point
  - `wrapper.js` - Wrapper with ignore pattern support
  - `build/Release/watcher.node` - Native binary (C++ addon)
- **Policy Watcher**: `/Applications/Cursor.app/Contents/Resources/app/node_modules/@anysphere/policy-watcher/`

#### API Definitions
- **VSCode TypeScript Definitions**: `/Applications/Cursor.app/Contents/Resources/app/out/vscode-dts/vscode.d.ts`
- **VSCode DTS Directory**: `/Applications/Cursor.app/Contents/Resources/app/out/vscode-dts/` (additional working directory)

#### Git Extension
- **Status Icons**: `/Applications/Cursor.app/Contents/Resources/app/extensions/git/resources/icons/`
  - `status-modified.svg` (light & dark variants)

### Database & Storage

- **State Database**: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
- **Database Options**: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb.options.json`

### OpenCursor Project

- **Bubble Format Documentation**: `/Users/jacquesverre/Documents/code/opencursor/docs/cursor-tool-bubble-format.md`
- **This Documentation**: `/Users/jacquesverre/Documents/code/opencursor/docs/cursor-file-tracking.md`

---

## Code Examples

### Querying the SQLite Database

#### Count Bubbles
```bash
sqlite3 ~/Library/Application\ Support/Cursor/User/globalStorage/state.vscdb \
  "SELECT COUNT(*) FROM cursorDiskKV WHERE key LIKE 'bubbleId:%';"
```

#### List All Bubble Keys
```bash
sqlite3 ~/Library/Application\ Support/Cursor/User/globalStorage/state.vscdb \
  "SELECT key FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' LIMIT 10;"
```

#### Extract a Bubble's JSON
```bash
sqlite3 ~/Library/Application\ Support/Cursor/User/globalStorage/state.vscdb \
  "SELECT value FROM cursorDiskKV WHERE key = 'bubbleId:<conversationId>:<bubbleId>';" \
  | jq '.'
```

#### Count Checkpoints
```bash
sqlite3 ~/Library/Application\ Support/Cursor/User/globalStorage/state.vscdb \
  "SELECT COUNT(*) FROM cursorDiskKV WHERE key LIKE 'checkpointId:%';"
```

### Creating a File System Watcher

```typescript
import * as vscode from 'vscode';

// Watch all TypeScript files
const watcher = vscode.workspace.createFileSystemWatcher('**/*.ts');

watcher.onDidCreate(uri => {
    console.log(`File created: ${uri.fsPath}`);
});

watcher.onDidChange(uri => {
    console.log(`File changed: ${uri.fsPath}`);
});

watcher.onDidDelete(uri => {
    console.log(`File deleted: ${uri.fsPath}`);
});

// Clean up when done
// watcher.dispose();
```

### Listening to Text Document Changes

```typescript
import * as vscode from 'vscode';

vscode.workspace.onDidChangeTextDocument(event => {
    const doc = event.document;
    console.log(`Document changed: ${doc.fileName}`);
    console.log(`Number of changes: ${event.contentChanges.length}`);

    if (event.reason === vscode.TextDocumentChangeReason.Undo) {
        console.log('Change was an undo operation');
    } else if (event.reason === vscode.TextDocumentChangeReason.Redo) {
        console.log('Change was a redo operation');
    }

    // Check if document is dirty (has unsaved changes)
    if (doc.isDirty) {
        console.log('Document has unsaved changes');
    }
});
```

### Implementing a File Decoration Provider

```typescript
import * as vscode from 'vscode';

class CustomFileDecorationProvider implements vscode.FileDecorationProvider {
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        // Example: Mark files in 'temp' folder with a badge
        if (uri.fsPath.includes('/temp/')) {
            return {
                badge: 'T',
                tooltip: 'Temporary file',
                color: new vscode.ThemeColor('charts.yellow')
            };
        }
        return undefined;
    }
}

// Register the provider
const provider = new CustomFileDecorationProvider();
vscode.window.registerFileDecorationProvider(provider);
```

---

## Summary

Cursor's file tracking system is a sophisticated multi-layered architecture:

1. **Detection Layer**: Native C++ file watchers (@parcel/watcher) + VSCode's FileSystemWatcher API provide high-performance filesystem monitoring across recursive, non-recursive, and polling modes

2. **Storage Layer**: SQLite database with embedded JSON bubbles stores comprehensive edit history including AI diffs, human changes, trajectories, and rich context metadata

3. **UI Layer**: Theme-aware visual indicators across tabs (dirty borders, filled circles), file trees (count badges), and editor gutters (dirty-diff) provide immediate feedback on file state

The system is built on VSCode's extension APIs, making it compatible with the broader VSCode ecosystem while adding Cursor-specific enhancements for AI-assisted editing workflows.

All code is heavily minified in production, requiring sourcemaps or decompilation for detailed analysis. This documentation is based on reverse-engineering the application structure, CSS classes, TypeScript definitions, and database schema.

**Related Documentation**:
- [Cursor Tool Bubble Format](./cursor-tool-bubble-format.md) - Detailed bubble schema and field definitions
