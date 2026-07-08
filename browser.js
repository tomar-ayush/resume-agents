const { chromium } = require('patchright');

// One persistent Chrome context per user-data-dir.
// Shared between linkedin.js and workday.js so we don't launch a fresh
// browser per task.
const activeContexts = new Map();

async function getOrCreateBrowserContext({
  userDataDir,
  profileDirectory,
  executablePath,
  viewport = { width: 1440, height: 900 },
  log = () => {},
}) {
  const existing = activeContexts.get(userDataDir);
  if (existing && !existing.isClosed?.()) {
    log('reuse_browser_context', { userDataDir, profileDirectory });
    return existing;
  }

  log('launch_browser_context', { userDataDir, profileDirectory });
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    viewport,
    // Don't set `ignoreDefaultArgs: true` — that strips Playwright's own control
    // flags and the script can't drive the browser.
    // Strip only the specific defaults that hurt a real logged-in Chrome:
    //   --use-mock-keychain / --password-store=basic → bypass macOS Keychain
    //     → cookies encrypted with the real "Chrome Safe Storage" key can't be
    //     decrypted → sites appear logged out.
    //   --enable-automation → adds the "controlled by automation" banner.
    //   --no-sandbox → triggers the unsupported-flag banner.
    //   --disable-blink-features=AutomationControlled → patchright's stealth
    //     default that Chrome 128+ flags as unsupported. patchright already
    //     hides navigator.webdriver at the CDP/JS layer, so it's redundant.
    ignoreDefaultArgs: [
      '--enable-automation',
      '--no-sandbox',
      '--use-mock-keychain',
      '--password-store=basic',
      '--disable-blink-features=AutomationControlled',
    ],
    args: [
      `--profile-directory=${profileDirectory}`,
      '--no-default-browser-check',
      '--no-first-run',
    ],
    timeout: 60000,
  });

  context.on('close', () => activeContexts.delete(userDataDir));
  activeContexts.set(userDataDir, context);
  log('browser_launched_successfully', { userDataDir, profileDirectory });
  return context;
}

module.exports = { getOrCreateBrowserContext };
