"""Unit tests for the JSON Resume projection (#252).

The mapping is where a scraped profile hurts: every node is operator-supplied
and may be absent, empty, or the wrong type. These tests pin the vocabulary
translation and the "omit, never invent" rule, and validate the finished
document against the VENDORED JSON Resume v1.0.0 schema
(`tests/fixtures/jsonresume_schema_v1.json`) so the check is offline and
version-pinned.
"""

import json
from pathlib import Path

import pytest
from jsonschema import Draft4Validator, FormatChecker

from app.api.profile import public_profile_view
from app.services.json_resume import (
    JSON_RESUME_SCHEMA_URL,
    ResumeContext,
    build_json_resume,
    build_location,
    build_profiles,
    clean_email,
    clean_url,
    full_date,
    month_sort_key,
    network_for,
    normalize_date,
    username_for,
    year_range,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEMO_PROFILE_DIR = REPO_ROOT / "frontend" / "projects" / "public" / "src" / "assets"
SCHEMA_PATH = Path(__file__).resolve().parent / "fixtures" / "jsonresume_schema_v1.json"

#: The `format` keywords this document actually depends on. Asserted to be
#: ARMED before any validation runs: `jsonschema` registers a format checker
#: only when its backing library is installed, and `Draft4Validator`'s own
#: `FORMAT_CHECKER` carries just email/idn-email/ipv4/ipv6/regex — so the
#: round-1 gate silently checked NEITHER `uri` NOR `date` while the docstring,
#: the PR and the README all claimed it did (#252 review, major 3). A gate that
#: can pass while disarmed is not a gate (lessons §16/§17).
ASSERTED_FORMATS = ("uri", "email", "date")


def jsonresume_validator() -> Draft4Validator:
    """The pinned v1.0.0 schema (draft-04) with FORMAT ASSERTION turned on."""
    checker = FormatChecker()
    missing = [name for name in ASSERTED_FORMATS if name not in checker.checkers]
    assert not missing, (
        f"format checkers not installed: {missing} — the schema gate would pass "
        "without checking them (install backend/requirements-dev.txt)"
    )
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return Draft4Validator(schema, format_checker=checker)


def assert_valid(document: dict) -> None:
    errors = [
        f"{list(e.absolute_path)}: {e.message}"
        for e in jsonresume_validator().iter_errors(document)
    ]
    assert not errors, "JSON Resume schema violations: " + "; ".join(errors)


def test_the_schema_gate_rejects_what_it_claims_to_reject():
    """Positive control for `assert_valid` itself.

    Every other test in this file passes when `assert_valid` is a no-op, so the
    validator needs its own proof: one violation per format keyword the module
    relies on, plus a structural one. Without this the round-1 gate looked
    identical to a correctly-armed one.
    """
    validator = jsonresume_validator()
    for document, expected in (
        ({"basics": {"url": ""}}, "empty string is not a uri"),
        ({"basics": {"url": "not a url"}}, "junk is not a uri"),
        ({"basics": {"email": "nope"}}, "junk is not an email"),
        ({"certificates": [{"date": "2024"}]}, "a bare year is not a `format: date`"),
        ({"work": [{"startDate": "March 2022"}]}, "prose is not an iso8601"),
        ({"unexpected": 1}, "the root object forbids extra properties"),
    ):
        assert list(validator.iter_errors(document)), f"gate missed: {expected}"


def serialize(profile: object, context: ResumeContext | None = None) -> dict:
    """Exactly what the endpoint emits: aliases applied, `None`s dropped."""
    resume = build_json_resume(profile, context or ResumeContext())
    return resume.model_dump(by_alias=True, exclude_none=True)


# ─── date + range parsing ───


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Mar 2022", "2022-03"),
        ("Sept 2020", "2020-09"),
        ("Mai 2019", "2019-05"),  # German month, same site (de)
        ("Mär 2018", "2018-03"),
        ("Dez 2017", "2017-12"),
        ("2016", "2016"),
        # Words that are not months are skipped; year-only precision survives.
        ("Summer 2020", "2020"),
        ("seit Anfang 2015", "2015"),
        ("2022-03", "2022-03"),
        ("2022-03-15", "2022-03-15"),
        ("Present", None),  # ongoing -> JSON Resume omits endDate
        ("Heute", None),
        ("", None),
        (None, None),
        (42, None),
        ("не дата", None),
    ],
)
def test_normalize_date(raw, expected):
    assert normalize_date(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2024-06-15", "2024-06-15"),
        ("15 Jun 2024", None),  # normalizes to 2024-06 — not full precision
        ("Jun 2024", None),
        ("2024", None),
        ("", None),
        (None, None),
    ],
)
def test_full_date_keeps_only_complete_dates(raw, expected):
    """`certificates[].date` is `format: date`: a year there fails a
    format-asserting validator and takes the WHOLE document with it."""
    assert full_date(raw) == expected


