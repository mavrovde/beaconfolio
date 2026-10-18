"""Tests for the public GET /profile endpoint."""

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from app.config import settings
from app.models.profile_snapshot import ProfileSnapshot

URL = f"{settings.api_prefix}/profile"


async def _seed(db, *, version, language, data, is_active):
    row = ProfileSnapshot(
        version=version, language=language, data=data, is_active=is_active
    )
    db.add(row)
    await db.commit()
    return row


async def test_get_active_profile_returns_data(client: AsyncClient, db_session):
    await _seed(
        db_session,
        version="v1",
        language="en",
        data={"name": "Testa", "headline": "Engineer"},
        is_active=True,
    )
    r = await client.get(URL, params={"lang": "en"})
    assert r.status_code == 200
    assert r.json() == {"name": "Testa", "headline": "Engineer"}


async def test_get_defaults_to_english(client: AsyncClient, db_session):
    await _seed(
        db_session, version="v1", language="en", data={"name": "EN"}, is_active=True
    )
    r = await client.get(URL)  # no lang param
    assert r.status_code == 200
    assert r.json()["name"] == "EN"


async def test_get_is_language_specific(client: AsyncClient, db_session):
    await _seed(
        db_session, version="v1", language="en", data={"name": "EN"}, is_active=True
    )
    await _seed(
        db_session, version="v1", language="de", data={"name": "DE"}, is_active=True
    )
    assert (await client.get(URL, params={"lang": "de"})).json()["name"] == "DE"
    assert (await client.get(URL, params={"lang": "en"})).json()["name"] == "EN"


async def test_get_ignores_inactive_versions(client: AsyncClient, db_session):
    await _seed(
        db_session, version="v1", language="en", data={"name": "old"}, is_active=False
    )
    r = await client.get(URL, params={"lang": "en"})
    assert r.status_code == 404


async def test_get_no_active_profile_is_404(client: AsyncClient):
    r = await client.get(URL, params={"lang": "en"})
    assert r.status_code == 404
    assert "No active profile" in r.json()["detail"]


async def test_get_unsupported_language_is_400(client: AsyncClient):
    r = await client.get(URL, params={"lang": "fr"})
    assert r.status_code == 400
    assert "Unsupported language" in r.json()["detail"]


async def test_public_get_needs_no_auth(clean_client: AsyncClient, db_session):
    """The public profile endpoint is reachable without any session."""
    await _seed(
        db_session, version="v1", language="en", data={"name": "Public"}, is_active=True
    )
    r = await clean_client.get(URL, params={"lang": "en"})
    assert r.status_code == 200
    assert r.json()["name"] == "Public"


async def test_get_strips_non_public_pii(client: AsyncClient, db_session):
    """A raw scraper JSON with PII must NOT leak it on the public endpoint."""
    await _seed(
        db_session,
        version="v1",
        language="en",
        data={
            "name": "Testa",
            "headline": "Engineer",
            "experience": [{"title": "Dev"}],
            # Non-public fields a LinkedIn export may carry:
            "phone": "+49 123 456",
            "birthday": "1990-01-01",
            "address": "Secret St 1",
            "connections": ["a", "b"],
            "contactInfo": {"phone": "x"},
        },
        is_active=True,
    )
    body = (await client.get(URL, params={"lang": "en"})).json()
    assert body["name"] == "Testa"
    assert body["experience"] == [{"title": "Dev"}]
    for leaked in ("phone", "birthday", "address", "connections", "contactInfo"):
        assert leaked not in body


async def test_get_projects_contact_to_email_and_linkedin(
    client: AsyncClient, db_session
):
    """`contact` is exposed but reduced to email + linkedin only."""
    await _seed(
        db_session,
        version="v1",
        language="en",
        data={
            "name": "S",
            "contact": {
                "email": "me@example.com",
                "linkedin": "https://linkedin.com/in/me",
                "phone": "+49 000",
                "address": "private",
            },
        },
        is_active=True,
    )
    contact = (await client.get(URL, params={"lang": "en"})).json()["contact"]
    assert contact == {
        "email": "me@example.com",
        "linkedin": "https://linkedin.com/in/me",
    }


