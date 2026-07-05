const { chromium } = require('patchright');
const {
  CHROME_USER_DATA_DIR,
  CHROME_PROFILE_DIRECTORY,
  CHROME_EXECUTABLE_PATH,
  DEFAULT_TIMEOUT_MS,
  LINKEDIN_HOME_URL,
} = require('./config');

const USER_ACTION_HOLD_MS = 5 * 60 * 1000;
const MIN_GAP_BETWEEN_TASKS_MS = 20 * 1000;

const activeContexts = new Map();
let lastTaskFinishedAt = 0;

// --- logging ------------------------------------------------------------------

function logStep(step, details = {}) {
  console.log('[linkedin]', JSON.stringify({
    timestamp: new Date().toISOString(),
    step,
    ...details,
  }));
}

// --- browser lifecycle --------------------------------------------------------

async function getOrCreateBrowserContext(userDataDir, profileDirectory, executablePath) {
  const existing = activeContexts.get(userDataDir);
  if (existing && !existing.isClosed?.()) {
    logStep('reuse_browser_context', { userDataDir, profileDirectory });
    return existing;
  }

  logStep('launch_browser_context', { userDataDir, profileDirectory });
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    viewport: { width: 1440, height: 900 },
    // Do NOT set `ignoreDefaultArgs: true` — that strips Playwright's own control
    // flags (remote debugging pipe, etc.) and the script can't drive the browser.
    // Only strip the specific defaults that hurt a real logged-in Chrome session:
    //   --use-mock-keychain / --password-store=basic → bypass macOS Keychain
    //     → cookies encrypted with the real "Chrome Safe Storage" key can't be
    //     decrypted → LinkedIn appears logged out.
    //   --enable-automation → adds the "controlled by automation" banner.
    //   --no-sandbox → triggers the unsupported-flag banner.
    ignoreDefaultArgs: [
      '--enable-automation',
      '--no-sandbox',
      '--use-mock-keychain',
      '--password-store=basic',
      // patchright injects this as a stealth default, but Chrome 128+ flags it
      // as an "unsupported command-line flag" and shows a yellow banner — which
      // is itself a fingerprint tell. patchright already hides navigator.webdriver
      // at the CDP/JS layer, so dropping this flag is safe.
      '--disable-blink-features=AutomationControlled',
    ],
    args: [
      // NOTE: do NOT add `--disable-blink-features=AutomationControlled` here.
      // Chrome 128+ marks it as an unsupported flag and shows a yellow banner
      // ("You are using an unsupported command-line flag…"), which itself is a
      // detection tell. patchright already hides `navigator.webdriver` and the
      // other automation surfaces at the CDP/JS layer, so the flag is redundant.
      `--profile-directory=${profileDirectory}`,
      '--no-default-browser-check',
      '--no-first-run',
    ],
    timeout: 60000,
  });

  context.on('close', () => activeContexts.delete(userDataDir));
  activeContexts.set(userDataDir, context);
  logStep('browser_launched_successfully', { userDataDir, profileDirectory });
  return context;
}

// --- human-like helpers -------------------------------------------------------

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Jittered pause. Occasionally 3x longer to mimic distraction.
async function humanPause(min = 700, max = 1800) {
  const base = randInt(min, max);
  const dwell = Math.random() < 0.12 ? base * randInt(2, 4) : base;
  await sleep(dwell);
}

// Move the mouse to the element in 12–24 small steps, then hover a beat.
// Playwright's default click teleports the cursor; this looks much more natural.
async function humanMoveTo(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return false;
  const target = {
    x: box.x + box.width * (0.3 + Math.random() * 0.4),
    y: box.y + box.height * (0.3 + Math.random() * 0.4),
  };
  await page.mouse.move(target.x, target.y, { steps: randInt(12, 24) });
  await sleep(randInt(120, 380));
  return true;
}

async function humanClick(page, locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => { });
  await humanPause(300, 900);
  await humanMoveTo(page, locator);
  await locator.click({ delay: randInt(45, 130) });
}