def test_a_year_only_certificate_date_is_omitted_not_faked():
    document = serialize(
        {"certifications": [{"name": "Cert", "issuer": "Body", "date": "2024"}]}
    )
    assert document["certificates"] == [{"name": "Cert", "issuer": "Body"}]
    assert_valid(document)


def test_a_full_certificate_date_survives():
    document = serialize({"certifications": [{"name": "Cert", "date": "2024-06-15"}]})
    assert document["certificates"] == [{"name": "Cert", "date": "2024-06-15"}]
    assert_valid(document)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2014 - 2016", ("2014", "2016")),
        ("2014 – 2016", ("2014", "2016")),  # en-dash
        ("2014 bis 2016", ("2014", "2016")),
        ("2016", ("2016", None)),
        ("2011 - 2013 - 2015", ("2011", "2015")),
        ("ongoing", (None, None)),
        (None, (None, None)),
    ],
)
def test_year_range(raw, expected):
    assert year_range(raw) == expected


# ─── URL / email hygiene (schema `format` fields) ───


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://example.test/x", "https://example.test/x"),
        ("http://example.test", "http://example.test"),
        ("  https://example.test/y  ", "https://example.test/y"),
        ("", None),
        ("   ", None),
        ("example.test/x", None),  # scheme-less handle: not a URI
        ("mailto:a@example.test", None),
        ("ftp://example.test", None),
        ("https://", None),
        (None, None),
        (7, None),
    ],
)
def test_clean_url(raw, expected):
    assert clean_url(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("jane@example.test", "jane@example.test"),
        (" jane@example.test ", "jane@example.test"),
        ("", None),
        ("not-an-address", None),
        ("two words@example.test", None),
        (None, None),
    ],
)
def test_clean_email(raw, expected):
    assert clean_email(raw) == expected


@pytest.mark.parametrize(
    ("url", "network"),
    [
        ("https://www.linkedin.com/in/jane", "LinkedIn"),
        ("https://de.linkedin.com/in/jane", "LinkedIn"),
        ("https://github.com/jane", "GitHub"),
        ("https://twitter.com/jane", "X"),
        ("https://x.com/jane", "X"),
        ("https://mastodon.example/@jane", "mastodon.example"),
    ],
)
def test_network_for(url, network):
    assert network_for(url) == network


def test_network_for_unparseable_url_is_never_empty():
    assert network_for("https:///nohost") == "Web"


@pytest.mark.parametrize(
    ("url", "username"),
    [
        ("https://www.linkedin.com/in/jane-doe", "jane-doe"),
        ("https://github.com/jane/", "jane"),
        ("https://example.test", None),
    ],
)
def test_username_for(url, username):
    assert username_for(url) == username


# ─── basics ───


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Berlin, Germany", {"city": "Berlin", "region": "Germany"}),
        ("Berlin", {"city": "Berlin"}),
        ("Berlin, Berlin, Germany", {"city": "Berlin", "region": "Berlin, Germany"}),
        ("  ", None),
        (None, None),
    ],
)
def test_build_location(raw, expected):
    location = build_location(raw)
    assert (
        location.model_dump(by_alias=True, exclude_none=True) if location else None
    ) == expected


def test_build_profiles_deduplicates_the_same_account():
    """The owner's LinkedIn lives in BOTH the profile contact and SOCIAL_LINKS;
    an agent reading it twice would double-count the same account."""
    profiles = build_profiles(
        {"linkedin": "https://www.linkedin.com/in/jane"},
        ["https://www.linkedin.com/in/jane", "https://github.com/jane"],
    )
    assert profiles is not None
    assert [p.url for p in profiles] == [
        "https://www.linkedin.com/in/jane",
        "https://github.com/jane",
    ]
    assert [p.network for p in profiles] == ["LinkedIn", "GitHub"]