async def test_get_active_profile_rate_limited_after_limit(
    client: AsyncClient, db_session, monkeypatch
):
    """The Nth request within the window returns 429; requests under the limit
    (a normal single request, or several within it) still return 200."""
    from app.api import profile as profile_module

    monkeypatch.setattr(profile_module.profile_rate_limiter, "max_requests", 3)
    await _seed(
        db_session,
        version="v1",
        language="en",
        data={"name": "RateLimited"},
        is_active=True,
    )

    for _ in range(3):
        r = await client.get(URL, params={"lang": "en"})
        assert r.status_code == 200

    r = await client.get(URL, params={"lang": "en"})
    assert r.status_code == 429
    assert "Too many requests" in r.json()["detail"]


async def test_get_active_profile_single_request_not_rate_limited(
    client: AsyncClient, db_session
):
    """A normal single request is never affected by the (generous) rate limit."""
    await _seed(
        db_session, version="v1", language="en", data={"name": "Normal"}, is_active=True
    )
    r = await client.get(URL, params={"lang": "en"})
    assert r.status_code == 200


async def test_get_returns_503_during_schema_warmup(client: AsyncClient, db_session):
    """Startup race (#124): a missing table yields a graceful, retryable 503,
    NOT a raw 500 UndefinedTableError."""
    await db_session.execute(text("DROP TABLE profile_snapshots"))
    await db_session.commit()

    r = await client.get(URL, params={"lang": "en"})
    assert r.status_code == 503
    assert "starting up" in r.json()["detail"]


async def test_get_reraises_non_undefined_table_db_error(client: AsyncClient):
    """A DB ProgrammingError that is NOT a missing table must not be masked as
    503 — it propagates (real error), so we never hide genuine failures."""
    from app.database import get_db
    from app.main import app

    class _FakeUndefinedColumn(Exception):
        sqlstate = "42703"  # undefined_column, not undefined_table

    class _RaisingSession:
        async def execute(self, *args, **kwargs):
            raise ProgrammingError("SELECT 1", {}, _FakeUndefinedColumn())

    async def _override():
        yield _RaisingSession()

    app.dependency_overrides[get_db] = _override
    with pytest.raises(ProgrammingError):
        await client.get(URL, params={"lang": "en"})


async def test_get_handles_non_dict_stored_data(client: AsyncClient, db_session):
    """Defensive: a non-object stored payload projects to an empty object."""
    await _seed(
        db_session,
        version="v1",
        language="en",
        data=["not", "a", "dict"],
        is_active=True,
    )
    r = await client.get(URL, params={"lang": "en"})
    assert r.status_code == 200
    assert r.json() == {}


# --- Timeline ordering (#443) ------------------------------------------------
#
# A LinkedIn export carries no ordering guarantee, and a real deployment proved
# it: the stored array led with a role that had ended thirteen years earlier
# while the CURRENT, still-ongoing role sat eighth. Ordering lives in
# `public_profile_view` because that one projection feeds BOTH the public
# endpoint and the JSON Resume / CV export. Fixtures here use the repository's
# anonymised demo companies — never a real employment history (#66).


def _companies(view):
    return [e["company"] for e in view["experience"]]


def test_experience_is_ordered_newest_first():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "experience": [
                {
                    "company": "Globex Digital",
                    "startDate": "Nov 2012",
                    "endDate": "Mar 2013",
                },
                {
                    "company": "Initech Solutions",
                    "startDate": "Jan 2024",
                    "endDate": "Mar 2025",
                },
                {
                    "company": "Acme Cloud GmbH",
                    "startDate": "Mar 2025",
                    "endDate": "Present",
                },
                {
                    "company": "Umbrella Labs",
                    "startDate": "Apr 2025",
                    "endDate": "Dec 2025",
                },
            ]
        }
    )
    # The ongoing role leads even though Umbrella Labs STARTED a month later — an
    # end-date sort alone would bury the current job.
    assert _companies(view) == [
        "Acme Cloud GmbH",
        "Umbrella Labs",
        "Initech Solutions",
        "Globex Digital",
    ]


