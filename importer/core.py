"""Standalone LinkedIn → beaconfolio.com importer (spec 06).

Reads the scraper's posts_data.json, downloads each post's image (using the saved
LinkedIn session), and pushes it to ``POST /api/app/linkedin/import-post`` with the
machine token. Idempotent (URN upsert on the server + a local processed-URN ledger),
retrying, and logged. Completely independent of the ``agents/`` A2A team.

Pure/orchestration logic lives here so it can be unit-tested with a mocked
``httpx`` transport (no live LinkedIn, no live prod).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlparse

import httpx

log = logging.getLogger("importer")

_DE_HINT = re.compile(
    r"[äöüß]|\b(und|der|die|das|nicht|mit|für|ich|auch|ist|eine)\b", re.I
)
_IMAGE_KEYS = ("content", "imageUrl", "imageUrls")


@dataclass
class Config:
    api_url: str
    token: str
    posts_json: Path
    state_path: Path
    default_language: str = "en"
    publish: bool = False
    retries: int = 3
    backoff: float = 1.0
    dry_run: bool = False
    li_at: Optional[str] = None  # LinkedIn session cookie for image downloads
    max_image_mb: int = 10

    @classmethod
    def from_env(cls, **overrides) -> "Config":
        base = Path(os.getenv("SCRAPER_DIR", "scraper"))
        api_url = os.getenv("BEACONFOLIO_API_URL", "http://localhost:8000").rstrip("/")
        state_env = os.getenv("IMPORT_STATE")
        cfg = dict(
            api_url=api_url,
            token=os.getenv("LINKEDIN_IMPORT_TOKEN", ""),
            posts_json=Path(os.getenv("POSTS_JSON", base / "posts_data.json")),
            state_path=Path(state_env) if state_env else default_state_path(api_url),
            default_language=os.getenv("IMPORT_DEFAULT_LANGUAGE", "en"),
            publish=os.getenv("IMPORT_PUBLISH", "").lower() in ("1", "true", "yes"),
            retries=int(os.getenv("IMPORT_RETRIES", "3")),
            backoff=float(os.getenv("IMPORT_BACKOFF", "1.0")),
            li_at=os.getenv("LINKEDIN_COOKIE_LI_AT") or None,
            max_image_mb=int(os.getenv("IMPORT_MAX_IMAGE_MB", "10")),
        )
        cfg.update(overrides)
        return cls(**cfg)


def default_state_path(api_url: str) -> Path:
    """Per-target ledger path (#334): ``importer/state.<host>.json``.

    The ledger remembers *that* a post was imported — with one global file it
    forgot *where to*, so pointing the importer at a brand-new server silently
    skipped everything an OLD server had already received (measured 2026-09-10:
    21 of 25 posts "skip (unchanged)" against a database containing zero
    posts). Deriving the file from the target host gives each target its own
    memory; ``IMPORT_STATE`` still overrides for exotic setups.
    """
    host = urlparse(api_url).netloc or "local"
    # ':' appears in host:port targets and is unfriendly in filenames (and
    # illegal on some filesystems); '-' keeps the name readable.
    return Path(f"importer/state.{host.replace(':', '-')}.json")


LEGACY_STATE_PATH = Path("importer/state.json")


def detect_language(text: str, default: str = "en") -> str:
    """Light en/de heuristic — the server keeps whatever we send."""
    if text and _DE_HINT.search(text):
        return "de"
    return default


def post_fingerprint(post: dict) -> str:
    """Stable short hash of the fields that matter, so an unchanged post is skipped."""
    payload = json.dumps({k: post.get(k) for k in _IMAGE_KEYS}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


class Ledger:
    """Local record of processed URN → fingerprint, so re-runs skip unchanged posts."""

    def __init__(self, path: Path):
        self.path = Path(path)
        try:
            self.data: dict[str, str] = json.loads(self.path.read_text())
        except (FileNotFoundError, ValueError):
            self.data = {}

    def unchanged(self, urn: str, fp: str) -> bool:
        return bool(urn) and self.data.get(urn) == fp

    def mark(self, urn: str, fp: str) -> None:
        if urn:
            self.data[urn] = fp

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2, sort_keys=True))


def load_posts(cfg: Config) -> list[dict]:
    """Load posts from the scraper JSON, oldest → newest (chronological import)."""
    raw = json.loads(Path(cfg.posts_json).read_text())
    posts = [p for p in raw if (p.get("content") or "").strip()]
    posts.sort(key=lambda p: p.get("postedAt") or "")
    return posts


def _retry(fn: Callable[[], httpx.Response], cfg: Config) -> httpx.Response:
    """Retry on transport errors / 5xx with linear backoff; return the last response."""
    last_exc: Optional[Exception] = None
    resp: Optional[httpx.Response] = None
    for attempt in range(cfg.retries):
        try:
            resp = fn()
            if resp.status_code < 500:
                return resp
        except httpx.HTTPError as exc:
            last_exc = exc
        if attempt < cfg.retries - 1:
            time.sleep(cfg.backoff * (attempt + 1))
    if resp is not None:
        return resp
    raise last_exc if last_exc else RuntimeError("request failed")


def download_image(
    client: httpx.Client, url: Optional[str], cfg: Config
) -> Optional[tuple[bytes, str]]:
    """Download image bytes (authenticated with the LinkedIn session cookie). Returns
    (bytes, content_type) or None if there's no image or the download fails/oversized."""
    if not url:
        return None
    cookies = {"li_at": cfg.li_at} if cfg.li_at else None
    try:
        resp = client.get(url, cookies=cookies, follow_redirects=True)
    except httpx.HTTPError as exc:
        log.warning("image download failed %s: %s", url, exc)
        return None
    if resp.status_code != 200:
        log.warning("image download %s -> HTTP %s", url, resp.status_code)
        return None
    if len(resp.content) > cfg.max_image_mb * 1024 * 1024:
        log.warning("image too large, skipping: %s", url)
        return None
    ctype = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
    return resp.content, ctype


def import_one(client: httpx.Client, cfg: Config, post: dict, ledger: Ledger) -> str:
    """Import a single post. Returns one of: created | updated | skipped | failed."""
    urn = post.get("urn") or ""
    fp = post_fingerprint(post)
    content = post.get("content", "")

    if ledger.unchanged(urn, fp):
        log.info("skip (unchanged): %s", urn)
        return "skipped"

    if cfg.dry_run:
        log.info("[dry-run] would import: urn=%s len=%d", urn, len(content))
        return "skipped"

    image = download_image(client, post.get("imageUrl"), cfg)
    data = {
        "content": content,
        "urn": urn,
        "language": post.get("language")
        or detect_language(content, cfg.default_language),
        "published": str(cfg.publish).lower(),
    }
    if post.get("postedAt"):
        data["posted_at"] = post["postedAt"]
    if post.get("url"):
        data["source_url"] = post["url"]
    files = {"image": ("image", image[0], image[1])} if image else None

    def _do() -> httpx.Response:
        return client.post(
            f"{cfg.api_url}/api/app/linkedin/import-post",
            data=data,
            files=files,
            headers={"X-Import-Token": cfg.token},
        )

    try:
        resp = _retry(_do, cfg)
    except Exception as exc:  # noqa: BLE001 - one bad post must not abort the batch
        log.error("import FAILED urn=%s: %s", urn, exc)
        return "failed"

    if resp.status_code != 200:
        log.error(
            "import FAILED urn=%s -> HTTP %s: %s",
            urn,
            resp.status_code,
            resp.text[:200],
        )
        return "failed"

    ledger.mark(urn, fp)
    created = bool(resp.json().get("created"))
    action = "created" if created else "updated"
    log.info("%s: urn=%s", action, urn)
    return action


@dataclass
class Summary:
    created: int = 0
    updated: int = 0
    skipped: int = 0
    failed: int = 0

    def record(self, action: str) -> None:
        setattr(self, action, getattr(self, action) + 1)

    @property
    def ok(self) -> bool:
        return self.failed == 0

    def __str__(self) -> str:
        return (
            f"created={self.created} updated={self.updated} "
            f"skipped={self.skipped} failed={self.failed}"
        )


def run(cfg: Config, client: Optional[httpx.Client] = None) -> Summary:
    """Import every post in the scraper JSON. Returns a Summary (failed>0 => exit non-zero)."""
    posts = load_posts(cfg)
    ledger = Ledger(cfg.state_path)
    summary = Summary()
    owns_client = client is None
    client = client or httpx.Client(timeout=30)
    log.info(
        "importing %d post(s) -> %s (dry_run=%s)", len(posts), cfg.api_url, cfg.dry_run
    )
    # Name the ledger AND the target up front (#334): the 2026-09-10 incident
    # was only diagnosable because someone noticed "unchanged" contradicting an
    # empty database — this line makes the pairing visible on every run.
    log.info("ledger %s for target %s", cfg.state_path, cfg.api_url)
    if LEGACY_STATE_PATH.exists() and Path(cfg.state_path) != LEGACY_STATE_PATH:
        log.info(
            "legacy ledger %s ignored (ledgers are per-target since #334; "
            "set IMPORT_STATE=%s to keep using it)",
            LEGACY_STATE_PATH,
            LEGACY_STATE_PATH,
        )
    try:
        for post in posts:
            summary.record(import_one(client, cfg, post, ledger))
    finally:
        if owns_client:
            client.close()
    if not cfg.dry_run:
        ledger.save()
    log.info("done: %s", summary)
    return summary
