"""Title and meta-description derivation for imported posts.

An imported LinkedIn post has a body and nothing else, so its ``title`` (the
``<title>``/``og:title`` of the post page) and ``summary`` (the meta
description and the blog-card blurb) are DERIVED from that body. Search
engines read both, and the first derivation (``legacy_derive_title``, kept
below so stored rows can be recognised) produced titles cut mid-sentence with a
trailing "…" and summaries that were the raw first 200 characters — emoji,
hashtag lines and all.

Everything here is a PURE function of the post body: no owner name, no site
string, no configuration. That is deliberate — this repository is a template,
and a derivation that knew anything about one deployment would be wrong for
every other one. The only content-specific knowledge is the small, named
:data:`LINKEDIN_BOILERPLATE_PATTERNS` list of generic artefacts LinkedIn itself
appends to shared posts.

Determinism is the contract: the same body always yields the same title and
summary, which is what lets the upsert and the re-derive tool tell a
machine-derived value from one a human edited (``is_machine_title``).
"""

import re
import unicodedata

# The title budget. ~70 characters is roughly what a results page shows before
# it truncates on its own; a longer title is cut there by the engine anyway, so
# cutting it ourselves on a word boundary is strictly better.
TITLE_MAX_CHARS = 70
# The meta-description budget. Engines show ~150-160 characters.
SUMMARY_MAX_CHARS = 150
# The fallback when a body has no usable text at all (emoji/hashtags only).
DEFAULT_TITLE = "LinkedIn Post"
# Below this many characters a word-boundary cut would throw away most of the
# text (one very long token), so the cut is made mid-word instead.
_MIN_WORD_CUT = 20
ELLIPSIS = "…"

# Generic text LinkedIn (or the badge platforms that share through it) appends
# to a post. It describes the share mechanism, not the post, so it must not
# become a title or a meta description. Each entry is matched
# case-insensitively and removed up to the end of its sentence/line. Keep this
# list GENERIC — a phrase only one owner writes does not belong here.
#
# The badge-share subset is named on its own: when a post is NOTHING but such a
# share, the phrase itself is the best generic title there is
# (:func:`_badge_phrase`).
BADGE_BOILERPLATE_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Credly/Accredible-style badge shares: "View my verified achievement from X."
    # The leading \b is load-bearing: without it "review"/"preview" matched
    # and the rest of the sentence was deleted (PR #493 review, round 2).
    re.compile(
        r"\bview my verified achievement (?:from|on) [^.!?\n]*[.!?]?", re.IGNORECASE
    ),
    # Badge shares worded in the third person / without "my".
    re.compile(
        r"\bview (?:the )?verified (?:achievement|credential|badge)[^.!?\n]*[.!?]?",
        re.IGNORECASE,
    ),
)
LINKEDIN_BOILERPLATE_PATTERNS: tuple[re.Pattern[str], ...] = (
    *BADGE_BOILERPLATE_PATTERNS,
    # LinkedIn's own collapsed-text artefact when a scraped body was truncated.
    re.compile(r"…\s*(?:see more|more)\s*$", re.IGNORECASE),
    # Reshare chrome copied with the text.
    re.compile(r"^\s*(?:reposted|repost) this\s*$", re.IGNORECASE),
)