def test_ongoing_markers_are_recognised_case_insensitively():
    from app.api.profile import public_profile_view

    for marker in ("Present", "present", "CURRENT", "Heute", "  now  "):
        view = public_profile_view(
            {
                "experience": [
                    {"company": "old", "startDate": "Jan 2000", "endDate": "Dec 2030"},
                    {"company": "now", "startDate": "Jan 1999", "endDate": marker},
                ]
            }
        )
        assert _companies(view)[0] == "now", marker


def test_year_only_dates_sort_and_do_not_crash():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "education": [
                {"school": "School", "startDate": "1986", "endDate": "1996"},
                {
                    "school": "University",
                    "startDate": "Sep 1997",
                    "endDate": "Jun 2002",
                },
            ]
        }
    )
    assert [e["school"] for e in view["education"]] == ["University", "School"]


def test_entries_with_equal_dates_keep_their_source_order():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "experience": [
                {
                    "company": "Acme Cloud GmbH",
                    "startDate": "Sep 2009",
                    "endDate": "Sep 2012",
                },
                {
                    "company": "Initech Solutions",
                    "startDate": "Sep 2009",
                    "endDate": "Sep 2012",
                },
            ]
        }
    )
    assert _companies(view) == ["Acme Cloud GmbH", "Initech Solutions"]


def test_undated_and_malformed_entries_sink_rather_than_lead():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "experience": [
                {"company": "undated"},
                {"company": "garbage", "startDate": "??", "endDate": "soon"},
                {"company": "dated", "startDate": "Jan 2020", "endDate": "Jan 2021"},
                "not-a-dict",
                {"company": "year-only", "startDate": "2015", "endDate": "2016"},
            ]
        }
    )
    ordered = [
        e.get("company") if isinstance(e, dict) else e for e in view["experience"]
    ]
    assert ordered[:2] == ["dated", "year-only"]
    # Everything undateable lands after every dated entry, in source order.
    assert ordered[2:] == ["undated", "garbage", "not-a-dict"]


def test_missing_end_date_is_placed_by_its_start_not_treated_as_ongoing():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "experience": [
                {"company": "recent", "startDate": "Jan 2024", "endDate": "Jan 2025"},
                {"company": "open-ended", "startDate": "Jan 2010"},
            ]
        }
    )
    assert _companies(view) == ["recent", "open-ended"]


def test_non_list_timeline_section_is_left_untouched():
    from app.api.profile import public_profile_view

    view = public_profile_view({"experience": "not a list", "education": None})
    assert view["experience"] == "not a list"
    assert view["education"] is None


async def test_endpoint_serves_experience_newest_first(client: AsyncClient, db_session):
    await _seed(
        db_session,
        version="v1",
        language="en",
        data={
            "name": "Testa",
            "experience": [
                {
                    "company": "Globex Digital",
                    "startDate": "Nov 2012",
                    "endDate": "Mar 2013",
                },
                {
                    "company": "Acme Cloud GmbH",
                    "startDate": "Mar 2025",
                    "endDate": "Present",
                },
            ],
        },
        is_active=True,
    )
    r = await client.get(URL, params={"lang": "en"})
    assert r.status_code == 200
    assert [e["company"] for e in r.json()["experience"]] == [
        "Acme Cloud GmbH",
        "Globex Digital",
    ]


# --- Certification ordering (PR #497) ----------------------------------------
#
# Certifications are ordered in the SAME projection as the timeline, by the same
# parser (`json_resume.month_sort_key`), so `/profile` and `resume.json` cannot
# disagree. The German cases matter: the `de` profile is a separate upload and
# nothing guarantees its months are English (review round 1, major 1).


