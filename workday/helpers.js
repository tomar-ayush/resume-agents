// Shared helpers for the Workday application assistant.
//
// Every page module imports from here so the resilience / selector logic lives
// in exactly one place. Nothing in this file knows about specific pages.

// --- logging ----------------------------------------------------------------

// Central structured logger. Every page module calls `logStep` so all activity
// flows through one channel and is easy to grep / debug.
function logStep(step, details = {}) {
  console.log('[workday]', JSON.stringify({
    timestamp: new Date().toISOString(),
    step,
    ...details,
  }));
}

// --- resilience helpers ------------------------------------------------------

// Run `fn` and swallow any exception. If it throws we log and return null so
// the rest of the page keeps trying. Use this to isolate every field / section
// on a page — one bad selector never aborts the whole autofill for that page.
async function guarded(label, fn) {
  try {
    return await fn();
  } catch (error) {
    logStep('field_error', { label, error: error.message });
    return null;
  }
}

// --- selector helpers --------------------------------------------------------

async function isVisible(page, selector, timeoutMs = 300) {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: timeoutMs });
    return true;
  } catch (_) {
    return false;
  }
}

async function safeClick(page, selector, timeoutMs = 400) {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: timeoutMs });
    // scroll:'nearest' avoids the jarring full-viewport jump Playwright does by
    // default (it centers the element). On short modals that jump is unwanted.
    await el.click({ delay: 60, scroll: 'nearest' });
    return true;
  } catch (_) {
    return false;
  }
}

// Fill only if visible AND currently empty (don't clobber the user's edits).
async function safeFill(page, selector, value) {
  if (value === undefined || value === null || value === '') return false;
  try {
    const el = page.locator(selector).first();
    if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) return false;
    const current = await el.inputValue().catch(() => '');
    if (current && current.trim() !== '') return false;
    // scroll:'nearest' keeps the modal from jumping when filling fields.
    await el.fill(String(value), { scroll: 'nearest' });
    return true;
  } catch (_) {
    return false;
  }
}