def test_build_profiles_omitted_when_nothing_usable():
    assert build_profiles({"linkedin": ""}, ["", "not-a-url"]) is None


# ─── whole-document mapping ───


def test_empty_profile_yields_identity_only_document():
    """No profile data must still produce a VALID document, not a 500 and not a
    document full of empty strings."""
    document = serialize({}, ResumeContext(site_url="https://example.test"))
    assert document["$schema"] == JSON_RESUME_SCHEMA_URL
    assert document["basics"] == {"url": "https://example.test"}
    for section in (
        "work",
        "education",
        "skills",
        "languages",
        "certificates",
        "projects",
        "references",
    ):
        assert section not in document, f"{section} must be omitted, not empty"
    assert_valid(document)


def test_non_dict_profile_is_tolerated():
    assert serialize("not a profile")["basics"] == {}
    assert serialize(None)["basics"] == {}


def test_malformed_nodes_are_skipped_not_crashed():
    """Every collection node may be the wrong type in an uploaded blob."""
    document = serialize(
        {
            "name": 12345,
            "experience": "not a list",
            "education": [42, "junk"],
            "skills": {"unexpected": "object"},
            "languages": None,
            "certifications": [{"name": ""}],
            "recommendations": [[]],
        }
    )
    assert "name" not in document["basics"]
    for section in ("work", "education", "skills", "languages", "references"):
        assert section not in document
    # A certificate with nothing but an empty name yields an empty object, which
    # is still schema-valid; what matters is that no junk value is invented.
    assert document["certificates"] == [{}]
    assert_valid(document)


def test_ongoing_role_omits_end_date_and_maps_skills_to_highlights():
    document = serialize(
        {
            "experience": [
                {
                    "title": "Staff Engineer",
                    "company": "Acme",
                    "startDate": "Mar 2022",
                    "endDate": "Present",
                    "description": "Platform work.",
                    "skills": ["Python", "pgvector"],
                    "companyLinkedInUrl": "",
                }
            ]
        }
    )
    assert document["work"] == [
        {
            "name": "Acme",
            "position": "Staff Engineer",
            "startDate": "2022-03",
            "summary": "Platform work.",
            "highlights": ["Python", "pgvector"],
        }
    ]
    assert_valid(document)


def test_education_courses_accept_a_comma_separated_string():
    """The scraper writes education.skills as ONE comma-separated string while
    experience.skills is a list — both must land as arrays."""
    document = serialize(
        {
            "education": [
                {
                    "school": "Example TU",
                    "degree": "M.Sc.",
                    "years": "2014 - 2016",
                    "skills": "Distributed Systems, Machine Learning",
                }
            ]
        }
    )
    assert document["education"] == [
        {
            "institution": "Example TU",
            "studyType": "M.Sc.",
            "startDate": "2014",
            "endDate": "2016",
            "courses": ["Distributed Systems", "Machine Learning"],
        }
    ]


def test_projects_and_references_are_mapped():
    document = serialize(
        {
            "projects": [
                {
                    "name": "Beaconfolio",
                    "description": "Portfolio template.",
                    "url": "https://example.test/p",
                    "technologies": ["Angular", "FastAPI"],
                    "startDate": "2024",
                    "endDate": "2025",
                }
            ],
            "recommendations": [
                {"author": "Alex", "text": "Great engineer.", "authorTitle": "EM"}
            ],
        }
    )
    assert document["projects"] == [
        {
            "name": "Beaconfolio",
            "description": "Portfolio template.",
            "url": "https://example.test/p",
            "keywords": ["Angular", "FastAPI"],
            "startDate": "2024",
            "endDate": "2025",
        }
    ]
    assert document["references"] == [{"name": "Alex", "reference": "Great engineer."}]
    assert_valid(document)


def test_meta_carries_the_agent_signals():
    """`meta` is the only node the schema lets us extend — and the only place
    the availability signal and contact route can live (#252 AC: one fetch is
    enough to act on the candidate)."""
    document = serialize(
        {"name": "Jane"},
        ResumeContext(
            site_url="https://example.test/",
            availability="open",
            language="de",
            profile_version="v7",
            last_modified="2026-09-08T10:00:00+00:00",
            canonical_url="https://example.test/api/app/profile/resume.json",
        ),
    )
    assert document["meta"] == {
        "canonical": "https://example.test/api/app/profile/resume.json",
        "version": "v1.0.0",
        "lastModified": "2026-09-08T10:00:00+00:00",
        "language": "de",
        "profileVersion": "v7",
        "availability": "open",
        "contactUrl": "https://example.test/#contact",
    }
    assert_valid(document)