def _cert_names(view):
    return [c.get("name") if isinstance(c, dict) else c for c in view["certifications"]]


def test_certifications_are_newest_first_with_undated_last():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "certifications": [
                {"name": "undated-a"},
                {"name": "nov-2023", "issueDate": "Nov 2023"},
                {"name": "sep-2026", "issueDate": "Sep 2026"},
                {"name": "undated-b", "issueDate": ""},
                "not-a-dict",
                {"name": "aug-2026", "issueDate": "Aug 2026"},
                {"name": "demo-2025", "date": "2025-06-01"},
            ]
        }
    )
    assert _cert_names(view) == [
        "sep-2026",
        "aug-2026",
        "demo-2025",
        "nov-2023",
        "undated-a",
        "undated-b",
        "not-a-dict",
    ]


def test_certification_german_month_names_are_dated():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "certifications": [
                {"name": "dez-2025", "issueDate": "Dez 2025"},
                {"name": "undated", "issueDate": "bald"},
                {"name": "maer-2026", "issueDate": "Mär 2026"},
                {"name": "okt-2026", "issueDate": "Okt 2026"},
                {"name": "maerz-2026-long", "issueDate": "März 2026"},
                {"name": "mai-2026", "issueDate": "Mai 2026"},
                {"name": "issued-sep-2026", "issueDate": "Issued Sep 2026"},
            ]
        }
    )
    assert _cert_names(view) == [
        "okt-2026",
        "issued-sep-2026",
        "mai-2026",
        "maer-2026",
        "maerz-2026-long",
        "dez-2025",
        "undated",
    ]


def test_certifications_of_the_same_month_keep_their_upload_order():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "certifications": [
                {"name": "first", "issueDate": "Aug 2026"},
                {"name": "newer", "issueDate": "Sep 2026"},
                {"name": "second", "issueDate": "2026-08-30"},
                {"name": "third", "issueDate": "Aug. 2026"},
            ]
        }
    )
    assert _cert_names(view) == ["newer", "first", "second", "third"]


def test_a_year_only_certification_sorts_below_every_month_of_its_year():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "certifications": [
                {"name": "year-2025", "date": "2025"},
                {"name": "dez-2024", "issueDate": "Dez 2024"},
                {"name": "jan-2025", "issueDate": "Jan 2025"},
            ]
        }
    )
    assert _cert_names(view) == ["jan-2025", "year-2025", "dez-2024"]


def test_certification_explicit_date_wins_over_issue_date_for_ordering():
    """The entry carrying BOTH fields is ordered by `date` — the field the site
    displays — so the list cannot look out of order (review round 1, minor 2)."""
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "certifications": [
                {"name": "middle", "issueDate": "Jan 2025"},
                {"name": "both", "date": "2020", "issueDate": "Sep 2026"},
                {"name": "newest", "issueDate": "Mar 2026"},
            ]
        }
    )
    assert _cert_names(view) == ["newest", "middle", "both"]


def test_non_list_certifications_are_left_untouched():
    from app.api.profile import public_profile_view

    assert public_profile_view({"certifications": "nope"})["certifications"] == "nope"


async def test_endpoint_serves_certifications_newest_first(
    client: AsyncClient, db_session
):
    await _seed(
        db_session,
        version="v1",
        language="de",
        data={
            "name": "Testa",
            "certifications": [
                {"name": "alt", "issueDate": "Dez 2025"},
                {"name": "neu", "issueDate": "Okt 2026"},
            ],
        },
        is_active=True,
    )
    r = await client.get(URL, params={"lang": "de"})
    assert r.status_code == 200
    assert [c["name"] for c in r.json()["certifications"]] == ["neu", "alt"]


# --- Projects: the NESTED public allowlist (#92) ------------------------------
#
# `projects` is hand-authored, not scraped, so an entry can carry anything the
# forker's notes carried. The top-level allowlist admits the FIELD; these pin
# that it does not admit the field's contents wholesale.


