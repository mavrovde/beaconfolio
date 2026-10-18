# LinkedIn importer

A small, **stable, standalone** process that pushes your LinkedIn posts into your Beaconfolio backend.
It is **not** part of the `agents/` A2A team and has no dependency on it.

```
scraper/posts_data.json  ──►  importer  ──►  POST /api/app/linkedin/import-post
        (spec 05)              (this)          (spec 04, upserts by URN)
```

For each post it: skips it if unchanged (local ledger), downloads its image with your
saved LinkedIn session, and POSTs text + image to the ingest endpoint with the machine
token. It is **idempotent** (URN upsert on the server + a local ledger), **retries**
with backoff (one bad post never aborts the batch), imports **oldest → newest**, and
exits non-zero if any post hard-failed (so cron can alert).

## Run

```bash
pip install -r importer/requirements.txt

export BEACONFOLIO_API_URL=https://<your-domain>   # or http://localhost:8000
export LINKEDIN_IMPORT_TOKEN=...                  # must match the backend
export LINKEDIN_COOKIE_LI_AT=...                  # for authenticated image downloads
# posts come from scraper/posts_data.json (run `npm run scrape:posts` first — spec 05)

python -m importer --dry-run     # preview: does everything except POST (safe vs prod)
python -m importer               # one-shot import
python -m importer --watch 3600  # re-run hourly
```

Imported posts are **drafts** by default (review, then publish); pass `--publish` to import
as published. See `specs/done/linkedin-import-FULL-reference.md` (git history — the specs/ tree was retired in #330) §Component 3 / §1d for the full design
and the prod-connection modes.

## Config (env)

| var | default | meaning |
|-----|---------|---------|
| `BEACONFOLIO_API_URL` | `http://localhost:8000` | backend base URL |
| `LINKEDIN_IMPORT_TOKEN` | — | machine token (matches backend) |
| `LINKEDIN_COOKIE_LI_AT` | — | LinkedIn session cookie for image downloads |
| `POSTS_JSON` | `scraper/posts_data.json` | scraped posts input |
| `IMPORT_STATE` | `importer/state.<target-host>.json` | processed-URN ledger override |
| `IMPORT_PUBLISH` | `false` | import as published vs draft |
| `IMPORT_RETRIES` / `IMPORT_BACKOFF` | `3` / `1.0` | retry policy |

## The ledger is PER TARGET (#334)

The ledger is a client-side traffic saver: it remembers which URN+fingerprint was
already sent so re-runs skip unchanged posts. Since #334 its default path is
derived from the target host — `importer/state.beaconfolio.com.json`,
`importer/state.localhost-8000.json` — because one global file remembered *that*
a post was imported but not *where to*: pointing the importer at a brand-new
server silently skipped everything an old server had already received (measured
2026-09-10: 21 of 25 posts "skip (unchanged)" against an empty database).
Importing to a second target therefore always starts with that target's own
(initially empty) ledger. `IMPORT_STATE` still overrides the path; a pre-#334
global `importer/state.json` is ignored with a log note. Every run logs
`ledger <path> for target <url>` at startup. Server-side idempotency (URN
upsert) is unaffected — deleting a ledger file only costs re-sent requests,
never duplicates.

## Titles, summaries and dates of imported posts

The importer sends only the body; the backend DERIVES the title (the first readable
sentence of the first line, ≤ 70 chars, cut at a clause or word boundary — "…" only
when text really was dropped) and the summary/meta description (the cleaned body,
≤ 150 chars on a word boundary). Emoji, hashtag runs and generic share boilerplate
(`LINKEDIN_BOILERPLATE_PATTERNS` in `backend/app/services/post_metadata.py`) are
stripped first. `posted_at` (LinkedIn's date) is stored and served as the post's
publication date.

A re-import updates the title/summary only while the stored value is still machine
output for the stored body, so an edit made in the admin survives every re-import.

Posts imported before this derivation keep their old titles until the owner moves
them deliberately — dry run first, it changes nothing:

```bash
curl -X POST -H "X-Import-Token: $LINKEDIN_IMPORT_TOKEN" \
  "$BEACONFOLIO_API_URL/api/app/linkedin/rederive-metadata"              # dry run: lists old → new
curl -X POST -H "X-Import-Token: $LINKEDIN_IMPORT_TOKEN" \
  "$BEACONFOLIO_API_URL/api/app/linkedin/rederive-metadata?dry_run=false" # apply
```

Only fields that still equal the PREVIOUS derivation (or are empty) change; anything a
human edited is counted in `kept_human_title`/`kept_human_summary` and left alone.
Slugs never change (they are published URLs). A second apply reports `changed: 0`.

## Language of imported posts

The importer always DETECTS each post's language from its text (`detect_language` in
`core.py`); a `language` field in the scraper export is ignored, because exports written by
the old single-hit heuristic carry wrong `de` tags. Detection counts function words: German
needs ≥ 2 hits, ≥ 10 % of the words and more hits than English, otherwise the default
(`IMPORT_DEFAULT_LANGUAGE`, `en`) applies. An existing row keeps its stored language — the
URN upsert does not rewrite it — and search treats the language only as a preference.

## Test

```bash
pytest importer/tests -q     # mocked HTTP, no live LinkedIn/prod
```
