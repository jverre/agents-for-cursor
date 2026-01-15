const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const CursorInstaller = require('./cursor-installer');

// ACP log file path (same as extension.js)
const ACP_LOG_PATH = path.join(os.homedir(), '.cursor-acp.log');

class CursorAutomation {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.extensionPath - Path to the extension source
   * @param {string} options.userDataDir - Path to user data directory
   * @param {boolean} options.useIsolated - Use isolated Cursor installation for testing
   */
  constructor(options = {}) {
    // Use isolated installation for LOCAL mode, system installation for CI
    const isLocal = process.env.LOCAL === 'true';
    this.useIsolated = options.useIsolated !== undefined ? options.useIsolated : isLocal;
    this.installer = new CursorInstaller({ useIsolated: this.useIsolated });
    this.extensionPath = options.extensionPath || path.join(__dirname, '..', '..');
    this.userDataDir = options.userDataDir || path.join(__dirname, '..', 'e2e-user-data');
    this.electronApp = null;
    this.mainWindow = null;
    this.logFile = null;
  }

  /**
   * Get the Cursor app root path (where workbench files live)
   */
  getCursorAppRoot() {
    return this.installer.getCursorResourcesPath();
  }

  /**
   * Check if patches are currently applied by looking for ACP token in workbench files
   */
  async arePatchesApplied() {
    const appRoot = this.getCursorAppRoot();
    const packageJson = require('../../package.json');
    const token = `/* ACP_PATCH_${packageJson.version} */`;
    
    try {
      const workbenchPath = path.join(appRoot, 'out/vs/code/electron-sandbox/workbench/workbench.js');
      const mainWorkbenchPath = path.join(appRoot, 'out/vs/workbench/workbench.desktop.main.js');
      
      const content = fs.readFileSync(workbenchPath, 'utf8');
      const mainContent = fs.readFileSync(mainWorkbenchPath, 'utf8');
      
      return content.includes(token) && mainContent.includes(token);
    } catch {
      return false;
    }
  }

  setupLogCapture() {
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    this.logFile = path.join(logsDir, `cursor-${Date.now()}.log`);
    fs.writeFileSync(this.logFile, `=== Cursor Log Started ${new Date().toISOString()} ===\n`);

    this.mainWindow.on('console', msg => {
      const text = `[${msg.type()}] ${msg.text()}\n`;
      fs.appendFileSync(this.logFile, text);
    });
  }

  async launch() {
    // Kill any lingering Cursor processes before launching (important on Linux CI)
    if (process.platform === 'linux' && process.env.CI === 'true') {
      const { exec } = require('child_process');
      // Target the actual Cursor executable path, not the test directory
      await new Promise(resolve => {
        exec('pkill -9 -f ".local/share/Cursor" || true', () => resolve());
      });
      await this.sleep(2000);
    }

    const executablePath = this.installer.getCursorExecutablePath();

    // Open the extension directory as workspace
    const workspaceDir = this.extensionPath;

    this.electronApp = await electron.launch({
      executablePath,
      args: [
        workspaceDir,  // Open this directory as workspace
        `--user-data-dir=${this.userDataDir}`,
        `--extensionDevelopmentPath=${this.extensionPath}`,
        '--no-sandbox',
        '--disable-gpu'
      ]
    });

    this.mainWindow = await this.electronApp.firstWindow();

    // Set up console log capture
    this.setupLogCapture();

    // Open DevTools for debugging (captures more logs)
    await this.mainWindow.evaluate(() => {
      if (window.electronAPI?.openDevTools) {
        window.electronAPI.openDevTools();
      }
    }).catch(() => {});

    return { app: this.electronApp, window: this.mainWindow };
  }