# A hashtag starts with a LETTER: "#1 priority" is a rank, not a tag.
_HASHTAG = r"#(?=[^\W\d_])[\w-]+"
# NOTE: there is deliberately no regex for the TRAILING run. The obvious one,
# ``(?:\s*#tag)+\s*$``, is quadratic: ``re.sub`` retries the run from every
# hashtag and fails at ``$`` each time, measured at 1.28 s for 14k characters
# of hashtags followed by one word (PR #493 review). It is stripped token by
# token from the right instead (:func:`_strip_trailing_hashtags`).
_HASHTAG_RUN_LEADING = re.compile(rf"^\s*(?:{_HASHTAG}\s*)+")
_HASHTAG_INLINE = re.compile(r"#(?=[^\W\d_])([\w-]+)")
_WHITESPACE = re.compile(r"\s+")
# Leading characters that START text rather than decorate it: opening
# quotes/brackets belong to the text that follows. Everything else that is not
# a word character is decoration (bullets, arrows, dashes, stray punctuation)
# unless :func:`_starts_text` says otherwise.
_OPENERS = frozenset("\"'“‘([«")
# Clause boundaries a too-long first sentence may be cut at WITHOUT an
# ellipsis: the head before them reads as complete. Commas are deliberately
# absent — the head before a comma usually does not.
_CLAUSE_BOUNDARY = re.compile(r"(?::|;| —| –| -)\s")
# A clause head shorter than this says too little to be a title.
_MIN_CLAUSE_HEAD = 30
# A CANDIDATE sentence boundary: terminal punctuation followed by whitespace.
# Whether a "." candidate really ends a sentence is decided by
# :func:`_ends_sentence` — "vs.", "e.g." and "L.A." do not.
_SENTENCE_GAP = re.compile(r"[.!?]\s+")
# Words after which a "." does NOT end the sentence, compared
# case-insensitively with the word before the dot (that dot removed). Keep
# this list GENERIC — common English and German abbreviations, nothing one
# owner happens to write. Dotted initialisms ("L.A.", "U.S.", "z.B.") need no
# entry: :data:`_INITIALISM` recognises them by shape.
SENTENCE_ABBREVIATIONS: frozenset[str] = frozenset(
    {
        # English
        "vs",
        "e.g",
        "i.e",
        "mr",
        "mrs",
        "ms",
        "dr",
        "prof",
        "st",
        "approx",
        "incl",
        "jr",
        "sr",
        # German
        "z.b",
        "bzw",
        "ca",
        "d.h",
    }
)
# NOT listed, deliberately: "no", "etc", "inc", "ltd", "usw". Each often ENDS a
# sentence ("I said no. Then…", "AWS, GCP etc. All…", "Google Inc. After…"),
# and their mid-sentence uses are already covered by the lowercase/digit rule
# in :func:`_ends_sentence` ("No. 1", "etc. and") — listing them only fused
# real sentences into run-ons (PR #498 review, round 1).
# Two or more single letters each followed by a dot: "L.A.", "U.S.", "e.g.",
# "z.B.", "d.h.". A lone "A." is NOT one — "Plan A. Then" ends a sentence.
_INITIALISM = re.compile(r"(?:[^\W\d_]\.){2,}")
# Leading punctuation of the word before a dot: the quote of '"L.A.'.
_LEADING_NON_WORD = re.compile(r"^\W+")
# The imperative that opens a badge share ("View my", "View the", "View").
_BADGE_LEAD = re.compile(r"^view\s+(?:(?:my|the)\s+)?", re.IGNORECASE)
# Punctuation that must not dangle before an ellipsis.
_TRAILING_JOINERS = " ,;:-–—(/&"


# "Other symbol" (So) characters that are part of TEXT, not decoration:
# "25°C", "25℃", "№ 5". Python's unicodedata has no Extended_Pictographic
# property, so the So strip is an exclusion list rather than an emoji list.
# ©/®/™ are deliberately NOT here: dropping them from a title loses nothing.
_TEXTUAL_SYMBOLS = frozenset("°℃℉№")
# Zero-width (non-)joiner. Between two letters it is ORTHOGRAPHY (Persian,
# Indic scripts: "می‌خواهم"), not emoji glue, and removing it joins word parts.
_JOINERS = frozenset("\u200c\u200d")


def _is_symbol(ch: str) -> bool:
    """Emoji and pictographs (So), non-ASCII modifier symbols such as skin
    tones (Sk — ASCII ``^``/`` ` `` are Sk too and are kept), surrogates and
    private-use glyphs. Each is replaced by a space: an emoji often stands
    between two words. Degree-style signs that belong to a number are kept
    (:data:`_TEXTUAL_SYMBOLS`)."""
    if ch in _TEXTUAL_SYMBOLS:
        return False
    cat = unicodedata.category(ch)
    if cat == "Sk":
        return ord(ch) > 127
    return cat in ("So", "Cs", "Co")


