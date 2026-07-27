# Job-Application Automation (LinkedIn + Workday)

A small Node/Express service that drives your **real logged-in Chrome profile** (via [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright), a stealth-patched Playwright) to automate two flows:

1. **LinkedIn connection requests** — open a profile, send a connect request with a custom note, and wait for **you** to click **Send** manually.
2. **Workday job applications** — open a job URL, autofill My Information / My Experience (work history, education, skills, resume, websites), and wait for **you** to handle auth (login/OTP) and the final **Save & Continue / Submit**.

Both flows use your real Chrome cookies so the sites treat the session like a normal browser — no headless flags, no automation banners, no separate login. Human-in-the-loop steps (LinkedIn Send, Workday auth + final submit) are left to you on purpose, keeping the flow reviewable before anything leaves your account.

---

## Demo Video

[![Watch the video](https://i.sstatic.net/Vp2cE.png)](https://youtu.be/4eCcbdr109k)

---

## How it works

1. Copy your existing Chrome user-data-dir (with your real logged-in cookies) into a dedicated automation directory once.
2. The server launches Chrome pointed at that copy via patchright, sharing one persistent context across tasks.
3. **LinkedIn**: navigate to the profile, find Connect (or Follow → More → Connect), open the note modal, type your message character-by-character, then hand over for you to click Send.
4. **Workday**: navigate to the job URL, run an assist loop that detects the current page and best-effort fills its fields, polling every 2s. You handle login/OTP and the final submit.

Because the automation runs in its own user-data-dir, your daily Chrome can stay open while the script runs.

---

## Architecture

```
index.js                 Express server: /run-task (LinkedIn), /run-workday-task (Workday)
  ├─ linkedin.js         LinkedIn connect flow (human clicks Send)
  ├─ workday/index.js    Workday orchestrator: launch → navigate → assistLoop
  │   └─ workday/loop.js Polls, detects page, runs autofillers, memoizes filled pages
  │   └─ workday/pages/  Per-page autofillers (my_information, my_experience, …)
  ├─ browser.js          Shared patchright launchPersistentContext (used by both flows)
  ├─ cloudflareTunnel.js Optional public tunnel for the local server
  └─ config.js           Chrome paths + timeouts
```

### Completion reporting (callback, not polling)

There is **no local job-state store and no polling endpoint**. When a task finishes (or fails), the server POSTs a callback to the `callback_url` you supplied in the request:

```json
{ "state": "linkedin_completed", "token": "<callback_token>", "task_id": "abc" }
```

Platform-namespaced `state` values:

| Flow     | Success            | Failure           |
|----------|--------------------|-------------------|
| LinkedIn | `linkedin_completed` | `linkedin_failed`  |
| Workday  | `workday_completed`  | `workday_failed`   |

- LinkedIn callback body includes `task_id` (echoed from the request).
- Workday callback URL already embeds `task_id` in its path (`/{task_id}/callback`), so the body is just `{ state, token, error? }`.

A callback failure is logged but never throws — it must not break task bookkeeping.

---

## Prerequisites

- macOS (this guide is Mac-specific; other OSes work but paths differ)
- Node.js 18+
- Google Chrome installed and already logged into LinkedIn / the Workday tenant in some profile
- `cloudflared` (optional, only if you want the public tunnel)

Check versions:

```bash
node --version
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --version
```

---

## One-time setup

### 1. Find your Chrome executable path

On macOS the default install location is:

```
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

If you use Chrome Beta / Canary / Chrome for Testing, adjust accordingly. To confirm, open Chrome and go to `chrome://version` — copy the value shown next to **Executable Path**.

### 2. Find which Chrome profile you're logged into the sites with

Open your normal Chrome (the one where you're already logged in) and visit `chrome://version`. Copy the value next to **Profile Path**. It will look like:

```
/Users/<you>/Library/Application Support/Google/Chrome/Profile 1
```

The last segment (`Profile 1`, `Default`, `Profile 3`, …) is the profile directory name. Remember it.

### 3. Fully quit Chrome before copying

**Do not skip this step.** If Chrome is running, its `Cookies` SQLite is locked and the copy will get a stale or empty snapshot — you'll appear logged out.

```bash
osascript -e 'quit app "Google Chrome"'
sleep 3
pgrep -fl "Google Chrome" || echo "chrome closed"
```

Only proceed once it prints `chrome closed`.

### 4. Copy your profile into a dedicated automation directory

Replace `Profile 1` with your profile name from step 2 if different.

```bash
rm -rf ~/chrome-automation
mkdir -p ~/chrome-automation
cp "/Users/$USER/Library/Application Support/Google/Chrome/Local State" ~/chrome-automation/
cp -R "/Users/$USER/Library/Application Support/Google/Chrome/Profile 1" ~/chrome-automation/
touch ~/chrome-automation/"First Run"
```

Why each piece matters:
- `Local State` (at the user-data-dir root) holds the encrypted key material used to decrypt cookies. Without it Chrome creates a new key → your session cookies are unreadable → logged out.
- `Profile 1/` holds cookies, history, preferences.
- `First Run` sentinel skips the first-launch welcome tour.

### 5. Verify the copy has real data

```bash
stat -f "%z %N" ~/chrome-automation/"Profile 1"/Cookies
sqlite3 ~/chrome-automation/"Profile 1"/Cookies \
  "SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%linkedin%';"
```

You should see a Cookies file of at least a few tens of KB and a LinkedIn cookie count above 0. If the count is 0, the source profile isn't logged into LinkedIn — check that you copied the right one.

### 6. Configure paths

Edit `config.js`:

```js
module.exports = {
  CHROME_USER_DATA_DIR: '/Users/<you>/chrome-automation',
  CHROME_PROFILE_DIRECTORY: 'Profile 1',
  CHROME_EXECUTABLE_PATH: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  LINKEDIN_HOME_URL: 'https://www.linkedin.com',
  DEFAULT_TIMEOUT_MS: 600000,
};
```

### 7. Install dependencies

```bash
npm install
```

---

## Running

```bash
npm start
```

Server listens on `http://localhost:3000`.
If `cloudflared` is installed and not disabled, the app also starts a Quick Tunnel and prints the public URL.

Disable the tunnel with `DISABLE_CLOUDFLARE_TUNNEL=1 npm start`, or set `ENABLE_CLOUDFLARE_TUNNEL=false` in `index.js`.

### LinkedIn task

```bash
curl -X POST http://localhost:3000/run-task \
  -H "Content-Type: application/json" \
  -d '{
    "referral_id": "test-1",
    "task_id": "task-abc",
    "linkedin_url": "https://www.linkedin.com/in/<username>/",
    "referral_name": "Alice",
    "message": "Hi Alice — I liked your post about X and wanted to connect.",
    "callback_url": "https://orchestrator.example.com/task-abc/callback",
    "callback_token": "secret-token"
  }'
```

The automation Chrome window opens, navigates to the profile, opens the connect modal, and types your note. It then waits up to 5 minutes for **you** to click **Send** in the modal, and finally POSTs `linkedin_completed` (or `linkedin_failed`) to `callback_url`.

### Workday task

```bash
curl -X POST http://localhost:3005/run-workday-task \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "task-xyz",
    "job_url": "https://jobs.example.com/apply/123",
    "resume_url": "https://<presigned-url>/original_resume.pdf",
    "callback_url": "https://orchestrator.example.com/task-xyz/callback",
    "callback_token": "secret-token"
  }'
```

Candidate data (name, education, skills, websites, etc.) is read from `information.js` locally — only the resume is downloaded from the presigned `resume_url` into `resources/`. The assist loop fills fields best-effort; you handle login/OTP and the final submit. On finish it POSTs `workday_completed` (or `workday_failed`) to `callback_url`.

---

## First-launch keychain prompt

The very first time the automation Chrome tries to decrypt your cookies, macOS may show:

> "Google Chrome wants to use your confidential information stored in 'Chrome Safe Storage' in your keychain."

Click **Always Allow**. If you pick "Allow" you'll be prompted every launch. If the prompt never appears, you likely already granted access previously — that's fine, decryption just works silently.

---

## Troubleshooting

### Sites show the auth wall / logged out

- The copy grabbed a locked snapshot because Chrome was still running. Redo steps 3–5.
- The `Cookies` file in `~/chrome-automation/Profile 1/` is under ~100 KB. That's near-empty; earlier launches with broken flags may have pruned the cookies. Redo the copy from a good source.
- `Local State` was not copied. Cookies encrypted at rest cannot be decrypted without it.
- Wrong profile — the source profile isn't the one logged in. Recheck via `chrome://version` in your daily Chrome.

### "You are using an unsupported command-line flag: --no-sandbox"

patchright adds `--no-sandbox` by default. It is in the `ignoreDefaultArgs` list inside `browser.js` (shared launcher). If you see the banner, confirm you're running the latest version and that the process actually restarted.

### Automation window opens but is `about:blank` with a fresh, logged-out session

You launched the automation Chrome once while `--use-mock-keychain` was still in the default args, which caused Chrome to delete undecryptable cookies. Redo the copy from your real profile (steps 3–5) and launch again — the shared launcher already suppresses the mock-keychain flag.

### `Chrome` refuses to launch / says the profile is in use

You have your daily Chrome running against the same user-data-dir. Since the automation uses its own dir (`~/chrome-automation`), this shouldn't happen. If it does, check that `CHROME_USER_DATA_DIR` in `config.js` doesn't point at your real Chrome directory.

### Connect / Follow button not found (LinkedIn)

LinkedIn's DOM changes. Open the profile manually and look at what buttons are actually there. If the person is already connected, "Connect" won't exist — the script fails cleanly and POSTs `linkedin_failed`.

### Workday fields not filling

The assist loop logs every step as `[workday] {"step": ...}`. Watch the console for `skill_option_clicked`, `resume_uploaded`, `websites_filled`, etc. The loop memoizes filled pages in memory, so it won't re-fill a page it already completed (this resets on server restart).

### Verifying patchright launched Chrome correctly

Open `chrome://version` in the automation window. `Command Line` should be long (a hundred+ chars) and include `--user-data-dir=/Users/<you>/chrome-automation` and `--profile-directory=Profile 1`. `Profile Path` should point inside the automation dir. If it doesn't, the script isn't actually driving that window.

---

## Rate-limit safety notes

LinkedIn detection is behavioural more than technical — the biggest signals are volume and timing, not fingerprints.

- Keep connection requests under ~15–20/day, spread across hours, not bursts.
- Don't run this on the same account you use for scraping / search-heavy work.
- The final Send / Submit click is manual on purpose. Don't automate it — that's the boundary between "power user" and "bot."
- If a site ever prompts a captcha or "unusual activity" check, stop for at least 24h before running again.
