const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get the path to the system Cursor's state database
 */
function getSystemCursorDbPath() {
  const platform = os.platform();
  switch (platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    case 'linux':
      return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    case 'win32':
      return path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    default:
      return null;
  }
}

/**
 * Extract auth tokens from the system Cursor installation
 */
function extractAuthFromSystemCursor() {
  const dbPath = getSystemCursorDbPath();
  
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.log('System Cursor database not found at:', dbPath);
    return null;
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    const stmt = db.prepare('SELECT key, value FROM ItemTable WHERE key LIKE ?');
    const rows = stmt.all('cursorAuth/%');
    db.close();

    if (rows.length === 0) {
      console.log('No auth tokens found in system Cursor');
      return null;
    }

    const auth = {};
    for (const row of rows) {
      auth[row.key] = row.value;
    }

    console.log('Extracted auth from system Cursor:', Object.keys(auth).join(', '));
    return auth;
  } catch (error) {
    console.log('Failed to extract auth from system Cursor:', error.message);
    return null;
  }
}

function setupTestAuth() {
  const userDataDir = path.join(__dirname, '..', 'e2e-user-data');
  const userDir = path.join(userDataDir, 'User');
  const globalStorageDir = path.join(userDir, 'globalStorage');

  // Always create directory structure
  fs.mkdirSync(globalStorageDir, { recursive: true });

  // Create minimal settings.json if it doesn't exist
  const settingsPath = path.join(userDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify({
      "window.commandCenter": true,
      "workbench.colorTheme": "Default Dark Modern"
    }, null, 2));
    console.log('Created minimal settings.json');
  }

  // Create minimal keybindings.json if it doesn't exist
  const keybindingsPath = path.join(userDir, 'keybindings.json');
  if (!fs.existsSync(keybindingsPath)) {
    fs.writeFileSync(keybindingsPath, '[]');
    console.log('Created minimal keybindings.json');
  }

  // Create state.vscdb.options.json
  fs.writeFileSync(
    path.join(globalStorageDir, 'state.vscdb.options.json'),
    JSON.stringify({ useWAL: true })
  );

  // Create state.vscdb with auth if token provided
  const dbPath = path.join(globalStorageDir, 'state.vscdb');
  const db = new Database(dbPath);

  db.exec(`CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)`);

  const stmt = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)');

  // Skip onboarding screens
  const onboardingData = {
    'workbench.services.onFirstStartupService.isVeryFirstTime': 'false',
    'workbench.contrib.onboarding.browser.gettingStarted.contribution.ts.firsttime': 'false',
    'cursor.featureStatus.dataPrivacyOnboarding': 'completed',
    'cursorai/donotchange/privacyMode': 'true',
    'cursorai/donotchange/newPrivacyMode2': '{"privacyMode":"PRIVACY_MODE_NO_TRAINING"}',
    'cursorai/donotchange/hasReconciledNewPrivacyModeWithServerOnUpgrade': 'true',
    'cursorai/donotchange/newPrivacyModeHoursRemainingInGracePeriod': '0'
  };

  for (const [key, value] of Object.entries(onboardingData)) {
    stmt.run(key, value);
  }
  console.log('Onboarding skip flags configured');

  // Determine auth source: env var, or extract from system Cursor (for local dev)
  const isLocal = process.env.LOCAL === 'true';
  let authToken = process.env.CURSOR_AUTH_TOKEN;
  let authEmail = process.env.CURSOR_EMAIL;
  let systemAuth = null;

  // For local development, try to extract auth from system Cursor if not provided
  if (isLocal && !authToken) {
    systemAuth = extractAuthFromSystemCursor();
    if (systemAuth) {
      authToken = systemAuth['cursorAuth/accessToken'];
      authEmail = systemAuth['cursorAuth/cachedEmail'];
    }
  }

  if (authToken) {
    // If we have system auth, use all the extracted values
    if (systemAuth) {
      for (const [key, value] of Object.entries(systemAuth)) {
        stmt.run(key, value);
      }
      console.log('Auth tokens copied from system Cursor');
    } else {
      // Otherwise use env vars
      const authData = {
        'cursorAuth/accessToken': authToken,
        'cursorAuth/refreshToken': authToken,
        'cursorAuth/cachedEmail': authEmail || 'test@example.com',
        'cursorAuth/stripeMembershipType': 'free',
        'cursorAuth/stripeSubscriptionStatus': 'active',
        'cursorAuth/cachedSignUpType': 'Google'
      };

      for (const [key, value] of Object.entries(authData)) {
        stmt.run(key, value);
      }
      console.log('Auth tokens configured from environment');
    }
  } else {
    console.log('No auth tokens available (set CURSOR_AUTH_TOKEN or run with LOCAL=true to extract from system Cursor)');
  }

  db.close();
  console.log('Test user data configured at:', userDataDir);
}

if (require.main === module) {
  setupTestAuth();
}

module.exports = { setupTestAuth };
