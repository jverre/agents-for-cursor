const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

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

  // Add auth tokens if provided
  const authToken = process.env.CURSOR_AUTH_TOKEN;
  if (authToken) {
    const authData = {
      'cursorAuth/accessToken': authToken,
      'cursorAuth/refreshToken': authToken,
      'cursorAuth/cachedEmail': process.env.CURSOR_EMAIL || 'test@example.com',
      'cursorAuth/stripeMembershipType': 'free',
      'cursorAuth/stripeSubscriptionStatus': 'active',
      'cursorAuth/cachedSignUpType': 'Google'
    };

    for (const [key, value] of Object.entries(authData)) {
      stmt.run(key, value);
    }
    console.log('Auth tokens configured');
  } else {
    console.log('CURSOR_AUTH_TOKEN not set, skipping auth setup');
  }

  db.close();
  console.log('Test user data configured at:', userDataDir);
}

if (require.main === module) {
  setupTestAuth();
}

module.exports = { setupTestAuth };
