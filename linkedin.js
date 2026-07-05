const { chromium } = require('patchright');
const {
  CHROME_USER_DATA_DIR,
  CHROME_PROFILE_DIRECTORY,
  CHROME_EXECUTABLE_PATH,
  DEFAULT_TIMEOUT_MS,
  LINKEDIN_HOME_URL,
} = require('./config');

const USER_ACTION_HOLD_MS = 5 * 60 * 1000;
const activeContexts = new Map();

function logStep(step, details = {}) {
  console.log('[linkedin]', JSON.stringify({
    timestamp: new Date().toISOString(),
    step,
    ...details,
  }));
}

async function getOrCreateBrowserContext(userDataDir, profileDirectory, executablePath) {
  const existing = activeContexts.get(userDataDir);
  if (existing && !existing.isClosed?.()) {
    logStep('reuse_browser_context', { userDataDir, profileDirectory });
    return existing;
  }

  logStep('launch_browser_context', { userDataDir, profileDirectory });
  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: false,
      viewport: { width: 1920, height: 1080 },
      // Selectively drop the "controlled by automated test software" flag.
      // Do NOT pass `true` here — that strips Playwright's own control flags
      // (remote debugging pipe, etc.) and the script can no longer drive the browser.
      // These Playwright defaults break real Chrome sessions:
      //   --use-mock-keychain / --password-store=basic → bypass macOS Keychain
      //     → cookies encrypted with the real "Chrome Safe Storage" key can't be
      //     decrypted → LinkedIn (and every other site) appears logged out.
      //   --enable-automation → adds the "controlled by automation" banner.
      //   --no-sandbox → triggers the unsupported-flag banner.
      ignoreDefaultArgs: [
        '--enable-automation',
        '--no-sandbox',
        '--use-mock-keychain',
        '--password-store=basic',
      ],
      args: [
        '--disable-blink-features=AutomationControlled',
        `--profile-directory=${profileDirectory}`,
        '--no-default-browser-check',
        '--no-first-run',
      ],
      timeout: 60000,
    });

    logStep('browser_launched_successfully', { userDataDir, profileDirectory });
    context.on('close', () => activeContexts.delete(userDataDir));
    activeContexts.set(userDataDir, context);
    return context;
  } catch (error) {
    logStep('browser_launch_failed', { error: error.message });
    throw error;
  }
}


async function clickVisible(page, selectors, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.count() > 0 && (await locator.isVisible({ timeout: 1000 }).catch(() => false))) {
          logStep('click_visible', { selector });
          await locator.click();
          return true;
        }
      } catch (_error) {
        continue;
      }
    }

    await page.waitForTimeout(1000);
  }

  return false;
}

async function clickByLabel(page, labels, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const handles = await page.locator('button, a, [role="button"]').elementHandles();
      for (const handle of handles) {
        const text = await handle.evaluate((element) => (element.textContent || '').replace(/\s+/g, ' ').trim());
        const ariaLabel = await handle.evaluate((element) => (element.getAttribute('aria-label') || '').trim());
        const title = await handle.evaluate((element) => (element.getAttribute('title') || '').trim());
        const combined = `${text} ${ariaLabel} ${title}`.toLowerCase();
        const matched = labels.some((label) => combined.includes(label.toLowerCase()));
        if (matched) {
          const box = await handle.boundingBox();
          if (box && box.width > 0 && box.height > 0) {
            logStep('click_by_label', { labels, text });
            await handle.click();
            return true;
          }
        }
      }
    } catch (_error) {
      logStep('click_by_label_error', { error: _error.message });
    }

    await page.waitForTimeout(1000);
  }

  return false;
}

async function fillNote(page, message) {
  const noteField = page.locator('textarea[name="message"], textarea[aria-label*="note" i], textarea').first();

  if (await noteField.count() > 0) {
    try {
      logStep('fill_note', { messageLength: message?.length || 0 });
      await noteField.fill(message || '');
      return true;
    } catch (_error) {
      logStep('fill_note_error', { error: _error.message });
      return false;
    }
  }

  return false;
}