  async executeCommand(commandName, screenshotPrefix = '') {
    console.log(`[Test] Executing command: ${commandName}`);
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.mainWindow.keyboard.press(`${modifier}+Shift+P`);
    if (screenshotPrefix) {
      await this.screenshot(`${screenshotPrefix}a-command-palette-opened.png`);
    }

    await this.mainWindow.waitForSelector('[placeholder*="command"]', { timeout: 5000 });
    // Type the command (preserves the ">" prefix)
    await this.mainWindow.keyboard.type(commandName);
    await this.sleep(300);
    if (screenshotPrefix) {
      await this.screenshot(`${screenshotPrefix}b-command-typed.png`);
    }

    await this.mainWindow.keyboard.press('Enter');
    await this.sleep(1000); // Give more time for command to execute
    if (screenshotPrefix) {
      await this.screenshot(`${screenshotPrefix}c-command-executed.png`);
    }
    console.log(`[Test] Command executed: ${commandName}`);
  }

  async enableACP() {
    await this.screenshot('0-setup-1-before-acp-enable.png');
    await this.executeCommand('Agents for Cursor: Enable', '0-setup-2');
    await this.screenshot('0-setup-3-after-acp-enable-command.png');

    // Wait for patches to be applied, but handle case where Cursor exits on its own
    console.log('[Test] Waiting for patches to be applied (max 15 seconds)...');
    
    // Poll to check if app is still running, with timeout
    const startTime = Date.now();
    const maxWait = 15000;
    
    while (Date.now() - startTime < maxWait) {
      await this.sleep(1000);
      
      // Check if app is still running
      try {
        const isRunning = this.electronApp && !this.electronApp.process()?.killed;
        if (!isRunning) {
          console.log('[Test] Cursor exited after enable command (expected behavior)');
          break;
        }
      } catch (e) {
        // App process check failed, likely exited
        console.log('[Test] Cursor process no longer accessible');
        break;
      }
    }
    
    await this.screenshot('0-setup-4-after-wait.png').catch(() => {});

    // Restart to apply patches (handles case where app already exited)
    await this.restart();
  }

  async waitForHttpServer(maxAttempts = 10) {
    const fetch = require('node-fetch');

    for (let i = 0; i < maxAttempts; i++) {
      try {
        await fetch('http://localhost:37842', { timeout: 2000 });
        return true;
      } catch {
        await this.sleep(1000);
      }
    }
    throw new Error('HTTP server not reachable');
  }

  async restart() {
    console.log('[Test] Restarting Cursor...');
    await this.close();
    await this.launch();
    console.log('[Test] Cursor restarted successfully');
  }

  async openChat() {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    // Cmd+Shift+L opens a new chat and opens sidebar if not already open
    await this.mainWindow.keyboard.press(`${modifier}+Shift+L`);
    await this.sleep(500);
  }

  async selectModel(modelName, screenshotPrefix = '') {
    // Click the model dropdown
    const dropdown = await this.mainWindow.waitForSelector('.composer-unified-dropdown-model', { timeout: 5000 });
    await dropdown.click();
    await this.sleep(300);

    // Take screenshot of dropdown for debugging
    if (screenshotPrefix) {
      await this.screenshot(`${screenshotPrefix}a-dropdown-opened.png`);
    }

    // Check if Auto is currently enabled
    const isAutoEnabled = await this.mainWindow.evaluate(() => {
      const toggle = document.querySelector('#use-default-model');
      const switchEl = toggle?.querySelector('.w-2\\.5.h-2\\.5.rounded-full.absolute');
      return switchEl?.style.left !== '2px';
    });

    if (modelName === 'Auto') {
      // If selecting Auto, make sure it's enabled
      if (!isAutoEnabled) {
        const toggleSwitch = await this.mainWindow.$('#use-default-model .w-6.h-3\\.5.rounded-full');
        if (toggleSwitch) {
          await toggleSwitch.click();
          await this.sleep(300);
        }
      }
      // Close dropdown
      await this.mainWindow.keyboard.press('Escape');
      await this.sleep(300);
    } else {
      // If selecting a specific model, disable Auto first if enabled
      if (isAutoEnabled) {
        const toggleSwitch = await this.mainWindow.$('#use-default-model .w-6.h-3\\.5.rounded-full');
        if (toggleSwitch) {
          await toggleSwitch.click();
          await this.sleep(300);
          if (screenshotPrefix) {
            await this.screenshot(`${screenshotPrefix}b-auto-disabled.png`);
          }
        }
      }

      // Find and click the model by name
      try {
        const modelItem = await this.mainWindow.waitForSelector(
          `.composer-unified-context-menu-item:has-text("${modelName}")`,
          { timeout: 5000 }
        );
        await modelItem.click();
        await this.sleep(300);
      } catch (error) {
        if (screenshotPrefix) {
          await this.screenshot(`${screenshotPrefix}z-model-not-found.png`);
        }
        throw error;
      }
    }
  }

