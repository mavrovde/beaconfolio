import json
import os
import re
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.logger import logger

router = APIRouter(prefix="/cv", tags=["cv"])

# Path to the frontend profile data assets (works in local dev)
PROFILE_DATA_DIR = os.environ.get(
    "PROFILE_DATA_DIR",
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "frontend", "src", "assets"
    ),
)

# HTTP base URL for fetching profile data when files are not on disk (Docker mode)
PROFILE_DATA_HTTP_BASE = settings.profile_data_http_base


def _extract_years_from_profile(file_path: str) -> set[int]:
    """Extract distinct years from experience startDate fields in a profile JSON."""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        logger.warning(f"Could not read profile data from {file_path}: {e}")
        return set()

    return _extract_years_from_data(data)


def _extract_years_from_data(data: dict) -> set[int]:
    """Extract distinct years from experience entries in profile data dict."""
    years = set()
    for exp in data.get("experience", []):
        start_date = exp.get("startDate", "")
        # Extract 4-digit year from strings like "Mar 2025", "Jan 2021"
        match = re.search(r"\b(19|20)\d{2}\b", start_date)
        if match:
            years.add(int(match.group()))
    return years


def _fetch_years_via_http() -> set[int]:
    """Fetch profile data via HTTP and extract years (for Docker environment)."""
    import httpx

    all_years: set[int] = set()
    for lang in ("en", "de"):
        url = f"{PROFILE_DATA_HTTP_BASE}/profile_data_{lang}.json"
        try:
            response = httpx.get(url, timeout=settings.profile_data_timeout_seconds)
            response.raise_for_status()
            data = response.json()
            all_years |= _extract_years_from_data(data)
        except Exception as e:
            logger.warning(f"Could not fetch profile data from {url}: {e}")
    return all_years


@router.get("/years")
async def get_cv_years():
    """Return distinct years from CV experience entries, sorted descending."""
    all_years: set[int] = set()

    # Try local files first
    root = os.path.realpath(PROFILE_DATA_DIR)
    for lang in ("en", "de"):
        # PROFILE_DATA_DIR is an ENVIRONMENT VARIABLE (see the top of this
        # module), not a constant — an earlier comment here claimed otherwise
        # and was simply wrong. Snyk `python/PT` is right to treat it as
        # untrusted. Resolve it and refuse anything that escapes the root, so a
        # crafted value cannot walk the filesystem via symlink or `..`.
        candidate = os.path.realpath(os.path.join(root, f"profile_data_{lang}.json"))
        if os.path.commonpath([root, candidate]) != root:
            logger.warning(
                "refusing profile path outside PROFILE_DATA_DIR: %s", candidate
            )
            continue
        file_path = candidate
        all_years |= _extract_years_from_profile(file_path)

    # Fallback to HTTP if no years found from local files
    if not all_years:
        all_years = _fetch_years_via_http()

    if not all_years:
        logger.error("No years found in any profile data file.")
        raise HTTPException(status_code=404, detail="No experience years found")

    # Always surface the current year so the timeline reaches the present, even if no
    # experience *started* this year (roles are ongoing). Keeps the slider current
    # (e.g. 2026) without hardcoding a year.
    all_years.add(datetime.now(UTC).year)

    sorted_years = sorted(all_years, reverse=True)
    return {"years": sorted_years}
