"""JSON Resume (v1.0.0) projection of the public profile (#252).

WHY a second serialization of data the site already renders: recruiter research
increasingly runs through AI assistants and answer engines, which rank what they
can *read* — and reading a candidate out of rendered HTML is lossy guesswork.
`GET {api_prefix}/profile/resume.json` hands an agent the whole candidate in one
request, in the schema the ecosystem already parses
(https://jsonresume.org, schema v1.0.0), so skills/experience/education can be
quoted with provenance instead of scraped.

Design rules this module follows:

* **Pure mapping.** No DB, no HTTP, no settings import — the caller passes the
  profile dict and a `ResumeContext`. That keeps the vocabulary translation
  (LinkedIn-flavoured scraper JSON -> JSON Resume) unit-testable against
  partial, malformed and empty inputs, which is exactly where a scraped profile
  hurts.
* **Omit, never invent.** Every optional field is dropped when the source has
  nothing to say (`response_model_exclude_none=True` at the endpoint). An empty
  string in `basics.email` or a `""` in a `format: uri` field is *invalid*
  against the schema, while an absent key is simply not claimed. The tests
  assert this with a FORMAT-ASSERTING validator (`jsonschema.FormatChecker()`
  plus `rfc3986-validator`, so `uri`, `email` and `date` are really checked, not
  merely annotated) — the round-1 version used the draft-4 default checker,
  which asserts neither `uri` nor `date` and therefore proved less than the
  claim (#252 review, major 3).
* **Defensive about types.** The source is an operator-uploaded blob: any node
  may be the wrong type. Every accessor coerces instead of trusting.
"""

import re
from collections.abc import Sequence
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

#: The exact schema revision this document is mapped against; emitted as
#: `$schema` so a consumer can validate without guessing the version.
JSON_RESUME_SCHEMA_URL = (
    "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json"
)
JSON_RESUME_VERSION = "v1.0.0"

#: JSON Resume's `iso8601` definition accepts `YYYY`, `YYYY-MM` or `YYYY-MM-DD`.
_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
_ISO_DATE_RE = re.compile(
    r"^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$"
)
#: Word tokens, unicode-aware so German month names ("Mär") still tokenize.
_WORD_RE = re.compile(r"[^\W\d_]+")

#: Month lookup by lowercased 3-letter prefix. Both site languages are covered
#: (en + de, see `SUPPORTED_LANGUAGES`); an unknown language simply degrades to
#: year-only precision rather than mis-parsing.
_MONTHS: dict[str, int] = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "mär": 3,
    "mrz": 3,
    "apr": 4,
    "may": 5,
    "mai": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "okt": 10,
    "nov": 11,
    "dec": 12,
    "dez": 12,
}

#: Hosts we can name confidently in `basics.profiles[].network`. Anything else
#: falls back to the hostname itself — a wrong-but-confident label ("Twitter"
#: for a Mastodon instance) is worse than the literal host.
_NETWORKS: tuple[tuple[str, str], ...] = (
    ("linkedin.com", "LinkedIn"),
    ("github.com", "GitHub"),
    ("gitlab.com", "GitLab"),
    ("x.com", "X"),
    ("twitter.com", "X"),
    ("stackoverflow.com", "Stack Overflow"),
    ("xing.com", "Xing"),
    ("medium.com", "Medium"),
    ("dev.to", "DEV"),
    ("bsky.app", "Bluesky"),
    ("youtube.com", "YouTube"),
)


def _text(value: object) -> str:
    """A trimmed string, whatever the source node actually was."""
    return value.strip() if isinstance(value, str) else ""


def _optional(value: object) -> str | None:
    """`None` for anything empty — the signal that a field must be omitted."""
    return _text(value) or None


