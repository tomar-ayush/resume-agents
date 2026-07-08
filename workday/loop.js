// Assist loop: polls the page every few seconds, detects which page we're on,
// and runs that page's autofillers. Also auto-detects when the user (or the
// assistant) clicks "Save & Continue" / "Submit" so we can advance state and
// re-run autofill on the next page.
//
// Design principles:
//   * NOT autopilot. Every field is best-effort; the user reviews and clicks
//     "Save & Continue" themselves.
//   * Each page is an independent unit. If one page fails to autofill, the loop
//     still runs autofill for the NEXT page when the user navigates there.
//   * Each FIELD inside a page is also independent — one bad field does not
//     stop the rest of that page's fields (handled inside each page module).

const {
  logStep,
  debugFormFields,
  debugUnknownPage,
} = require('./helpers');
const { detectPage } = require('./detect');
const { getPageModule, FORM_PAGES } = require('./pages');

const POLL_INTERVAL_MS = 2000;
const MAX_SESSION_MS = 45 * 60 * 1000;
const AUTOFILL_COOLDOWN_MS = 4000;

// Selectors that count as a "submit / advance" click. When one of these
// disappears after being present (or the page signature changes), we treat the
// page as advanced and re-run autofill on whatever comes next.
const SUBMIT_SELECTORS = [
  'button[data-automation-id="saveAndContinueButton"]',
  'button[data-automation-id="submitApplicationButton"]',
  'button[data-automation-id="applyButton"]',
  'button[data-automation-id="nextButton"]',
  'button[data-automation-id="continueButton"]',
];

// Returns true if any submit/advance button is currently visible.
async function isSubmitVisible(page) {
  for (const sel of SUBMIT_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 200 }).catch(() => false)) return true;
    } catch (_) { /* ignore */ }
  }
  return false;
}

// Runs the autofillers for a detected page. Each page module already guards its
// own fields, so a failure here is logged but never stops the outer loop.
async function runAutofillForPage(pageType, page, profile) {
  const mod = getPageModule(pageType);
  if (!mod) {
    logStep('no_page_module', { pageType });
    return;
  }
  logStep('autofill_start', {
    pageType,
    autofillers: mod.autofillers.map((a) => a.name),
  });
  await mod.autofill(page, profile);
  logStep('autofill_done', { pageType });
}

async function assistLoop(page, profile, updateResult) {
  let lastSignature = null;
  let lastAutofillAt = 0;
  let lastUnknownLogAt = 0;
  let lastSubmitVisible = false;
  const dumpedForPage = new Set(); // pageType where we've already dumped form fields
  const filledPages = new Set();   // pageType whose autofill has already run once
  const inProgress = { flag: false };
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_SESSION_MS) {
    if (page.isClosed()) {
      logStep('page_closed_stopping_loop');
      break;
    }
    if (inProgress.flag) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    let pageType = 'unknown';
    try {
      pageType = await detectPage(page);
    } catch (error) {
      logStep('detect_error', { error: error.message });
    }

    if (pageType === 'confirmation') {
      logStep('confirmation_detected');
      await updateResult({ state: 'completed', error: null });
      return { confirmed: true };
    }

    if (pageType === 'unknown') {
      if (Date.now() - lastUnknownLogAt > 10_000) {
        await debugUnknownPage(page);
        lastUnknownLogAt = Date.now();
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    const signature = `${pageType}@${page.url()}`;
    const signatureChanged = signature !== lastSignature;

    // Auto-detect submit click: a submit/advance button was visible last tick
    // and is now gone (clicked) → the user advanced. Force a re-autofill on the
    // next detected page even if the signature hasn't changed yet.
    const submitVisibleNow = await isSubmitVisible(page).catch(() => false);
    const submitClicked = lastSubmitVisible && !submitVisibleNow;
    if (submitClicked) {
      logStep('submit_click_detected', { pageType, signature });
      lastSignature = null; // reset so the next page re-triggers autofill
      lastSubmitVisible = submitVisibleNow;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    lastSubmitVisible = submitVisibleNow;

    const cooldownExpired = Date.now() - lastAutofillAt > 30_000;
    // Only re-run autofill if the page is new, the signature changed, the user
    // advanced via a submit click, OR the 30s cooldown expired AND we haven't
    // already filled this page. Once a page is filled we stop re-firing it, so
    // the loop doesn't endlessly re-type into fields (which caused the
    // scroll-up/down loop on My Experience).
    const shouldFill = signatureChanged || submitClicked || (!filledPages.has(pageType) && (signatureChanged || cooldownExpired));

    if (shouldFill) {
      inProgress.flag = true;
      try {
        logStep('page_detected', { pageType, url: page.url(), signatureChanged });
        await updateResult({ state: `on_${pageType}`, error: null });

        // First time we see a form page, dump the visible form-field structure
        // so we can identify the tenant's exact selectors when autofill misses.
        if (FORM_PAGES.has(pageType) && !dumpedForPage.has(pageType)) {
          dumpedForPage.add(pageType);
          const fields = await debugFormFields(page);
          logStep('form_fields_dump', { pageType, count: fields.length, fields });
        }

        // Per-page try/catch: a failure here NEVER stops the outer loop.
        try {
          await runAutofillForPage(pageType, page, profile);
          await updateResult({ state: `${pageType}_autofilled`, error: null });
        } catch (error) {
          logStep('page_autofill_error', { pageType, error: error.message });
          await updateResult({ state: `${pageType}_autofill_failed`, error: error.message });
        }
        filledPages.add(pageType);
        lastSignature = signature;
        lastAutofillAt = Date.now();
        await new Promise((r) => setTimeout(r, AUTOFILL_COOLDOWN_MS));
      } finally {
        inProgress.flag = false;
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  logStep('assist_loop_ended', { reason: page.isClosed() ? 'page_closed' : 'timeout' });
  return { confirmed: false, timedOut: Date.now() - startedAt >= MAX_SESSION_MS };
}

module.exports = { assistLoop, isSubmitVisible, SUBMIT_SELECTORS };