  async selectMode(modeName, screenshotPrefix = '') {
    const triggerSelector = '.composer-unified-dropdown[data-mode], [data-mode].composer-unified-dropdown';
    const trigger = await this.mainWindow.waitForSelector(triggerSelector, { timeout: 5000 });
    await trigger.click({ force: true });
    await this.sleep(300);
    if (screenshotPrefix) {
      await this.screenshot(`${screenshotPrefix}a-mode-dropdown-opened.png`);
    }

    const modeSelectors = [
      `.composer-unified-context-menu-item:has-text("${modeName}")`,
      `.context-view .monaco-action-bar .action-item:has-text("${modeName}")`,
      `text=${modeName}`
    ];

    let modeItem = null;
    for (const selector of modeSelectors) {
      modeItem = await this.mainWindow.$(selector);
      if (modeItem) break;
    }

    if (!modeItem) {
      modeItem = await this.mainWindow.waitForSelector(`text=${modeName}`, { timeout: 5000 });
    }

    await modeItem.click({ force: true });
    await this.sleep(300);

    await this.mainWindow.waitForFunction(
      ({ selector, expected }) => {
        const el = document.querySelector(selector);
        const current = el?.getAttribute('data-mode');
        return current && expected && current.toLowerCase() === expected.toLowerCase();
      },
      { selector: triggerSelector, expected: modeName }
    );

    if (screenshotPrefix) {
      await this.screenshot(`${screenshotPrefix}b-mode-selected.png`);
    }
  }

  async sendChatMessage(message) {
    const chatInput = await this.mainWindow.waitForSelector(
      'div.aislash-editor-input[contenteditable="true"]',
      { timeout: 10000 }
    );
    await chatInput.click({ force: true });
    await this.mainWindow.keyboard.type(message);
    await this.mainWindow.keyboard.press('Enter');
  }

  async typeInChat(text) {
    const chatInput = await this.mainWindow.waitForSelector(
      'div.aislash-editor-input[contenteditable="true"]',
      { timeout: 10000 }
    );
    await chatInput.click({ force: true });
    await this.mainWindow.keyboard.type(text);
    // Don't press Enter - just type
  }