def test_project_entries_are_stripped_to_the_nested_allowlist():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "projects": [
                {
                    "title": "Beaconfolio",
                    "summary": "A portfolio template",
                    "techStack": ["Angular"],
                    "links": {"source": "https://github.com/janedoe/b"},
                    "clientContact": "someone@example.com",
                    "internalNotes": "do not publish",
                }
            ]
        }
    )
    assert view["projects"] == [
        {
            "title": "Beaconfolio",
            "summary": "A portfolio template",
            "techStack": ["Angular"],
            "links": {"source": "https://github.com/janedoe/b"},
        }
    ]


def test_project_links_are_stripped_to_source_and_demo():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "projects": [
                {
                    "title": "Beaconfolio",
                    "links": {
                        "source": "https://github.com/janedoe/b",
                        "demo": "https://example.com",
                        "internalTracker": "https://jira.internal/PROJ-1",
                    },
                }
            ]
        }
    )
    assert view["projects"][0]["links"] == {
        "source": "https://github.com/janedoe/b",
        "demo": "https://example.com",
    }


def test_project_entry_without_links_gains_none():
    """An absent `links` stays absent — the projection never invents a key."""
    from app.api.profile import public_profile_view

    view = public_profile_view({"projects": [{"title": "Bare"}]})
    assert view["projects"] == [{"title": "Bare"}]


def test_non_dict_project_entries_and_non_list_projects_pass_through():
    from app.api.profile import public_profile_view

    # A non-dict entry carries no hidden key to strip; the renderer drops it.
    assert public_profile_view({"projects": ["nope", None, 7]})["projects"] == [
        "nope",
        None,
        7,
    ]
    # A malformed upload is left visible rather than silently emptied here.
    assert public_profile_view({"projects": {"not": "a list"}})["projects"] == {
        "not": "a list"
    }


def test_projects_survive_the_top_level_allowlist_while_pii_does_not():
    from app.api.profile import public_profile_view

    view = public_profile_view(
        {
            "name": "Jane Doe",
            "projects": [{"title": "Beaconfolio"}],
            "phone": "+00 000 000",
            "birthday": "1 January",
        }
    )
    assert view["projects"] == [{"title": "Beaconfolio"}]
    assert "phone" not in view and "birthday" not in view


def test_project_links_that_are_not_an_object_are_dropped_entirely():
    """A non-dict `links` must not ride through on the top-level allowlist.

    `"links"` is itself in `PUBLIC_PROJECT_FIELDS`, so a comprehension that
    admits it copies the value VERBATIM, and the nested projection — which only
    fires for a `dict` — never sees it. A hand-authored array is an entirely
    ordinary thing to write, and it carried `internalTracker` / `clientContact`
    straight to the public wire (PR #451 review round 1, blocker 4). The
    projection is now explicit: only an object survives, and only through
    `PUBLIC_PROJECT_LINK_FIELDS`.
    """
    from app.api.profile import public_profile_view

    as_list = public_profile_view(
        {
            "projects": [
                {
                    "title": "X",
                    "links": [
                        {
                            "internalTracker": "https://jira.internal/PROJ-1",
                            "clientContact": "ceo@bigcorp.example",
                        }
                    ],
                }
            ]
        }
    )
    assert as_list["projects"] == [{"title": "X"}]

    as_string = public_profile_view(
        {"projects": [{"title": "X", "links": "internal://secret-notes"}]}
    )
    assert as_string["projects"] == [{"title": "X"}]

    # The documented shape still survives — the drop is scoped to the shapes the
    # renderer cannot consume, not to `links` as such.
    as_object = public_profile_view(
        {"projects": [{"title": "X", "links": {"demo": "https://example.com"}}]}
    )
    assert as_object["projects"] == [
        {"title": "X", "links": {"demo": "https://example.com"}}
    ]
