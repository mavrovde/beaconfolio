"""Tests for the public JSON Resume endpoint, GET /profile/resume.json (#252).

The mapping itself is pinned in `test_json_resume.py`; this file pins the HTTP
contract: which source the document is built from, that an admin upload is
reflected without a rebuild, that the public allowlist still applies, and how
the endpoint degrades when no profile exists at all.
"""

import httpx
import pytest
import respx
from httpx import AsyncClient

from app.api import profile as profile_api
from app.api.profile import (
    PUBLIC_CONTACT_FIELDS,
    PUBLIC_PROFILE_FIELDS,
    public_profile_view,
)
from app.api.site_settings import AVAILABILITY_KEY
from app.config import settings
from app.models.profile_snapshot import ProfileSnapshot
from app.models.site_setting import SiteSetting
from tests.test_json_resume import assert_valid

URL = f"{settings.api_prefix}/profile/resume.json"

FULL_PROFILE = {
    "name": "Pinned Person",
    "headline": "Principal Engineer",
    "location": "Berlin, Germany",
    "about": "Summary line.",
    "contact": {"email": "pinned@example.test", "linkedin": "https://x.example/in/p"},
    "experience": [
        {
            "title": "Principal Engineer",
            "company": "Acme",
            "startDate": "Mar 2022",
            "endDate": "Present",
            "skills": ["Python"],
        }
    ],
    "education": [{"school": "Example TU", "degree": "M.Sc.", "years": "2014 - 2016"}],
    "skills": ["Python", "pgvector"],
    "languages": [{"name": "English", "proficiency": "Native"}],
    "certifications": [{"name": "Cert", "issuer": "Issuer", "date": "2024"}],
    "recommendations": [{"author": "Alex", "text": "Great."}],
}


async def _seed(db, *, version, language, data, is_active=True):
    row = ProfileSnapshot(
        version=version, language=language, data=data, is_active=is_active
    )
    db.add(row)
    await db.commit()
    return row


def _bundled_url(language: str) -> str:
    return f"{settings.profile_data_http_base}/profile_data_{language}.json"


async def test_resume_is_built_from_the_active_snapshot(
    client: AsyncClient, db_session, monkeypatch
):
    monkeypatch.setattr(settings, "site_url", "https://pinned.example/")
    monkeypatch.setattr(settings, "social_links", "https://github.com/pinned")
    await _seed(db_session, version="v9", language="en", data=FULL_PROFILE)

    response = await client.get(URL)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    document = response.json()
    assert_valid(document)
    assert document["basics"]["name"] == "Pinned Person"
    assert document["basics"]["url"] == "https://pinned.example"
    assert document["work"][0]["name"] == "Acme"
    assert "endDate" not in document["work"][0]  # ongoing role
    assert document["meta"]["profileVersion"] == "v9"
    assert document["meta"]["language"] == "en"
    assert document["meta"]["canonical"] == (
        f"https://pinned.example{settings.api_prefix}/profile/resume.json"
    )
    assert document["meta"]["contactUrl"] == "https://pinned.example/#contact"
    assert document["meta"]["lastModified"]
    # SOCIAL_LINKS is site config, not profile data — both must reach `profiles`.
    assert [p["url"] for p in document["basics"]["profiles"]] == [
        "https://x.example/in/p",
        "https://github.com/pinned",
    ]


async def test_resume_reflects_a_new_upload_without_a_rebuild(
    client: AsyncClient, db_session
):
    """#252 AC2: activate a new profile version -> the document changes on the
    very next request, no restart and no image rebuild."""
    first = await _seed(
        db_session, version="v1", language="en", data={"name": "Before"}
    )
    assert (await client.get(URL)).json()["basics"]["name"] == "Before"

    # Exactly what admin_profile.upload does: deactivate the old version for
    # this language and activate the new one.
    first.is_active = False
    await _seed(db_session, version="v2", language="en", data={"name": "After"})

    document = (await client.get(URL)).json()
    assert document["basics"]["name"] == "After"
    assert document["meta"]["profileVersion"] == "v2"


async def test_resume_is_language_specific(client: AsyncClient, db_session):
    await _seed(db_session, version="v1", language="en", data={"name": "EN"})
    await _seed(db_session, version="v1", language="de", data={"name": "DE"})
    assert (await client.get(URL, params={"lang": "de"})).json()["basics"]["name"] == (
        "DE"
    )
    assert (await client.get(URL, params={"lang": "EN"})).json()["basics"]["name"] == (
        "EN"
    )


async def test_resume_rejects_an_unsupported_language(client: AsyncClient):
    response = await client.get(URL, params={"lang": "fr"})
    assert response.status_code == 400
    assert "Unsupported language" in response.json()["detail"]


#: A snapshot as an uploaded LinkedIn export really arrives: portfolio fields
#: mixed with contact PII the site never renders.
PII_PROFILE = {
    "name": "Jane",
    "phone": "+49 30 000000",
    "birthday": "1990-01-01",
    "connections": ["Someone Private"],
    "contact": {
        "email": "jane@example.test",
        "phone": "+49 30 000000",
        "address": "Secret Street 1",
    },
}


