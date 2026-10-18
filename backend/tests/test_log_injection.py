"""Request fields must not be able to forge log lines (CWE-117, Sonar S5145).

The assertions read the LOG RECORD the endpoint emitted (the seam), not the
HTTP response: a response-only test passes with `log_safe` deleted.
"""

import logging

import pytest
from httpx import AsyncClient

from app.config import settings
from app.logger import log_safe

FORGED = "urn:li:activity:7\n2026-01-01 - app - INFO - admin logged in\x1b[2J"


def test_log_safe_escapes_line_breaks_and_controls():
    assert log_safe("a\r\nb") == "a\\r\\nb"
    assert log_safe("x\x1b[2Jy\x00\x7f") == "x\\x1b[2Jy\\x00\\x7f"
    assert log_safe("tab\there") == "tab\\x09here"
    # Ordinary text, including non-ASCII, is untouched.
    assert log_safe("urn:li:activity:1 Köln") == "urn:li:activity:1 Köln"
    assert log_safe(None) == "None"


def _linkedin_lines(caplog, marker: str) -> list[str]:
    return [
        r.getMessage()
        for r in caplog.records
        if r.name == "app.api.linkedin" and marker in r.getMessage()
    ]


@pytest.mark.asyncio
async def test_import_post_log_line_cannot_be_forged(
    clean_client: AsyncClient, monkeypatch, caplog
):
    monkeypatch.setattr(settings, "linkedin_import_token", "tok")
    with caplog.at_level(logging.INFO, logger="app.api.linkedin"):
        r = await clean_client.post(
            f"{settings.api_prefix}/linkedin/import-post",
            data={"content": "Hello from LinkedIn", "urn": FORGED},
            headers={"X-Import-Token": "tok"},
        )
    assert r.status_code == 200
    (line,) = _linkedin_lines(caplog, "import-post:")
    assert "\n" not in line and "\x1b" not in line
    assert "urn:li:activity:7\\n2026-01-01" in line


@pytest.mark.asyncio
async def test_transfer_post_log_line_cannot_be_forged(client: AsyncClient, caplog):
    with caplog.at_level(logging.INFO, logger="app.api.linkedin"):
        r = await client.post(
            f"{settings.api_prefix}/linkedin/transfer-post",
            json={"content": "Hello from LinkedIn", "urn": FORGED},
        )
    assert r.status_code == 200
    (line,) = _linkedin_lines(caplog, "transfer-post:")
    assert "\n" not in line and "\x1b" not in line
    assert "urn:li:activity:7\\n2026-01-01" in line