def _is_invisible(ch: str) -> bool:
    """Zero-width joiners, soft hyphens, BOMs (Cf), variation selectors and
    enclosing marks (Me) — the glue inside emoji sequences. Removed without a
    space: a soft hyphen sits INSIDE a word, and a keycap ("1️⃣" = "1" + U+FE0F
    + U+20E3 COMBINING ENCLOSING KEYCAP) must reduce to its digit, not leave a
    stray enclosing glyph behind."""
    cat = unicodedata.category(ch)
    return cat in ("Cf", "Me") or 0xFE00 <= ord(ch) <= 0xFE0F


def _is_letter_part(ch: str) -> bool:
    """A letter, or a mark attached to one (an Indic virama is Mn)."""
    return ch.isalpha() or unicodedata.category(ch).startswith("M")


def _strip_symbols(text: str) -> str:
    out = []
    last = len(text) - 1
    for i, ch in enumerate(text):
        if (
            ch in _JOINERS
            and 0 < i < last
            and _is_letter_part(text[i - 1])
            and _is_letter_part(text[i + 1])
        ):
            out.append(ch)
            continue
        if _is_invisible(ch):
            continue
        out.append(" " if _is_symbol(ch) else ch)
    return "".join(out)


def _is_word_char(ch: str) -> bool:
    """Exactly ``re``'s ``\\w`` for ``str`` patterns."""
    return ch.isalnum() or ch == "_"


def _strip_trailing_hashtags(text: str) -> str:
    """Remove a trailing run of hashtags (and the whitespace around it) — the
    same strings ``(?:\\s*#tag)+\\s*$`` removes, in ONE right-to-left pass.

    Each character is examined a bounded number of times, so the cost is
    linear in ``len(text)`` however many hashtags precede the end. A tag is
    ``#`` + a non-digit word character + ``[\\w-]*``; the tags may touch
    (``#a#b``) or follow a word directly (``word#tag``), as in the regex.

    A tag containing a zero-width non-joiner between letters (Persian) is
    not a ``[\\w-]`` run, so it is kept as text rather than stripped —
    harmless, and the price of keeping ZWNJ orthography intact.
    """
    end = len(text)
    while end > 0 and text[end - 1].isspace():
        end -= 1
    kept = len(text)  # nothing stripped yet
    while True:
        start = end
        while start > 0 and (text[start - 1] == "-" or _is_word_char(text[start - 1])):
            start -= 1
        # The token must be non-empty, preceded by "#", and start with a
        # word character that is neither a digit nor "_" ("#1" is a rank).
        if start == end or start == 0 or text[start - 1] != "#":
            break
        first = text[start]
        if first == "-" or first == "_" or first.isdecimal():
            break
        end = start - 1
        while end > 0 and text[end - 1].isspace():
            end -= 1
        kept = end
    return text[:kept]


def _starts_text(text: str, i: int) -> bool:
    """Whether ``text[i]`` begins the readable text (so the leading strip
    stops there) rather than decorating it."""
    ch = text[i]
    nxt = text[i + 1] if i + 1 < len(text) else ""
    if _is_word_char(ch) or ch in _OPENERS:
        return True
    # "$5M raised", "€10", "£1bn": a currency sign belongs to its amount.
    if unicodedata.category(ch) == "Sc":
        return True
    # "#1 priority" is a rank; "+1 to this"/"-5 °C"/"−5" are signed numbers.
    if ch in "#+-−" and nxt.isdecimal():
        return True
    # ".NET 10", ".5 seconds" — but not the last dot of "...Wait".
    return ch == "." and _is_word_char(nxt) and (i == 0 or text[i - 1] != ".")


def _strip_leading_junk(text: str) -> str:
    i = 0
    while i < len(text) and not _starts_text(text, i):
        i += 1
    return text[i:]


def _strip_boilerplate(text: str) -> str:
    for pattern in LINKEDIN_BOILERPLATE_PATTERNS:
        text = pattern.sub(" ", text)
    return text


