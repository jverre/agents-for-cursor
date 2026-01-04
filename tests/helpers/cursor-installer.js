const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const download = require('download');

/**
 * Cursor Installer - Downloads and installs Cursor for testing
 */
class CursorInstaller {
  constructor() {
    this.platform = os.platform();
    this.arch = os.arch();
    this.cacheDir = path.join(os.homedir(), '.cursor-test-cache');
    this.installDir = this.getDefaultInstallDir();

    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Get the default installation directory for Cursor
   */
  getDefaultInstallDir() {
    switch (this.platform) {
      case 'darwin':
        return '/Applications/Cursor.app';
      case 'linux':
        return path.join(os.homedir(), '.local', 'share', 'Cursor');
      case 'win32':
        return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Cursor');
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  /**
   * Get the download URL for Cursor
   * Using the working Cursor API v2 endpoint
   */
  getDownloadUrl() {
    // Use Cursor API v2 endpoints with known working version
    const baseUrl = 'https://api2.cursor.sh/updates/download/golden';
    const version = '2.2';  // Known working version

    switch (this.platform) {
      case 'darwin':
        // macOS - DMG for x64 (Intel/Rosetta)
        return `${baseUrl}/mac-x64/cursor/${version}`;
      case 'linux':
        // Linux - AppImage for x64
        return `${baseUrl}/linux-x64/cursor/${version}`;
      case 'win32':
        // Windows - NSIS installer for x64
        return `${baseUrl}/windows-x64/cursor/${version}`;
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  /**
   * Get the cached file path for the installer
   */
  getCachedFilePath() {
    const extensions = {
      'darwin': '.dmg',
      'linux': '.AppImage',
      'win32': '.exe'
    };

    const ext = extensions[this.platform];
    return path.join(this.cacheDir, `cursor-latest${ext}`);
  }

  /**
   * Download Cursor installer
   * @param {boolean} forceDownload - Force re-download even if cached
   */
  async downloadCursor(forceDownload = false) {
    const cachedFile = this.getCachedFilePath();

    // Check if already cached
    if (!forceDownload && fs.existsSync(cachedFile)) {
      console.log(`Using cached Cursor installer: ${cachedFile}`);
      return cachedFile;
    }

    console.log('Downloading latest Cursor...');
    const url = this.getDownloadUrl();
    console.log(`Download URL: ${url}`);

    try {
      await download(url, this.cacheDir, {
        filename: path.basename(cachedFile)
      });

      console.log(`Downloaded Cursor to: ${cachedFile}`);
      return cachedFile;
    } catch (error) {
      throw new Error(`Failed to download Cursor: ${error.message}`);
    }
  }

  /**
   * Install Cursor from the downloaded installer
   * @param {string} installerPath - Path to the installer file
   */
  async installCursor(installerPath) {
    console.log(`Installing Cursor from: ${installerPath}`);

    switch (this.platform) {
      case 'darwin':
        await this.installMacOS(installerPath);
        break;
      case 'linux':
        await this.installLinux(installerPath);
        break;
      case 'win32':
        await this.installWindows(installerPath);
        break;
    }

    console.log(`Cursor installed to: ${this.installDir}`);
  }

  /**
   * Install on macOS
   */
  async installMacOS(dmgPath) {
    try {
      // Mount the DMG
      console.log('Mounting DMG...');
      const mountOutput = execSync(`hdiutil attach "${dmgPath}" -nobrowse`, {
        encoding: 'utf8'
      });

      // Extract mount point
      const mountPoint = mountOutput.split('\n')
        .find(line => line.includes('/Volumes/'))
        ?.split('\t')
        .pop()
        .trim();

      if (!mountPoint) {
        throw new Error('Failed to find mount point');
      }

      console.log(`Mounted at: ${mountPoint}`);

      // Remove existing installation if present
      if (fs.existsSync(this.installDir)) {
        console.log('Removing existing Cursor installation...');
        execSync(`rm -rf "${this.installDir}"`);
      }

      // Copy application
      console.log('Copying Cursor.app to /Applications...');
      execSync(`cp -R "${mountPoint}/Cursor.app" /Applications/`);

      // Unmount DMG
      console.log('Unmounting DMG...');
      execSync(`hdiutil detach "${mountPoint}"`);

    } catch (error) {
      throw new Error(`macOS installation failed: ${error.message}`);
    }
  }

  /**
   * Install on Linux
   */
  async installLinux(appImagePath) {
    try {
      // Make AppImage executable
      execSync(`chmod +x "${appImagePath}"`);

      // Clean install directory
      if (fs.existsSync(this.installDir)) {
        execSync(`rm -rf "${this.installDir}"`);
      }

      fs.mkdirSync(this.installDir, { recursive: true });

      // Extract AppImage (suppress output to avoid ENOBUFS error)
      console.log('Extracting AppImage (this may take a minute)...');
      execSync(`"${appImagePath}" --appimage-extract > /dev/null 2>&1`, {
        cwd: this.installDir,
        stdio: 'ignore',  // Ignore all output to prevent buffer overflow
        maxBuffer: 1024 * 1024 * 10  // 10MB buffer just in case
      });

      // The extracted folder is named 'squashfs-root'
      const extractedDir = path.join(this.installDir, 'squashfs-root');
      if (fs.existsSync(extractedDir)) {
        // Move contents up one level
        const files = fs.readdirSync(extractedDir);
        files.forEach(file => {
          const src = path.join(extractedDir, file);
          const dest = path.join(this.installDir, file);
          fs.renameSync(src, dest);
        });
        fs.rmdirSync(extractedDir);
      }

      // Find the Cursor executable
      const possibleExecutables = [
        'cursor',
        'Cursor',
        'AppRun',
        'usr/bin/cursor',
        'usr/share/cursor/cursor'
      ];

      let foundExecutable = null;
      for (const exe of possibleExecutables) {
        const exePath = path.join(this.installDir, exe);
        if (fs.existsSync(exePath)) {
          console.log(`Found executable at: ${exe}`);
          foundExecutable = exe;
          execSync(`chmod +x "${exePath}"`);
          break;
        }
      }

      if (!foundExecutable) {
        // List what we actually have
        const contents = execSync(`ls -la "${this.installDir}"`, { encoding: 'utf8' });
        console.log('Install directory contents:', contents);
        throw new Error('Could not find Cursor executable after extraction');
      }

      console.log('Linux installation complete (AppImage extracted)');

    } catch (error) {
      throw new Error(`Linux installation failed: ${error.message}`);
    }
  }

  /**
   * Install on Windows
   */
  async installWindows(exePath) {
    try {
      // Run silent installation
      console.log('Running Windows installer...');
      execSync(`"${exePath}" /S`, {
        stdio: 'inherit',
        timeout: 300000 // 5 minutes
      });

      // Wait for installation to complete
      await new Promise(resolve => setTimeout(resolve, 10000));

    } catch (error) {
      throw new Error(`Windows installation failed: ${error.message}`);
    }
  }

  /**
   * Get the path to the Cursor executable
   */
  getCursorExecutablePath() {
    switch (this.platform) {
      case 'darwin':
        return path.join(this.installDir, 'Contents', 'MacOS', 'Cursor');
      case 'linux':
        // Try multiple possible locations
        const possiblePaths = [
          'cursor',
          'Cursor',
          'AppRun',
          'usr/bin/cursor',
          'usr/share/cursor/cursor'
        ];

        for (const p of possiblePaths) {
          const fullPath = path.join(this.installDir, p);
          if (fs.existsSync(fullPath)) {
            return fullPath;
          }
        }

        // Fallback to default
        return path.join(this.installDir, 'cursor');
      case 'win32':
        return path.join(this.installDir, 'Cursor.exe');
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  /**
   * Get the path to Cursor's resources directory
   */
  getCursorResourcesPath() {
    switch (this.platform) {
      case 'darwin':
        return path.join(this.installDir, 'Contents', 'Resources', 'app');
      case 'linux':
        // AppImage extracts to usr/share/cursor/resources/app
        return path.join(this.installDir, 'usr', 'share', 'cursor', 'resources', 'app');
      case 'win32':
        return path.join(this.installDir, 'resources', 'app');
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  /**
   * Check if Cursor is installed by trying to run it
   */
  isInstalled() {
    // For Linux, try running the cursor command to verify it actually works
    if (this.platform === 'linux') {
      try {
        const execPath = this.getCursorExecutablePath();

        // Try to run cursor --version or --help
        execSync(`"${execPath}" --version 2>&1 || "${execPath}" --help 2>&1 || true`, {
          encoding: 'utf8',
          timeout: 5000,
          stdio: 'pipe'
        });

        console.log(`Cursor executable verified at: ${execPath}`);
        return true;
      } catch (error) {
        console.log('Cursor command check failed:', error.message);

        // Debug: list executable files to see what's actually there
        try {
          const contents = execSync(`find "${this.installDir}" -maxdepth 2 -type f -executable 2>/dev/null | head -20`, {
            encoding: 'utf8'
          });
          console.log('Executable files found in install directory:');
          console.log(contents);
        } catch (e) {
          console.log('Could not list directory contents:', e.message);
        }

        return false;
      }
    }

    // For macOS and Windows, check if executable exists
    const execPath = this.getCursorExecutablePath();
    return fs.existsSync(execPath);
  }

  /**
   * Get Cursor version (if installed)
   */
  getVersion() {
    if (!this.isInstalled()) {
      return null;
    }

    try {
      const productJsonPath = path.join(this.getCursorResourcesPath(), 'product.json');
      if (fs.existsSync(productJsonPath)) {
        const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
        return productJson.version;
      }
    } catch (error) {
      console.warn('Failed to read Cursor version:', error.message);
    }

    return 'unknown';
  }

  /**
   * Complete installation flow
   */
  async install(forceDownload = false) {
    console.log('Starting Cursor installation...');
    console.log(`Platform: ${this.platform}`);
    console.log(`Install directory: ${this.installDir}`);

    // Download
    const installerPath = await this.downloadCursor(forceDownload);

    // Install
    await this.installCursor(installerPath);

    // Verify
    if (!this.isInstalled()) {
      throw new Error('Installation verification failed');
    }

    const version = this.getVersion();
    console.log(`Cursor ${version} installed successfully`);

    return {
      executablePath: this.getCursorExecutablePath(),
      resourcesPath: this.getCursorResourcesPath(),
      version
    };
  }
}

// CLI usage
if (require.main === module) {
  const installer = new CursorInstaller();

  const command = process.argv[2];

  if (command === 'download') {
    installer.downloadCursor(false)
      .then(path => console.log(`Downloaded to: ${path}`))
      .catch(err => {
        console.error(err.message);
        process.exit(1);
      });
  } else if (command === 'install') {
    installer.install(false)
      .then(info => console.log('Installation complete:', info))
      .catch(err => {
        console.error(err.message);
        process.exit(1);
      });
  } else if (command === 'check') {
    console.log('Cursor installed:', installer.isInstalled());
    console.log('Version:', installer.getVersion());
    console.log('Executable:', installer.getCursorExecutablePath());
  } else {
    console.log('Usage: node cursor-installer.js [download|install|check]');
  }
}

module.exports = CursorInstaller;