async function waitForConnectionConfirmation(page, timeoutMs = USER_ACTION_HOLD_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastState = 'waiting';
  const watchdog = setInterval(() => {
    logStep('wait_watchdog', { remainingMs: Math.max(0, deadline - Date.now()), lastState });
  }, 30_000);

  try {
    while (Date.now() < deadline) {
      try {
        const confirmation = page.locator('text=/Invitation sent|Request sent|Your request was sent|Sent/i').first();
        if (await confirmation.count() > 0 && (await confirmation.isVisible({ timeout: 1000 }).catch(() => false))) {
          logStep('connection_confirmed', { lastState });
          return { confirmed: true, timedOut: false, lastState };
        }

        const dialogCount = await page.locator('div[role="dialog"]').count();
        const connectButtonStillVisible = await page.locator('button, a, [role="button"]').filter({ hasText: 'Connect' }).first().isVisible({ timeout: 500 }).catch(() => false);
        const followButtonStillVisible = await page.locator('button, a, [role="button"]').filter({ hasText: 'Follow' }).first().isVisible({ timeout: 500 }).catch(() => false);

        const nextState = dialogCount > 0 ? 'dialog_open' : (connectButtonStillVisible || followButtonStillVisible ? 'buttons_visible' : 'waiting');
        if (nextState !== lastState) {
          lastState = nextState;
          logStep('wait_state_update', { lastState });
        }

        await page.waitForTimeout(2000);
      } catch (_error) {
        logStep('wait_iteration_error', { error: _error.message });
        await page.waitForTimeout(2000);
      }
    }
  } finally {
    clearInterval(watchdog);
  }

  return { confirmed: false, timedOut: true, lastState };
}

async function performConnectionTask(payload, updateResult) {
  const { message, linkedin_url, referral_name, referral_id } = payload;
  const attemptNo = Number(payload.attempt || 1);
  const maxAttempts = Number(payload.max_attempts || 1);

  logStep('task_started', {
    referral_id,
    attemptNo,
    maxAttempts,
    linkedin_url,
    referral_name,
    messageLength: message?.length || 0,
  });

  if (attemptNo > maxAttempts) {
    throw new Error(`Attempt ${attemptNo} exceeds max_attempts ${maxAttempts}`);
  }

  await updateResult({ state: 'started', error: null });

  const browser = await getOrCreateBrowserContext(
    CHROME_USER_DATA_DIR,
    CHROME_PROFILE_DIRECTORY,
    CHROME_EXECUTABLE_PATH,
  );

  try {
    if (!browser || browser.isClosed?.()) {
      throw new Error('Browser context was not created successfully.');
    }

    let page = browser.pages()[0];
    if (!page) {
      logStep('create_new_page', { referral_id });
      page = await browser.newPage();
    }

    logStep('navigate_to_profile', { referral_id, url: linkedin_url || LINKEDIN_HOME_URL });
    await page.goto(linkedin_url || LINKEDIN_HOME_URL, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await page.waitForTimeout(5000);

    await updateResult({ state: 'navigated', error: null });

    const connectButtonVisible = await clickByLabel(page, ['Connect'], 5000);
    const followButtonVisible = await clickByLabel(page, ['Follow'], 5000);

    if (connectButtonVisible) {
      logStep('connect_flow', { referral_id, action: 'connect' });
      await clickByLabel(page, ['Connect'], 5000);
      await updateResult({ state: 'connect_modal_opened', error: null });
    } else if (followButtonVisible) {
      logStep('connect_flow', { referral_id, action: 'follow_then_connect' });
      await clickByLabel(page, ['Follow'], 5000);
      await updateResult({ state: 'followed', error: null });
      await page.waitForTimeout(2000);

      await clickVisible(page, [
        'button[aria-label*="More" i]',
        'button:has-text("More")',
        '[aria-label="More actions"]',
      ]);

      await page.waitForTimeout(1000);
      await clickByLabel(page, ['Connect'], 5000);
      await updateResult({ state: 'connect_modal_opened', error: null });
    } else {
      throw new Error('Neither Connect nor Follow button was found on the profile page.');
    }

    const noteText = message || `Hi ${referral_name || 'there'} — I’d love to connect.`;
    const noteAdded = await fillNote(page, noteText);
    if (noteAdded) {
      await updateResult({ state: 'note_added', error: null });
    }

    await updateResult({ state: 'waiting_for_user_action', error: null });
    logStep('waiting_for_user_action', { referral_id });

    const waitResult = await waitForConnectionConfirmation(page, USER_ACTION_HOLD_MS);
    if (waitResult.confirmed) {
      await updateResult({ state: 'completed', error: null });
      logStep('task_completed', { referral_id });
    } else if (waitResult.timedOut) {
      await updateResult({ state: 'timed_out_waiting_for_user_action', error: null });
      logStep('task_timed_out', { referral_id });
    } else {
      await updateResult({ state: 'waiting_for_user_action', error: null });
      logStep('task_left_waiting', { referral_id });
    }
  } catch (error) {
    logStep('task_failed', { referral_id, error: error.message });
    await updateResult({ state: 'failed', error: error.message });
    throw error;
  }
}

module.exports = {
  performConnectionTask,
};