def clean_line(line: str) -> str:
    """One body line, made fit to be read as prose.

    Removes emoji/symbols, the generic boilerplate, a leading or trailing run
    of hashtags (a line made ONLY of hashtags becomes empty), turns an inline
    ``#Topic`` into ``Topic``, strips leading decoration and collapses
    whitespace. Returns "" when nothing readable is left.
    """
    text = _strip_symbols(line)
    text = _strip_boilerplate(text)
    text = _strip_trailing_hashtags(text)
    text = _HASHTAG_RUN_LEADING.sub("", text)
    text = _HASHTAG_INLINE.sub(r"\1", text)
    text = _WHITESPACE.sub(" ", text).strip()
    text = _strip_leading_junk(text).strip()
    # A line with no letter or digit left (",", "…", "—") is not text.
    if not any(ch.isalnum() for ch in text):
        return ""
    return text


def clean_lines(content: str) -> list[str]:
    """Every readable line of a body, in order (see :func:`clean_line`)."""
    return [c for c in (clean_line(line) for line in content.splitlines()) if c]


def truncate_on_word(text: str, max_chars: int) -> str:
    """``text`` if it fits, else cut to at most ``max_chars`` INCLUDING a
    trailing "…", on a word boundary, with no dangling joiner before the "…".

    The ellipsis is appended ONLY when characters were actually dropped.
    """
    if len(text) <= max_chars:
        return text
    budget = max_chars - len(ELLIPSIS)
    cut = text[:budget]
    # Cut fell inside a word: back up to the previous space, unless that would
    # discard nearly everything (one enormous token).
    if text[budget] != " " and " " in cut:
        word_cut = cut.rsplit(" ", 1)[0]
        if len(word_cut) >= _MIN_WORD_CUT:
            cut = word_cut
    cut = cut.rstrip(_TRAILING_JOINERS + ".…")
    return cut + ELLIPSIS


#: Characters before a candidate "." searched for the word it closes. Longer
#: than any abbreviation or realistic initialism ("N.A.S.A.", '("e.g.').
_ABBREVIATION_LOOKBACK = 40


def _is_abbreviation(text: str) -> bool:
    """Whether ``text`` ends in a word whose final "." is an abbreviation's
    or an initialism's, not a full stop (see :data:`SENTENCE_ABBREVIATIONS`).
    An ellipsis ("Wait...", "etc...") never qualifies: with its last dot
    removed it still ends in "." and so matches neither test."""
    # Callers pass text ending in "." — never empty or all-whitespace.
    word = _LEADING_NON_WORD.sub("", text.rsplit(None, 1)[-1])
    if not word.endswith("."):
        return False
    return (
        word[:-1].lower() in SENTENCE_ABBREVIATIONS
        or _INITIALISM.fullmatch(word) is not None
    )


def _ends_sentence(text: str, gap: re.Match[str]) -> bool:
    """Whether the candidate boundary ``gap`` (punctuation + whitespace) in
    ``text`` really ends a sentence. "!" and "?" always do. A "." does not
    when the next character is a lowercase letter or a digit ("approx. 5",
    "Inc. and"), nor when it closes an abbreviation or initialism."""
    if text[gap.start()] != ".":
        return True
    nxt = text[gap.end()] if gap.end() < len(text) else ""
    if nxt.islower() or nxt.isdecimal():
        return False
    # Only the word before the dot matters, so look back over a bounded window:
    # slicing from the start of the text made each candidate O(n) and the
    # whole split quadratic on a long first line.
    window = text[max(0, gap.start() + 1 - _ABBREVIATION_LOOKBACK) : gap.start() + 1]
    return not _is_abbreviation(window)


def split_sentences(text: str) -> list[str]:
    """``text`` split into sentences at the boundaries :func:`_ends_sentence`
    accepts; the whitespace between sentences is dropped."""
    sentences = []
    start = 0
    for gap in _SENTENCE_GAP.finditer(text):
        if _ends_sentence(text, gap):
            sentences.append(text[start : gap.start() + 1])
            start = gap.end()
    sentences.append(text[start:])
    return sentences