def _mapping(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _items(value: object) -> list[dict]:
    """Only the dict entries of a list node; scalars in an object list are junk."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _strings(value: object) -> list[str]:
    """Non-empty strings out of a list node, or a comma-separated string."""
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if not isinstance(value, list):
        return []
    return [_text(item) for item in value if _text(item)]


def clean_url(value: object) -> str | None:
    """An absolute http(s) URL, or `None`.

    The schema declares `format: uri` on every URL field, and scraped profiles
    routinely carry `""` or a bare handle there. Emitting those produces a
    document that fails validation for a value we never had.
    """
    url = _text(value)
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme in ("http", "https") and parsed.netloc:
        return url
    return None


def clean_email(value: object) -> str | None:
    """An address-shaped string, or `None` (`format: email` on `basics.email`)."""
    email = _text(value)
    return email if "@" in email and " " not in email else None


def normalize_date(value: object) -> str | None:
    """Map a human date ("Mar 2022", "2016", "Heute") onto the `iso8601` shape.

    Returns `YYYY-MM` when a month name is recognizable, `YYYY` when only a year
    is, and `None` when there is no year at all — which is precisely how an
    ongoing role reads ("Present"/"Heute"), and JSON Resume's convention for
    ongoing is an ABSENT `endDate`.
    """
    text = _text(value)
    if _ISO_DATE_RE.match(text):
        return text
    year = _YEAR_RE.search(text)
    if not year:
        return None
    for token in _WORD_RE.findall(text.lower()):
        month = _MONTHS.get(token[:3])
        if month is not None:
            return f"{year.group()}-{month:02d}"
    return year.group()


def full_date(value: object) -> str | None:
    """A complete `YYYY-MM-DD`, or `None` — for `format: date` fields only.

    `certificates[].date` is the one date in this schema declared with
    `format: date` rather than the `iso8601` pattern, so — unlike a work
    `startDate` — a year or a year-month there is INVALID under a
    format-asserting validator, and the whole document fails over one
    credential. Sources are routinely coarse ("2024", "Jun 2024"), and the
    alternatives to dropping the field are worse: fabricate a day, or publish a
    document a strict consumer rejects wholesale. So the standard field is
    emitted only at full precision; a coarser credential date stays visible on
    the HTML CV, which has no schema to satisfy (#252 review round 1, major 3).
    """
    text = normalize_date(value) or ""
    return text if len(text) == 10 else None


def year_range(value: object) -> tuple[str | None, str | None]:
    """`"2014 - 2016"` -> `("2014", "2016")`; a single year -> start only.

    Year extraction rather than splitting on a dash: the separator varies
    ("-", "–", "to", "bis") across locales and scrapers, the years do not.
    """
    years = _YEAR_RE.findall(_text(value))
    if not years:
        return None, None
    if len(years) == 1:
        return years[0], None
    return years[0], years[-1]


def network_for(url: str) -> str:
    """The human name of a profile URL's platform, else its hostname."""
    host = (urlparse(url).hostname or "").removeprefix("www.")
    for domain, name in _NETWORKS:
        if host == domain or host.endswith(f".{domain}"):
            return name
    return host or "Web"


def username_for(url: str) -> str | None:
    """The last path segment of a profile URL — LinkedIn's `/in/<handle>` etc."""
    segments = [part for part in urlparse(url).path.split("/") if part]
    return segments[-1] if segments else None


class ResumeModel(BaseModel):
    """Base for every node: python snake_case in, JSON Resume camelCase out."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ResumeLocation(ResumeModel):
    city: str | None = None
    region: str | None = None


class ResumeProfileLink(ResumeModel):
    network: str
    username: str | None = None
    url: str | None = None


class ResumeBasics(ResumeModel):
    name: str | None = None
    label: str | None = None
    email: str | None = None
    url: str | None = None
    summary: str | None = None
    location: ResumeLocation | None = None
    profiles: list[ResumeProfileLink] | None = None


class ResumeWork(ResumeModel):
    name: str | None = None
    position: str | None = None
    url: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    summary: str | None = None
    highlights: list[str] | None = None


class ResumeEducation(ResumeModel):
    institution: str | None = None
    study_type: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    courses: list[str] | None = None


class ResumeSkill(ResumeModel):
    name: str


class ResumeLanguage(ResumeModel):
    language: str | None = None
    fluency: str | None = None


class ResumeCertificate(ResumeModel):
    name: str | None = None
    issuer: str | None = None
    date: str | None = None
    url: str | None = None


class ResumeProject(ResumeModel):
    name: str | None = None
    description: str | None = None
    url: str | None = None
    keywords: list[str] | None = None
    start_date: str | None = None
    end_date: str | None = None


class ResumeReference(ResumeModel):
    name: str | None = None
    reference: str | None = None


class ResumeMeta(ResumeModel):
    """`meta` is the ONLY node whose schema allows extra keys.

    The root object is `additionalProperties: false`, so the site-specific
    signals an agent needs to act on a candidate — where to reach them, whether
    they are looking — must live here or nowhere.
    """

    canonical: str | None = None
    version: str = JSON_RESUME_VERSION
    last_modified: str | None = None
    language: str | None = None
    profile_version: str | None = None
    #: Job-search state (#271): "open" | "listening" | "not_looking".
    availability: str | None = None
    #: Where an agent sends its human: the site's contact section.
    contact_url: str | None = None


class JsonResume(ResumeModel):
    schema_url: str = Field(default=JSON_RESUME_SCHEMA_URL, alias="$schema")
    basics: ResumeBasics
    work: list[ResumeWork] | None = None
    education: list[ResumeEducation] | None = None
    skills: list[ResumeSkill] | None = None
    languages: list[ResumeLanguage] | None = None
    certificates: list[ResumeCertificate] | None = None
    projects: list[ResumeProject] | None = None
    references: list[ResumeReference] | None = None
    meta: ResumeMeta


class ResumeContext(BaseModel):
    """Everything outside the profile blob that the document needs.

    All of it is runtime site config (#65) or admin-editable state (#271), never
    a literal in this module — a forker's deployment produces a forker's resume.
    """

    site_url: str = ""
    social_links: Sequence[str] = ()
    availability: str | None = None
    language: str | None = None
    profile_version: str | None = None
    last_modified: str | None = None
    #: Absolute URL of this very document (`meta.canonical`).
    canonical_url: str | None = None


def build_location(value: object) -> ResumeLocation | None:
    """`"Berlin, Germany"` -> city + region.

    `countryCode` is deliberately NOT emitted: the schema wants ISO-3166-1
    alpha-2 and the source is a free-text locality, so deriving one would mean
    guessing. `region` is free text, which makes the tail lossless and valid.
    """
    parts = [part.strip() for part in _text(value).split(",") if part.strip()]
    if not parts:
        return None
    location = ResumeLocation(city=parts[0])
    if len(parts) > 1:
        location.region = ", ".join(parts[1:])
    return location


def build_profiles(
    contact: dict, social_links: Sequence[str]
) -> list[ResumeProfileLink] | None:
    """Social presence: the profile's own LinkedIn plus every configured link.

    Deduplicated by URL — the owner's LinkedIn is typically in BOTH sources, and
    an agent reading the same account twice may double-count it.
    """
    urls: list[str] = []
    for candidate in (contact.get("linkedin"), *social_links):
        url = clean_url(candidate)
        if url and url not in urls:
            urls.append(url)
    if not urls:
        return None
    return [
        ResumeProfileLink(network=network_for(url), username=username_for(url), url=url)
        for url in urls
    ]


def build_basics(profile: dict, context: ResumeContext) -> ResumeBasics:
    contact = _mapping(profile.get("contact"))
    return ResumeBasics(
        name=_optional(profile.get("name")),
        label=_optional(profile.get("headline")),
        email=clean_email(contact.get("email")),
        url=clean_url(context.site_url),
        summary=_optional(profile.get("about")),
        location=build_location(profile.get("location")),
        profiles=build_profiles(contact, context.social_links),
    )


def build_work(profile: dict) -> list[ResumeWork] | None:
    """Experience entries. `endDate` is omitted for an ongoing role."""
    work = [
        ResumeWork(
            name=_optional(entry.get("company")),
            position=_optional(entry.get("title")),
            url=clean_url(entry.get("companyLinkedInUrl")),
            start_date=normalize_date(entry.get("startDate")),
            end_date=normalize_date(entry.get("endDate")),
            summary=_optional(entry.get("description")),
            # Per-role skills are the closest thing the scraper has to
            # accomplishments; JSON Resume has no per-role skill slot and
            # `highlights` is the free-text list consumers render.
            highlights=_strings(entry.get("skills")) or None,
        )
        for entry in _items(profile.get("experience"))
    ]
    return work or None


def build_education(profile: dict) -> list[ResumeEducation] | None:
    education = []
    for entry in _items(profile.get("education")):
        start, end = year_range(entry.get("years"))
        education.append(
            ResumeEducation(
                institution=_optional(entry.get("school")),
                study_type=_optional(entry.get("degree")),
                start_date=start,
                end_date=end,
                courses=_strings(entry.get("skills")) or None,
            )
        )
    return education or None


def build_skills(profile: dict) -> list[ResumeSkill] | None:
    skills = [ResumeSkill(name=name) for name in _strings(profile.get("skills"))]
    return skills or None


def build_languages(profile: dict) -> list[ResumeLanguage] | None:
    languages = [
        ResumeLanguage(
            language=_optional(entry.get("name")),
            fluency=_optional(entry.get("proficiency")),
        )
        for entry in _items(profile.get("languages"))
    ]
    return languages or None


def _certificate_date(entry: dict) -> object:
    """The bundled demo profile writes `date`; the LinkedIn scraper writes
    `issueDate` ("Sep 2026"). Either is the credential's issue date."""
    return entry.get("date") or entry.get("issueDate")


def build_certificates(profile: dict) -> list[ResumeCertificate] | None:
    # Newest first, undated last. The upload's order is LinkedIn's API order,
    # not a date order. `YYYY[-MM[-DD]]` compares correctly as text, and
    # `sorted(reverse=True)` is still stable, so same-month entries keep the
    # upload's relative order (matching the HTML CV's sort).
    entries = _items(profile.get("certifications"))
    dates = [normalize_date(_certificate_date(e)) for e in entries]
    dated = sorted(
        (e for e, d in zip(entries, dates, strict=True) if d),
        key=lambda e: normalize_date(_certificate_date(e)) or "",
        reverse=True,
    )
    undated = [e for e, d in zip(entries, dates, strict=True) if not d]
    certificates = [
        ResumeCertificate(
            name=_optional(entry.get("name")),
            issuer=_optional(entry.get("issuer")),
            # `format: date` — full precision or nothing, see `full_date`.
            date=full_date(_certificate_date(entry)),
            url=clean_url(entry.get("credentialUrl")),
        )
        for entry in dated + undated
    ]
    return certificates or None


def build_projects(profile: dict) -> list[ResumeProject] | None:
    projects = []
    for entry in _items(profile.get("projects")):
        start, end = year_range(
            f"{_text(entry.get('startDate'))} {_text(entry.get('endDate'))}"
        )
        projects.append(
            ResumeProject(
                name=_optional(entry.get("name")) or _optional(entry.get("title")),
                description=_optional(entry.get("description")),
                url=clean_url(entry.get("url")),
                keywords=_strings(entry.get("skills"))
                or _strings(entry.get("technologies"))
                or None,
                start_date=start,
                end_date=end,
            )
        )
    return projects or None


def build_references(profile: dict) -> list[ResumeReference] | None:
    references = [
        ResumeReference(
            name=_optional(entry.get("author")),
            reference=_optional(entry.get("text")),
        )
        for entry in _items(profile.get("recommendations"))
    ]
    return references or None


def build_meta(context: ResumeContext) -> ResumeMeta:
    site_url = _text(context.site_url).rstrip("/")
    return ResumeMeta(
        canonical=clean_url(context.canonical_url),
        last_modified=_optional(context.last_modified),
        language=_optional(context.language),
        profile_version=_optional(context.profile_version),
        availability=_optional(context.availability),
        # The one action an agent can take on behalf of its human. Anchored on
        # the home page's `#contact` section (`contact.component.html`).
        contact_url=f"{site_url}/#contact" if site_url else None,
    )


def build_json_resume(profile: object, context: ResumeContext) -> JsonResume:
    """Map an uploaded profile blob onto a JSON Resume document.

    A non-dict (or empty) profile yields a document with only the site-derived
    identity — valid, honest, and never a 500.
    """
    data = _mapping(profile)
    return JsonResume(
        basics=build_basics(data, context),
        work=build_work(data),
        education=build_education(data),
        skills=build_skills(data),
        languages=build_languages(data),
        certificates=build_certificates(data),
        projects=build_projects(data),
        references=build_references(data),
        meta=build_meta(context),
    )