// Type character by character with jittered delays.
// Occasionally pause longer (as if thinking mid-sentence) and very rarely
// insert a small typo + backspace to look human.
async function humanType(page, locator, text) {
  await locator.click({ delay: randInt(40, 110) });
  await humanPause(300, 700);

  const typos = 'abcdefghijklmnopqrstuvwxyz';
  for (const char of text) {
    if (Math.random() < 0.02) {
      const wrong = typos[randInt(0, typos.length - 1)];
      await page.keyboard.type(wrong, { delay: randInt(70, 160) });
      await sleep(randInt(180, 380));
      await page.keyboard.press('Backspace');
      await sleep(randInt(120, 260));
    }
    await page.keyboard.type(char, { delay: randInt(55, 175) });
    if (Math.random() < 0.06) await sleep(randInt(220, 700));
    if (char === ' ' && Math.random() < 0.15) await sleep(randInt(180, 520));
  }
}

// After landing on a profile, spend a beat "reading" — scroll a little,
// pause, scroll back. Cheap but goes a long way against timing heuristics.
async function humanReadPage(page) {
  await humanPause(1500, 3500);
  const down = randInt(200, 700);
  await page.mouse.wheel(0, down);
  await humanPause(900, 2200);
  if (Math.random() < 0.6) {
    await page.mouse.wheel(0, -Math.floor(down * (0.4 + Math.random() * 0.5)));
    await humanPause(600, 1400);
  }
}

// --- element resolvers --------------------------------------------------------