async def test_resume_is_built_from_the_projection_not_the_raw_snapshot(
    client: AsyncClient, db_session, monkeypatch
):
    """The PII allowlist is pinned at the CALL, because it cannot be pinned at
    the output.

    Round 1 asserted only that the response body carried no PII — and the
    reviewer deleted `public_profile_view(...)` from the endpoint with the suite
    still 85/85 green. The reason is structural: every key the mapper reads is
    already inside the allowlist, so today NO input can make the two paths
    differ observably. The projection is therefore defense-in-depth against a
    FUTURE mapper field (a `phone` in `basics`, an address in `location`) — and
    a control whose only failure mode is future can only be pinned by asserting
    the control RUNS. So: spy on the mapper and inspect the dict it receives.
    (#252 review, blocker 2; lessons §16/§17 — a test that passes both ways
    pins nothing.)
    """
    seen: list[object] = []
    real = profile_api.build_json_resume

    def spy(data, context):
        seen.append(data)
        return real(data, context)

    monkeypatch.setattr(profile_api, "build_json_resume", spy)
    await _seed(db_session, version="v1", language="en", data=PII_PROFILE)

    response = await client.get(URL)

    assert response.status_code == 200
    assert len(seen) == 1
    received = seen[0]
    # The mapper must receive the PROJECTION, byte for byte.
    assert received == public_profile_view(PII_PROFILE)
    # …which is the invariant that matters, spelled out: nothing outside the
    # allowlist reaches the mapper, at any depth it inspects.
    assert isinstance(received, dict)
    assert set(received) <= PUBLIC_PROFILE_FIELDS | {"contact"}
    assert set(received["contact"]) <= PUBLIC_CONTACT_FIELDS
    assert "phone" not in received and "birthday" not in received
    assert "phone" not in received["contact"]


async def test_resume_never_exposes_non_public_profile_fields(
    client: AsyncClient, db_session
):
    """The output-side companion to the spy test above: whatever the mapper
    does with what it is given, no non-public value may reach the wire."""
    await _seed(db_session, version="v1", language="en", data=PII_PROFILE)
    body = (await client.get(URL)).text
    assert "+49 30 000000" not in body
    assert "1990-01-01" not in body
    assert "Secret Street 1" not in body
    assert "Someone Private" not in body
    assert "jane@example.test" in body  # the one contact field the site shows


async def test_resume_carries_the_admin_availability_signal(
    client: AsyncClient, db_session
):
    """The open-to-work state (#271) is what makes the document actionable."""
    await _seed(db_session, version="v1", language="en", data={"name": "Jane"})
    db_session.add(SiteSetting(key=AVAILABILITY_KEY, value="open"))
    await db_session.commit()

    assert (await client.get(URL)).json()["meta"]["availability"] == "open"


@respx.mock
async def test_resume_falls_back_to_the_bundled_demo_profile(client: AsyncClient):
    """A fresh stack has no snapshot but the SITE still renders the bundled
    asset — the agent-facing document must agree with the HTML, not 404."""
    route = respx.get(_bundled_url("en")).mock(
        return_value=httpx.Response(200, json={"name": "Bundled Jane"})
    )
    response = await client.get(URL)

    assert route.called
    assert response.status_code == 200
    document = response.json()
    assert document["basics"]["name"] == "Bundled Jane"
    # Nothing was uploaded, so there is no version/timestamp to claim.
    assert "profileVersion" not in document["meta"]
    assert "lastModified" not in document["meta"]


@respx.mock
async def test_resume_404s_when_no_profile_exists_anywhere(client: AsyncClient):
    respx.get(_bundled_url("en")).mock(side_effect=httpx.ConnectError("refused"))
    response = await client.get(URL)
    assert response.status_code == 404
    assert "No profile available" in response.json()["detail"]


@respx.mock
async def test_resume_404s_when_the_bundled_asset_is_not_an_object(
    client: AsyncClient,
):
    """A frontend that serves an SPA index.html (or a JSON array) for a missing
    asset must not be mapped into a nonsense resume."""
    respx.get(_bundled_url("en")).mock(return_value=httpx.Response(200, json=[1, 2]))
    assert (await client.get(URL)).status_code == 404


@respx.mock
async def test_resume_404s_on_an_http_error_from_the_bundled_asset(
    client: AsyncClient,
):
    respx.get(_bundled_url("en")).mock(return_value=httpx.Response(404))
    assert (await client.get(URL)).status_code == 404


async def test_resume_is_public(client: AsyncClient, db_session):
    """No auth: the whole point is that an agent can read it unauthenticated."""
    await _seed(db_session, version="v1", language="en", data={"name": "Jane"})
    response = await client.get(URL, headers={"Authorization": ""})
    assert response.status_code == 200


@pytest.mark.parametrize("policy", ["allow", "deny", "search-only"])
async def test_site_config_publishes_the_ai_crawler_policy(
    client: AsyncClient, monkeypatch, policy
):
    """The SSR robots.txt reads the switch from here (#252 AC3)."""
    monkeypatch.setattr(settings, "ai_crawler_policy", policy)
    response = await client.get(f"{settings.api_prefix}/config/site")
    assert response.json()["ai_crawler_policy"] == policy


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("deny", "deny"),
        ("DENY", "deny"),
        ("search-only", "search-only"),
        (" Search-Only ", "search-only"),
        (" allow ", "allow"),
        ("", "allow"),
        ("nope", "allow"),  # a typo must never silently deindex a portfolio
    ],
)
def test_ai_crawler_policy_is_normalized(raw, expected):
    from app.config import Settings

    assert Settings(AI_CRAWLER_POLICY=raw, _env_file=None).ai_crawler_policy == expected