  async isElementVisible(selector, timeout = 5000) {
    try {
      await this.mainWindow.waitForSelector(selector, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  async hasTextInDropdown(text, timeout = 5000) {
    try {
      // Wait for dropdown to appear and check for text
      // The text is in a .monaco-highlighted-label inside .composer-unified-context-menu-item
      const element = await this.mainWindow.waitForSelector(
        `.composer-unified-context-menu-item:has-text("${text}"), .monaco-highlighted-label:has-text("${text}")`,
        { timeout }
      );
      return element !== null;
    } catch {
      return false;
    }
  }

  async waitForChatResponse(timeout = 30000) {
    // Count existing sections before waiting for new one
    const initialCount = await this.mainWindow.evaluate(() =>
      document.querySelectorAll('section.markdown-section').length
    );

    // Single unified polling loop: wait for section to appear, then wait for stop button to disappear
    const startTime = Date.now();
    let lastScreenshotTime = 0;
    let screenshotCounter = 0;
    let sectionAppeared = false;
    const pollInterval = 500; // Check every 500ms
    const screenshotInterval = 3000; // Screenshot every 3 seconds

    while (Date.now() - startTime < timeout) {
      await this.sleep(pollInterval);

      // Take screenshot every 3 seconds
      const currentTime = Date.now();
      if (currentTime - lastScreenshotTime >= screenshotInterval) {
        const elapsedSeconds = Math.floor((currentTime - startTime) / 1000);
        const phase = sectionAppeared ? 'streaming' : 'waiting';
        await this.screenshot(`${phase}-${screenshotCounter++}-${elapsedSeconds}s.png`);
        lastScreenshotTime = currentTime;
      }

      // Check if section has appeared
      if (!sectionAppeared) {
        const currentCount = await this.mainWindow.evaluate(() =>
          document.querySelectorAll('section.markdown-section').length
        );

        if (currentCount > initialCount) {
          sectionAppeared = true;
          await this.screenshot(`section-appeared.png`);
        }
        continue; // Keep waiting for section to appear
      }

      // Section appeared - now wait for stop button to disappear (streaming complete)
      const stopButtonExists = await this.mainWindow.evaluate(() => {
        return document.querySelector('.codicon-debug-stop') !== null;
      });

      if (!stopButtonExists) {
        // Stop button gone - streaming complete
        const finalElapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        await this.screenshot(`complete-${finalElapsedSeconds}s.png`);
        break;
      }
    }

    // Check if we timed out before section appeared
    if (!sectionAppeared) {
      await this.screenshot(`timeout-no-section.png`);
      throw new Error(`Timeout waiting for chat section to appear (waited ${timeout}ms)`);
    }

    // Get all sections' text
    return this.mainWindow.evaluate(() => {
      const sections = document.querySelectorAll('section.markdown-section');
      return Array.from(sections).map(s => s.textContent).join('\n');
    });
  }

  async screenshot(filename) {
    const dir = path.join(__dirname, '..', 'screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await this.mainWindow.screenshot({ path: path.join(dir, filename) });
  }

  async close() {
    if (this.electronApp) {
      const { exec } = require('child_process');
      
      // Try graceful close with timeout
      const closePromise = this.electronApp.close().catch(() => {});
      const timeoutPromise = this.sleep(5000).then(() => 'timeout');
      
      const result = await Promise.race([closePromise, timeoutPromise]);
      
      if (result === 'timeout') {
        console.log('[CursorAutomation] Graceful close timed out, force killing...');
        // Force kill the process
        try {
          const pid = this.electronApp.process()?.pid;
          if (pid) {
            process.kill(pid, 'SIGKILL');
          }
        } catch (e) {
          // Process may already be dead
        }
      }
      
      this.electronApp = null;
      this.mainWindow = null;

      // Kill lingering processes only for isolated installs, or on Linux CI
      const shouldKillByPattern = this.useIsolated || (process.platform === 'linux' && process.env.CI === 'true');
      if (shouldKillByPattern) {
        const killPattern = this.useIsolated
          ? '.cursor-test-installation'
          : '.local/share/Cursor';

        await new Promise(resolve => {
          if (process.platform === 'win32') {
            exec('taskkill /F /IM Cursor.exe 2>nul', () => resolve());
          } else {
            exec(`pkill -9 -f "${killPattern}" 2>/dev/null || true`, () => resolve());
          }
        });
      }
      
      // Brief wait for cleanup
      await this.sleep(500);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the contents of the ACP log file
   * @returns {string} Log file contents, or empty string if file doesn't exist
   */
  getAcpLogs() {
    try {
      return fs.existsSync(ACP_LOG_PATH) ? fs.readFileSync(ACP_LOG_PATH, 'utf8') : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Clear the ACP log file
   */
  clearAcpLogs() {
    try {
      fs.writeFileSync(ACP_LOG_PATH, '');
    } catch (e) {
      // Ignore errors
    }
  }

  /**
   * Get the path to the ACP log file
   * @returns {string} Path to the log file
   */
  getAcpLogPath() {
    return ACP_LOG_PATH;
  }
}

module.exports = CursorAutomation;