// Find a visible button in the top profile-actions area whose label matches.
// LinkedIn's DOM changes often, so we match on text + aria-label rather than
// pinning brittle class names.
async function findActionButton(page, label, { timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const wanted = label.toLowerCase();
  while (Date.now() < deadline) {
    const candidates = await page.locator('main button, main [role="button"]').all();
    for (const el of candidates) {
      const [text, aria] = await Promise.all([
        el.innerText().catch(() => ''),
        el.getAttribute('aria-label').catch(() => ''),
      ]);
      const combined = `${text} ${aria || ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
      // Exact-word match so "Follow" doesn't match "Following" and "Connect"
      // doesn't match "More actions… Connect" inside a hidden menu.
      const exact = new RegExp(`(^|\\W)${wanted}(\\W|$)`).test(combined);
      if (!exact) continue;
      if (!(await el.isVisible().catch(() => false))) continue;
      return el;
    }
    await sleep(500);
  }
  return null;
}

// Find a menu item inside an open More-actions dropdown.
async function findMenuItem(page, label, { timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const wanted = label.toLowerCase();
  while (Date.now() < deadline) {
    const items = await page.locator('[role="menuitem"], [role="button"], button, a').all();
    for (const el of items) {
      const [text, aria] = await Promise.all([
        el.innerText().catch(() => ''),
        el.getAttribute('aria-label').catch(() => ''),
      ]);
      const combined = `${text} ${aria || ''}`.toLowerCase();
      if (!combined.includes(wanted)) continue;
      if (!(await el.isVisible().catch(() => false))) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box || box.width < 5 || box.height < 5) continue;
      return el;
    }
    await sleep(400);
  }
  return null;
}

// --- state detection ----------------------------------------------------------

// Look at the top action row and decide what state the profile is in.
// The Follow / Following button shares the same componentkey — LinkedIn only
// swaps its visible label — so we distinguish them by text + aria-label here,
// not at click-time.
async function detectProfileState(page) {
  const connectBtn = page.locator('(//button[starts-with(@componentkey, "ConnectButtonurn")])[1]');
  const followWrapper = page.locator('(//button[starts-with(@componentkey, "FollowButtonurn")])[2]');
  const pendingBtn = page.locator('//button[.//span[text()="Pending"]]');
  const messageBtn = page.locator("(//a[contains(@href, '/messaging/compose/') or contains(., 'Message')])[2]");

  const [hasPending, hasConnect, hasFollowWrapper, hasMessage] = await Promise.all([
    pendingBtn.isVisible().catch(() => false),
    connectBtn.isVisible().catch(() => false),
    followWrapper.isVisible().catch(() => false),
    messageBtn.isVisible().catch(() => false),
  ]);

  if (hasPending) return { state: 'pending' };
  if (hasConnect) return { state: 'connectable_direct', connectBtn };

  if (hasFollowWrapper) {
    const [text, aria] = await Promise.all([
      followWrapper.innerText().catch(() => ''),
      followWrapper.getAttribute('aria-label').catch(() => ''),
    ]);
    const combined = `${text} ${aria || ''}`.toLowerCase();
    // "Following" (exact word) or "stop following <name>" means we're already following.
    // Plain "Follow" (no "ing") means we still need to click it.
    const isFollowing = /\bfollowing\b|stop following/.test(combined);
    logStep('follow_button_label', { text: text.trim(), aria: aria || null, isFollowing });
    return isFollowing
      ? { state: 'already_following' }
      : { state: 'connectable_via_more', followBtn: followWrapper };
  }

  if (hasMessage) return { state: 'already_connected' };
  return { state: 'unknown' };
}

// --- flow steps ---------------------------------------------------------------

async function openConnectModalDirect(page, connectBtn) {
  logStep('click_connect_direct');
  await humanClick(page, connectBtn);
}

async function openConnectModalViaMore(page, followBtn, { alreadyFollowing = false } = {}) {
  if (alreadyFollowing) {
    logStep('skip_follow_already_following');
  } else {
    logStep('click_follow');
    await humanClick(page, followBtn);
    await humanPause(1200, 2400);
  }

  const moreBtn = page.locator("(//button[.//span[text()='More']])[2]");
  await moreBtn.waitFor({ state: 'visible', timeout: 8000 });
  if (!(await moreBtn.isVisible().catch(() => false))) {
    throw new Error('More actions button not found after Follow.');
  }
  logStep('click_more');
  await humanClick(page, moreBtn);
  await humanPause(600, 1200);

  const connectItem = page.locator("//a[@role='menuitem' and starts-with(@componentkey, 'ConnectButtonstate')]");
  await connectItem.waitFor({ state: 'visible', timeout: 6000 });
  if (!(await connectItem.isVisible().catch(() => false))) {
    throw new Error('Connect item not found in More menu.');
  }
  logStep('click_connect_menu_item');
  await humanClick(page, connectItem);
}

async function clickAddNote(page) {
  const addNote = page.locator('button[aria-label="Add a note"]');
  await addNote.waitFor({ state: 'visible', timeout: 8000 });
  if (!(await addNote.isVisible().catch(() => false))) {
    throw new Error('"Add a note" button not found in Connect modal.');
  }
  logStep('click_add_note');
  await humanClick(page, addNote);
  await humanPause(500, 1100);
}

async function typeNoteHumanLike(page, note) {
  // LinkedIn has churned this class name several times; take the first visible
  // textarea inside the open dialog and fall back to id / name / aria-label.
  const field = page.locator(
    'div[role="dialog"] textarea, #custom-message, textarea[name="message"], textarea[aria-label*="note" i]'
  ).first();
  await field.waitFor({ state: 'visible', timeout: 10000 });
  logStep('type_note', { length: note.length });
  await humanType(page, field, note);
}

// Watch for either an "Invitation sent" toast or the modal disappearing.
async function waitForSendClicked(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastState = 'waiting_for_send';
  const watchdog = setInterval(() => {
    logStep('wait_watchdog', { remainingMs: Math.max(0, deadline - Date.now()), lastState });
  }, 30_000);

  try {
    while (Date.now() < deadline) {
      const toast = await page.locator(
        'text=/Invitation sent|Your invitation was sent|Request sent/i'
      ).first().isVisible({ timeout: 500 }).catch(() => false);

      if (toast) {
        logStep('invitation_confirmed');
        return { confirmed: true, timedOut: false, lastState: 'confirmed' };
      }

      const modalOpen = (await page.locator('div[role="dialog"]').count()) > 0;
      const nextState = modalOpen ? 'note_modal_open' : 'modal_closed';
      if (nextState !== lastState) {
        lastState = nextState;
        logStep('wait_state_update', { lastState });
      }

      // Modal closed without a toast → user probably cancelled or clicked away.
      if (!modalOpen && lastState === 'modal_closed') {
        await sleep(1500);
        const stillClosed = (await page.locator('div[role="dialog"]').count()) === 0;
        if (stillClosed) {
          return { confirmed: false, timedOut: false, lastState: 'modal_closed_no_toast' };
        }
      }

      await sleep(1500);
    }
  } finally {
    clearInterval(watchdog);
  }

  return { confirmed: false, timedOut: true, lastState };
}

// --- orchestration ------------------------------------------------------------

async function performConnectionTask(payload, updateResult) {
  const { message, linkedin_url, referral_name, referral_id } = payload;
  const attemptNo = Number(payload.attempt || 1);
  const maxAttempts = Number(payload.max_attempts || 1);

  logStep('task_started', {
    referral_id, attemptNo, maxAttempts, linkedin_url, referral_name,
    messageLength: message?.length || 0,
  });

  if (attemptNo > maxAttempts) {
    throw new Error(`Attempt ${attemptNo} exceeds max_attempts ${maxAttempts}`);
  }

  // Rate limit: ensure some gap between successive tasks so we're not
  // hammering LinkedIn back-to-back.
  const sinceLast = Date.now() - lastTaskFinishedAt;
  if (lastTaskFinishedAt && sinceLast < MIN_GAP_BETWEEN_TASKS_MS) {
    const wait = MIN_GAP_BETWEEN_TASKS_MS - sinceLast + randInt(0, 8000);
    logStep('rate_limit_wait', { waitMs: wait });
    await sleep(wait);
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

    const targetUrl = linkedin_url;
    logStep('navigate_to_profile', { referral_id, url: targetUrl });
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    await updateResult({ state: 'navigated', error: null });

    // Read the page like a human before doing anything.
    await humanReadPage(page);

    const profile = await detectProfileState(page);
    logStep('profile_state_detected', { referral_id, state: profile.state });

    if (profile.state === 'already_connected') {
      await updateResult({ state: 'already_connected', error: null });
      return;
    }
    if (profile.state === 'pending') {
      await updateResult({ state: 'already_pending', error: null });
      return;
    }

    if (profile.state === 'connectable_direct') {
      await openConnectModalDirect(page, profile.connectBtn);
    } else if (profile.state === 'connectable_via_more') {
      await openConnectModalViaMore(page, profile.followBtn);
    } else if (profile.state === 'already_following') {
      // Already following → skip the Follow click, go straight to More → Connect.
      await openConnectModalViaMore(page, null, { alreadyFollowing: true });
    } else {
      throw new Error('Could not find Connect or Follow button on the profile page.');
    }

    await updateResult({ state: 'connect_modal_opened', error: null });
    await humanPause(900, 1800);

    await clickAddNote(page);
    await updateResult({ state: 'note_modal_opened', error: null });

    const noteText = message || `Hi ${referral_name || 'there'} — I'd love to connect.`;
    await typeNoteHumanLike(page, noteText);
    await updateResult({ state: 'note_typed', error: null });

    await updateResult({ state: 'waiting_for_user_action', error: null });
    logStep('waiting_for_user_send_click', { referral_id });

    const waitResult = await waitForSendClicked(page, USER_ACTION_HOLD_MS);
    if (waitResult.confirmed) {
      await updateResult({ state: 'completed', error: null });
      logStep('task_completed', { referral_id });
    } else if (waitResult.timedOut) {
      await updateResult({ state: 'timed_out_waiting_for_user_action', error: null });
      logStep('task_timed_out', { referral_id });
    } else {
      await updateResult({ state: 'closed_without_send', error: null });
      logStep('task_closed_without_send', { referral_id });
    }
  } catch (error) {
    logStep('task_failed', { referral_id, error: error.message });
    await updateResult({ state: 'failed', error: error.message });
    throw error;
  } finally {
    lastTaskFinishedAt = Date.now();
  }
}

module.exports = {
  performConnectionTask,
};
