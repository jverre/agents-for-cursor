# Test User Data Directory

This directory stores Cursor user data for E2E tests.
Contents are NOT committed (contains auth secrets).

## Local Setup

Run Cursor once with this user-data-dir, then log in:

```bash
/path/to/Cursor --user-data-dir=./tests/e2e-user-data
```

Or set environment variables and run the setup script:

```bash
export CURSOR_AUTH_TOKEN="your-jwt-token"
export CURSOR_EMAIL="your-email@example.com"
node tests/helpers/setup-test-auth.js
```

To get your token from an existing Cursor installation:

```bash
sqlite3 ~/Library/Application\ Support/Cursor/User/globalStorage/state.vscdb \
  "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'"
```

## CI Setup

Set these GitHub secrets:
- `CURSOR_AUTH_TOKEN` - JWT token for Cursor authentication
- `CURSOR_EMAIL` - Email for the test account (optional)

The `setup-test-auth.js` script injects these into `state.vscdb` before tests run.
