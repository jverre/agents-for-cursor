# GitHub Actions Workflows

This directory contains CI/CD workflows for the Cursor ACP Extension project.

## Workflows

### Test ACP Extension (`test-acp-extension.yml`)

End-to-end testing workflow that runs on every pull request and push to main branches.

**Triggers:**
- Pull requests to `main`, `master`, or `develop`
- Pushes to `main`, `master`, or `develop`
- Manual trigger via `workflow_dispatch`
- Only runs when files in `cursor-acp-extension/` change

**Jobs:**

#### E2E Tests
- **Runs on:** Ubuntu Latest
- **Purpose:** Full end-to-end workflow testing with real Claude Code agent
- **Steps:**
  - Checkout code
  - Setup Node.js with npm cache
  - Install test dependencies
  - Install system dependencies (Electron/Chromium libraries, Xvfb)
  - Install Claude Code ACP agent globally
  - Download latest Cursor
  - Install Cursor
  - Verify Cursor installation
  - Run E2E tests with Playwright in Xvfb
  - Upload screenshots, logs, and test results on failure

**Duration:** ~20-25 minutes

**Requirements:**
- `ANTHROPIC_API_KEY` secret must be configured in repository settings

## Test Coverage

| Test Type | Platform | Status |
|-----------|----------|--------|
| E2E (Full Workflow) | Ubuntu Latest | ✅ Active |
| Unit Tests | - | 📝 Available locally |
| Integration Tests | - | 📝 Available locally |

## Artifacts

Artifacts are uploaded automatically:

| Artifact | Contains | When | Retention |
|----------|----------|------|-----------|
| `e2e-screenshots` | PNG screenshots from test execution | On failure | 7 days |
| `e2e-logs` | Test logs and page HTML dumps | On failure | 7 days |
| `test-results` | Playwright test results (JSON/HTML) | Always | 7 days |

## Environment Variables

| Variable | Purpose | Value |
|----------|---------|-------|
| `CI` | Indicates CI environment | `true` |
| `DISPLAY` | X11 display for Xvfb | `:99` |
| `ANTHROPIC_API_KEY` | Claude Code API key | From repository secrets |

## Viewing Results

### In Pull Requests

Test results appear as status checks in PRs:
- ✅ All checks must pass before merging
- Click "Details" to view workflow logs
- Download artifacts for debugging failures

### In GitHub Actions UI

1. Go to **Actions** tab
2. Select **Test ACP Extension** workflow
3. View run history and details
4. Download artifacts from failed runs

## Local Testing

Run tests locally before pushing:

```bash
# Navigate to extension directory
cd cursor-acp-extension

# Install dependencies
npm install

# Install Claude Code globally
npm install -g @anthropic-ai/claude-code

# Set API key
export ANTHROPIC_API_KEY=your_key_here

# Run individual test suites (optional)
npm run test:unit
npm run test:integration

# Run E2E tests (requires Cursor installation)
npm run download-cursor
npm run test:e2e
```

## Troubleshooting

### E2E Tests Fail on macOS

**Issue:** Permission errors or Cursor won't launch

**Solution:**
- Check system dependencies
- Verify Cursor installation path
- Review screenshots in artifacts

### E2E Tests Timeout

**Issue:** Tests exceed 15-minute timeout

**Solution:**
- Cursor download may be slow
- Increase timeout in workflow
- Check for hanging processes

### Integration Tests Fail

**Issue:** HTTP server not responding

**Solution:**
- Verify extension activation
- Check port 37842 availability
- Review integration test logs

### Coverage Upload Fails

**Issue:** Codecov token issues

**Solution:**
- Add `CODECOV_TOKEN` to repository secrets
- Or set workflow to `continue-on-error: true` for coverage

## Adding New Tests

When adding new test files:

1. Place in appropriate directory:
   - `tests/unit/` for unit tests
   - `tests/integration/` for integration tests
   - `tests/e2e/` for E2E tests

2. Follow naming convention: `*.test.js`

3. Tests will be automatically picked up by existing jobs

4. No workflow changes needed unless:
   - Adding new test type
   - Need different OS/environment
   - Require special dependencies

## Optimizations

Current optimizations:
- ✅ npm cache for faster dependency installation
- ✅ Parallel job execution (unit, integration, E2E)
- ✅ Matrix strategy for multi-OS E2E tests
- ✅ Path filters to skip irrelevant changes
- ✅ Artifact retention limits (7 days)

Future optimizations:
- 🚧 Test result caching
- 🚧 Cursor installation caching
- 🚧 Incremental test runs

## Status Badges

Add to your README:

```markdown
[![Test ACP Extension](https://github.com/jverre/opencursor/actions/workflows/test-acp-extension.yml/badge.svg)](https://github.com/jverre/opencursor/actions/workflows/test-acp-extension.yml)
```

## Manual Workflow Trigger

You can manually trigger the workflow:

1. Go to **Actions** tab
2. Select **Test ACP Extension**
3. Click **Run workflow**
4. Select branch
5. Click **Run workflow** button

## Notifications

Configure notifications for workflow failures:

1. Go to **Settings** → **Notifications**
2. Enable **Actions** notifications
3. Choose notification method (email, mobile)

## Security

Workflows run in isolated environments:
- No access to repository secrets unless explicitly granted
- Artifacts are private to repository
- PR workflows from forks have restricted permissions

## Cost Considerations

GitHub Actions provides free minutes:
- **Public repos:** Unlimited
- **Private repos:** 2000 minutes/month (Free tier)

Current workflow usage per run:
- Unit tests: ~2 minutes
- Integration tests: ~3 minutes
- E2E tests: ~30 minutes (2 OS × 15 min)
- **Total:** ~35 minutes per PR

## Support

For workflow issues:
- Check workflow logs in Actions tab
- Review artifact downloads for debugging
- See `cursor-acp-extension/tests/README.md` for test documentation
- Open issue with workflow run link