def _badge_phrase(content: str) -> str:
    """The first badge-share phrase of ``content`` made into a title:
    "View my verified achievement from Coursera." -> "Verified achievement
    from Coursera". The platform name comes from the post text itself, so
    nothing deployment-specific is involved. "" when there is none."""
    for line in content.splitlines():
        text = _strip_symbols(line)
        for pattern in BADGE_BOILERPLATE_PATTERNS:
            match = pattern.search(text)
            if match is None:
                continue
            phrase = _BADGE_LEAD.sub("", match.group(0))
            phrase = _HASHTAG_INLINE.sub(r"\1", _strip_trailing_hashtags(phrase))
            phrase = _WHITESPACE.sub(" ", phrase).strip().rstrip(".!?").rstrip()
            phrase = phrase[:1].upper() + phrase[1:]
            return truncate_on_word(phrase, TITLE_MAX_CHARS)
    return ""


def derive_title(content: str) -> str:
    """The title of a post derived from its body.

    The first readable line, built up sentence by sentence while it fits in
    :data:`TITLE_MAX_CHARS`. A first sentence that alone is too long is cut at
    its last clause boundary (":", ";", a spaced dash) that fits — that head
    reads as complete, so it gets no ellipsis — and otherwise on a word
    boundary, marked with "…" because text really was dropped. A single trailing full stop is dropped
    (titles do not end in one; an abbreviation's dot, "U.S.", is kept); "!"
    and "?" are kept. Sentences are split by :func:`split_sentences`, so
    "vs." or "L.A." never ends one. A body that is nothing but a badge share
    is titled by the share's own phrase ("Verified achievement from X").
    """
    lines = clean_lines(content)
    if not lines:
        # Nothing but boilerplate: a badge share still names its own subject.
        return _badge_phrase(content) or DEFAULT_TITLE
    sentences = split_sentences(lines[0])
    title = sentences[0]
    for sentence in sentences[1:]:
        candidate = f"{title} {sentence}"
        if len(candidate) > TITLE_MAX_CHARS:
            break
        title = candidate
    if len(title) > TITLE_MAX_CHARS:
        heads = [
            title[: m.start()].rstrip()
            for m in _CLAUSE_BOUNDARY.finditer(title)
            if _MIN_CLAUSE_HEAD <= m.start() <= TITLE_MAX_CHARS
        ]
        title = heads[-1] if heads else truncate_on_word(title, TITLE_MAX_CHARS)
    if title.endswith(".") and not title.endswith("..") and not _is_abbreviation(title):
        title = title[:-1].rstrip()
    return title or DEFAULT_TITLE


def derive_summary(content: str) -> str:
    """The meta description / card blurb derived from a body: the readable
    lines joined into prose, cut on a word boundary at
    :data:`SUMMARY_MAX_CHARS`. A body that is nothing but a badge share is
    described by the share's phrase, as its title is. "" when the body has no
    readable text."""
    text = " ".join(clean_lines(content)) or _badge_phrase(content)
    return truncate_on_word(text, SUMMARY_MAX_CHARS)


# --- the previous derivation, kept ONLY to recognise rows it produced --------


def legacy_derive_title(content: str) -> str:
    """The pre-v1.17.0 title derivation, byte-for-byte (first line, ~60 chars,
    always "…" when cut). Do NOT use it to make titles — it exists so a stored
    title can be recognised as untouched machine output."""
    first_line = content.strip().splitlines()[0] if content.strip() else ""
    if len(first_line) <= 60:
        return first_line or DEFAULT_TITLE
    cut = first_line[:60]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.strip() + ELLIPSIS


def legacy_derive_summary(content: str) -> str:
    """The pre-v1.17.0 summary derivation: the raw first 200 characters."""
    return content[:200]


def is_machine_title(title: str | None, content: str) -> bool:
    """True when ``title`` is what a derivation — old or current — produces
    for ``content``, i.e. no human has edited it since it was derived. The
    fallback :data:`DEFAULT_TITLE` always counts: it describes no body, so a
    better derivation may replace it."""
    if not title or title == DEFAULT_TITLE:
        return True
    return title in (legacy_derive_title(content), derive_title(content))


def is_machine_summary(summary: str | None, content: str) -> bool:
    """Same as :func:`is_machine_title`, for the summary. An empty summary
    counts as machine output: there is nothing human-written to preserve."""
    if not summary:
        return True
    return summary in (legacy_derive_summary(content), derive_summary(content))