// Workday dropdown pattern: click trigger, type option, Enter.
async function safeTypeahead(page, triggerSelector, value) {
  if (!value) return false;
  try {
    const el = page.locator(triggerSelector).first();
    if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) return false;
    // Skip if the dropdown already shows a chosen value (not the placeholder).
    const chosen = (await el.innerText().catch(() => '')).trim().toLowerCase();
    if (chosen && !/select one|choose/i.test(chosen) && chosen !== '') return false;
    await el.click();
    await page.waitForTimeout(200);
    await page.keyboard.type(String(value), { delay: 70 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    return true;
  } catch (_) {
    return false;
  }
}

// --- label-based fallbacks ---------------------------------------------------

// Find a Workday `formField-*` container by its visible label text and return
// its inner <input> / <textarea>. Tenants rename their private data-automation-ids
// but the visible labels stay the same — this is the resilient fallback path.
function labelledFormField(page, labelPattern) {
  return page.locator('div[data-automation-id^="formField-"]', { hasText: labelPattern }).first();
}

async function fillByLabel(page, labelPattern, value) {
  if (!value) return false;
  try {
    const field = labelledFormField(page, labelPattern);
    if (!(await field.isVisible({ timeout: 300 }).catch(() => false))) return false;
    const input = field.locator('input, textarea').first();
    if (!(await input.isVisible({ timeout: 300 }).catch(() => false))) return false;
    const current = await input.inputValue().catch(() => '');
    if (current && current.trim()) return false;
    await input.fill(String(value));
    return true;
  } catch (_) {
    return false;
  }
}

async function typeaheadByLabel(page, labelPattern, value) {
  if (!value) return false;
  try {
    const field = labelledFormField(page, labelPattern);
    if (!(await field.isVisible({ timeout: 300 }).catch(() => false))) return false;
    const trigger = field.locator('button').first();
    if (!(await trigger.isVisible({ timeout: 300 }).catch(() => false))) return false;
    const chosen = (await trigger.innerText().catch(() => '')).trim().toLowerCase();
    if (chosen && !/select one|choose/i.test(chosen) && chosen !== '') return false;
    await trigger.click();
    await page.waitForTimeout(200);
    await page.keyboard.type(String(value), { delay: 70 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    return true;
  } catch (_) {
    return false;
  }
}

// Try selector-first, fall back to label lookup. Returns true if either worked.
async function fillFieldWithFallback(page, selector, labelPattern, value) {
  if (await safeFill(page, selector, value)) return true;
  return await fillByLabel(page, labelPattern, value);
}

async function typeaheadWithFallback(page, triggerSelector, labelPattern, value) {
  if (await safeTypeahead(page, triggerSelector, value)) return true;
  return await typeaheadByLabel(page, labelPattern, value);
}

// Workday's phone number field expects just the LOCAL digits — the country
// code lives in a separate dropdown (`+91`, `+1`, etc). If the profile stores
// the number with a leading "+countryCode" prefix (a natural way to write it),
// strip that prefix here so the field doesn't error on submit.
function normalizePhoneNumber(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s.startsWith('+')) return s;
  return s.replace(/^\+\d{1,3}[-\s]?/, '');
}

// Dumps every formField-* container inside the page with its label and the
// automation-ids of its input / textarea / button children. Run once per page
// type when we detect a page but don't recognise its fields.
async function debugFormFields(page) {
  try {
    return await page.evaluate(() => {
      const containers = document.querySelectorAll('div[data-automation-id^="formField-"]');
      const result = [];
      for (const c of containers) {
        const rect = c.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const label = (c.querySelector('label')?.textContent || '').trim();
        const containerId = c.getAttribute('data-automation-id');
        const inner = [];
        for (const n of c.querySelectorAll('[data-automation-id]')) {
          const id = n.getAttribute('data-automation-id');
          if (id === containerId) continue;
          inner.push({ tag: n.tagName.toLowerCase(), id });
          if (inner.length >= 4) break;
        }
        result.push({ container: containerId, label, inner });
        if (result.length >= 30) break;
      }
      return result;
    });
  } catch (_) {
    return [];
  }
}

// Dumps formField-* containers scoped to a specific group (e.g. the Work
// Experience group after clicking "Add"). Used to learn a tenant's exact field
// selectors for sections that are collapsed until expanded.
async function debugFormFieldsInGroup(page, groupSelector) {
  try {
    return await page.evaluate((sel) => {
      const group = document.querySelector(sel);
      if (!group) return [];
      const containers = group.querySelectorAll('div[data-automation-id^="formField-"]');
      const result = [];
      for (const c of containers) {
        const rect = c.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const label = (c.querySelector('label')?.textContent || '').trim();
        const containerId = c.getAttribute('data-automation-id');
        const inner = [];
        for (const n of c.querySelectorAll('[data-automation-id]')) {
          const id = n.getAttribute('data-automation-id');
          if (id === containerId) continue;
          inner.push({ tag: n.tagName.toLowerCase(), id });
          if (inner.length >= 4) break;
        }
        result.push({ container: containerId, label, inner });
      }
      return result;
    }, groupSelector);
  } catch (_) {
    return [];
  }
}

// When detectPage returns 'unknown', dump the visible data-automation-ids so
// we can learn what markers this tenant uses.
async function debugUnknownPage(page) {
  const url = page.url();
  let ids = [];
  try {
    FormFieldsInGroup,
    debug
    ids = await page.evaluate(() => {
      const nodes = document.querySelectorAll('[data-automation-id]');
      const seen = new Set();
      for (const n of nodes) {
        const rect = n.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          seen.add(n.getAttribute('data-automation-id'));
        }
        if (seen.size >= 40) break;
      }
      return Array.from(seen);
    });
  } catch (_) { /* ignore */ }
  logStep('unknown_page_debug', { url, visibleAutomationIds: ids });
}

module.exports = {
  logStep,
  guarded,
  isVisible,
  safeClick,
  safeFill,
  safeTypeahead,
  labelledFormField,
  fillByLabel,
  typeaheadByLabel,
  fillFieldWithFallback,
  typeaheadWithFallback,
  normalizePhoneNumber,
  debugFormFields,
  debugUnknownPage,
};
