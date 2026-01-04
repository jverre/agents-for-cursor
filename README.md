<h2 align="center">
  Agents for Cursor (Claude Code, etc)
</h2>

<div align="center">

[![Install Extension](https://img.shields.io/badge/Install-Cursor%20Extension-007ACC?style=for-the-badge&logo=cursor)](cursor:extension/jverre.agents-for-cursor)

</div>

# Introduction

Using Claude Code or Codex in Cursor is painful, yet another Terminal UI or chat sidebar to manage. With 'Agents for Cursor', you can use Claude code directly from the Cursor Chat sidebar.

![Homepage](https://github.com/jverre/agents-for-cursor/raw/main/docs/img/homepage.png)

## Features

The goal is to integrate Claude Code and Codex deeply into Cursor's feature set. So far it has been integrated into:

1. Claude Code is available in the model selector for both the chat sidebar and the Agent UI
2. Tool calls are displayed in the UI
3. Support for slash commands (`/init`, `/security-review`, etc) including custom commands
3. Conversation history is maintained

In addition, the following is currently work in progress:
1. Add support for `/login`
2. Add support for tool call permissions (today they are all executed without asking permissions)
3. Add support for "Agent", "Plan", "Ask" modes
4. Add support for multiple Claude Code models

## Installation and configuration

> [!warning]
>
> This extension works by modifying core Cursor files and my corrupt the installation.

To install the extension:
1. [Click here to install](vscode:extension/jverre.agents-for-cursor) or search for "Agents for Cursor" in the extensions tab and click "Install".
2. Once installed, you will be prompted to "Enable" the extension and restart Cursor.
3. Install Claude Code and run "/login" to run the auth process

You will now be able to use Claude Code directly from the Cursor Chat sidebar.

### Advanced

The "Agents for Cursor" extension surfaces commands to manage the extension:
1. To disable the extension, open the coomand palette with `shift+cmd+p` and run `Agents for Cursor: Disable`
2. To enable the extension, open the coomand palette with `shift+cmd+p` and run `Agents for Cursor: Enable`

## Contributions

The extension is work in progress, if you have any feedback or run into issues just open a Github issue and I'll take a look !