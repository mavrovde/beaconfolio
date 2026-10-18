# LinkedIn Scraper Workflow

Extracts a LinkedIn profile into structured JSON (`profile_data.json`).

**v4** reads LinkedIn's internal **Voyager API** (clean JSON) instead of scraping the
page DOM — LinkedIn now serves obfuscated, hashed CSS class names that make DOM
scraping unreliable. The API approach returns complete, un-capped lists.

## 🚀 Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure** — create `.env` in this directory:
   ```ini
   LINKEDIN_EMAIL=your_email@example.com
   LINKEDIN_PASSWORD=your_password
   PROFILE_URL=https://www.linkedin.com/in/your-handle/
   ```

3. **First run — log in once (visible browser)**
   ```bash
   npm run scrape:debug
   ```
   A Chromium window opens. Log in (auto-fill is attempted; if LinkedIn changes
   the form or shows MFA/CAPTCHA, just log in manually in that window). The
   session is saved to a persistent browser profile (`.chrome-profile/`), so
   subsequent runs are already authenticated.

4. **Later runs — headless, no login needed**
   ```bash
   npm run scrape
   ```

Results are written to `profile_data.json`.

## 📝 Posts (`posts_data.json`)

A second scraper extracts your recent LinkedIn **posts** (same saved session):

```bash
npm run scrape:posts          # headless -> posts_data.json
npm run scrape:posts:debug    # visible browser (HEADLESS=false)
```

A run is **merged into** the existing `posts_data.json` by LinkedIn URN (fresh wins), so a partial run can never shrink the export; pass `--replace` to write only this run's posts. A run that extracts nothing exits non-zero and leaves the file untouched.

`posts_data.json` is the input the **importer** consumes
(`python -m importer` — see `importer/README.md`): it upserts posts into the
backend by LinkedIn URN, as drafts by default.

## ⚙️ Environment variables

| Var | Default | Meaning |
| --- | --- | --- |
| `HEADLESS` | `true` | Set `false` to watch the browser (both scrapers; the `:debug` scripts set it for you) |
| `PLAYWRIGHT_CHANNEL` | *(bundled Chromium)* | Set `chrome` to use your **system Chrome**. Recommended: after a Playwright package update the bundled-Chromium path fails until you run `npx playwright install`; the system-Chrome channel keeps working. |
| `SCRAPE_MAX_POSTS` | `50` | Hard cap on posts one run extracts - raise it (e.g. `500`) to export your whole history. `--scrolls=N` caps the scroll loop (default 60). |

Example (profile scrape with system Chrome, visible):

```bash
PLAYWRIGHT_CHANNEL=chrome HEADLESS=false node scrape-linkedin.js
```

## 🧪 Tests

The post-parsing logic (`parse-post.js`) has unit tests using the built-in
Node test runner (no extra framework):

```bash
npm test        # runs `node --test` (parse-post.test.js)
```

## 🔐 Authentication

- Login state lives in `.chrome-profile/` (a persistent Chromium profile) and is
  detected via LinkedIn's `li_at` session cookie — the definitive signal.
- `.chrome-profile/` is git-ignored (it contains your live session — never commit it).
- If the session expires, re-run `npm run scrape:debug` and log in again.

## 📦 Data Structure (`profile_data.json`)

| Section          | Fields |
| :--------------- | :----- |
| **Identity**     | `name`, `headline`, `location`, `about` |
| **Experience**   | `title`, `company`, `location`, `startDate`, `endDate`, `description`, `companyLinkedInUrl` |
| **Education**    | `school`, `degree`, `fieldOfStudy`, `startDate`, `endDate`, `description` |
| **Skills**       | full list of skill names |
| **Certifications** | `name`, `issuer`, `issueDate`, `credentialId`, `credentialUrl` |
| **Languages**    | `name`, `proficiency` |

## ⚙️ How it works

1. `login()` — reuses the persistent profile; falls back to manual login.
2. Fetches the `FullProfileWithEntities` dash entity for identity + reference data.
3. Calls the per-section dash finders (`profilePositions`, `profileEducations`,
   `profileSkills`, `profileCertifications`, `profileLanguages`) with `count=100`
   to get the **complete** lists (the FullProfile dash caps each section at ~20).
4. Merges all `included` entities, resolves company/geo references, and writes JSON.
