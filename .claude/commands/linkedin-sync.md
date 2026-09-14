---
description: Scrape latest LinkedIn profile + posts and import posts into the backend
---

Drive the LinkedIn → Beaconfolio pipeline end-to-end. The saved session lives in
`scraper/.chrome-profile/` (gitignored); if it's expired, run with `HEADLESS=false` and let the
user complete login/MFA. Prefer system Chrome via `PLAYWRIGHT_CHANNEL=chrome` if the bundled
Chromium is unavailable.

1. **Scrape** (`cd scraper`):
   - Profile: `PLAYWRIGHT_CHANNEL=chrome HEADLESS=false node scrape-linkedin.js` → `profile_data.json`
   - Posts:   `PLAYWRIGHT_CHANNEL=chrome HEADLESS=false node scrape-posts.js` → `posts_data.json`
   - Sanity-check the JSON (counts, content/urn/postedAt present).
2. **Import** (repo root) — dry-run first, then real:
   - `BEACONFOLIO_API_URL=<target> LINKEDIN_IMPORT_TOKEN=<token> python -m importer --dry-run`
   - then without `--dry-run`. Imports are drafts by default (add `--publish` only if asked).
   - Upsert is by LinkedIn URN (idempotent). For image downloads set `LINKEDIN_COOKIE_LI_AT`.
3. **Portrait** (#333): the profile scrape also saves `scraper/profile_photo.jpg` (gitignored —
   a real face must never be committed to this PUBLIC repo, #66). Upload it through the admin
   endpoint so it lands in the DB and survives rollouts:
   - `TOKEN=$(curl -s -X POST <target>/api/app/auth/login -d 'username=<admin>&password=<pass>' | jq -r .access_token)`
   - `curl -s -X POST <target>/api/app/admin/profile/photo -H "Authorization: Bearer $TOKEN" -F file=@scraper/profile_photo.jpg`
   - Verify: `curl -sI <target>/api/app/profile/photo` returns 200 with an image content-type.
   Skip if the file wasn't produced (no avatar on the profile) — the hero keeps its placeholder.
4. **Verify**: confirm rows landed (`source_urn` populated, images stored) and the image endpoint
   `GET /api/app/posts/{id}/image` serves.

Default target is `http://localhost:8000`. Only target production when explicitly asked, and only
after confirming `LINKEDIN_IMPORT_TOKEN` is set on the prod backend. $ARGUMENTS