def test_meta_omits_contact_url_without_a_configured_site_url():
    """A relative contact route is useless to an off-site agent, so an
    unconfigured SITE_URL yields no route at all rather than `/#contact`."""
    document = serialize({"name": "Jane"}, ResumeContext(site_url=""))
    assert "contactUrl" not in document["meta"]
    assert "url" not in document["basics"]


# ─── the shipped demo persona, end to end ───


@pytest.mark.parametrize("language", ["en", "de"])
def test_demo_profile_maps_to_a_schema_valid_resume(language):
    """The data a fresh stack actually serves (#66 demo persona) must produce a
    complete, valid document — this is the fixture a forker sees first.

    Fed through `public_profile_view` because that is what the ENDPOINT feeds
    it; mapping the raw blob here would test a call that does not exist
    (#252 review, blocker 2).
    """
    raw = json.loads(
        (DEMO_PROFILE_DIR / f"profile_data_{language}.json").read_text(encoding="utf-8")
    )
    document = serialize(
        public_profile_view(raw),
        ResumeContext(
            site_url="https://example.test",
            social_links=["https://github.com/example"],
            availability="open",
            language=language,
            canonical_url="https://example.test/api/app/profile/resume.json",
        ),
    )
    assert_valid(document)
    for section in (
        "work",
        "education",
        "skills",
        "languages",
        "certificates",
        "references",
    ):
        assert document[section], f"{section} lost in the mapping"
    assert document["basics"]["name"]
    assert document["basics"]["label"]
    assert document["basics"]["location"]["city"]


def test_build_certificates_keeps_the_order_it_is_given():
    """No second sort here: `public_profile_view` orders certifications once,
    for the site and `resume.json` alike (PR #497 review round 1, major 1).
    A reordering mapper would make the two disagree again."""
    document = serialize(
        {
            "certifications": [
                {"name": "old", "issueDate": "Nov 2023"},
                {"name": "undated"},
                {"name": "new", "issueDate": "Sep 2026"},
            ]
        }
    )
    assert [c["name"] for c in document["certificates"]] == ["old", "undated", "new"]


def test_scraper_issue_date_is_read_and_still_needs_full_precision():
    document = serialize(
        {
            "certifications": [
                {"name": "full", "issueDate": "2026-09-18"},
                {"name": "coarse", "issueDate": "Sep 2026"},
            ]
        }
    )
    assert document["certificates"] == [
        {"name": "full", "date": "2026-09-18"},
        {"name": "coarse"},
    ]


def test_an_explicit_date_wins_over_issue_date():
    """Both fields on ONE entry pins the precedence (PR #497 review, minor 2):
    `date` is the hand-set field and the one the site displays."""
    document = serialize(
        {
            "certifications": [
                {"name": "both", "date": "2025-01-02", "issueDate": "2026-09-18"}
            ]
        }
    )
    assert document["certificates"] == [{"name": "both", "date": "2025-01-02"}]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Sep 2026", (2026, 9)),
        ("Sept. 2026", (2026, 9)),
        ("September 2026", (2026, 9)),
        ("Issued Sep 2026", (2026, 9)),
        ("Okt 2026", (2026, 10)),
        ("Okt. 2026", (2026, 10)),
        ("Mai 2026", (2026, 5)),
        ("Dez 2025", (2025, 12)),
        ("Mär 2026", (2026, 3)),
        ("März 2026", (2026, 3)),
        ("MÄRZ 2026", (2026, 3)),
        ("Ma\u0308rz 2026", (2026, 3)),  # decomposed umlaut (NFD)
        ("Mrz 2026", (2026, 3)),
        ("2026-09", (2026, 9)),
        ("2026-09-18", (2026, 9)),  # the day is ignored: same month ties
        ("2025", (2025, 0)),  # year-only sorts below every month of its year
        ("", None),
        ("soon", None),
        ("Present", None),
        (None, None),
        (2026, None),
    ],
)
def test_month_sort_key(raw, expected):
    assert month_sort_key(raw) == expected


def test_a_year_only_date_sorts_below_every_month_of_its_year():
    assert (
        month_sort_key("Dez 2024") < month_sort_key("2025") < month_sort_key("Jan 2025")
    )
