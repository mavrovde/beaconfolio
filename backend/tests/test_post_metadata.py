"""Unit tests for the pure title/summary derivation (app.services.post_metadata).

No I/O. Every expected value is spelled out literally, so a change to the
derivation shows up as a diff of what a search engine would see.
"""

import re

import pytest

from app.services import post_metadata as pm
from app.services.post_metadata import (
    DEFAULT_TITLE,
    LINKEDIN_BOILERPLATE_PATTERNS,
    SUMMARY_MAX_CHARS,
    TITLE_MAX_CHARS,
    clean_line,
    derive_summary,
    derive_title,
    is_machine_summary,
    is_machine_title,
    legacy_derive_summary,
    legacy_derive_title,
    truncate_on_word,
)

# The live symptom this module exists to fix (2026-10-18): the old derivation
# cut the first line at 60 chars and always appended "…".
LIVE_SAMPLE = (
    "The kind of impression you get from Google courses on cloud architecture "
    "is that they are very hands-on.\nSecond paragraph."
)

TITLE_CASES = [
    ("short_line_kept_verbatim", "Hello world\nmore", "Hello world"),
    ("trailing_full_stop_dropped", "Shipping is a feature.", "Shipping is a feature"),
    ("exclamation_kept", "We shipped it!", "We shipped it!"),
    ("question_kept", "Why do builds rot?", "Why do builds rot?"),
    (
        "sentences_accumulate_while_they_fit",
        "Hi. I passed the exam. It took three months of evenings, weekends and coffee.",
        "Hi. I passed the exam",
    ),
    (
        "leading_emoji_and_trailing_hashtags_stripped",
        "🚀 Excited to share my new role! #career #growth\n\nBody here",
        "Excited to share my new role!",
    ),
    (
        "hashtag_only_first_line_skipped",
        "#AI #ML\nWhy small models win",
        "Why small models win",
    ),
    (
        "inline_hashtag_keeps_the_word",
        "Why #Python wins on small teams",
        "Why Python wins on small teams",
    ),
    ("rank_is_not_a_hashtag", "#1 priority is people.", "#1 priority is people"),
    (
        "bullet_and_arrow_decoration_stripped",
        "➡️ • Lessons from a migration",
        "Lessons from a migration",
    ),
    (
        "emoji_between_words_becomes_one_space",
        "I passed 🎉 the exam",
        "I passed the exam",
    ),
    (
        "zero_width_joiner_sequence_removed",
        "Team 👩‍💻 update",
        "Team update",
    ),
    (
        "skin_tone_modifier_removed",
        "Thanks 👍🏽 everyone",
        "Thanks everyone",
    ),
    ("ascii_caret_is_kept", "2^10 is 1024", "2^10 is 1024"),
    (
        "boilerplate_only_line_skipped",
        "View my verified achievement from Example Badges.\nReal first line",
        "Real first line",
    ),
    (
        "clause_head_preferred_without_ellipsis",
        (
            "I'm happy to share that I've obtained a new certification: "
            "Professional Cloud Architect from Example Cloud!"
        ),
        "I'm happy to share that I've obtained a new certification",
    ),
    (
        "word_boundary_cut_marks_truncation",
        LIVE_SAMPLE,
        "The kind of impression you get from Google courses on cloud…",
    ),
    # PR #493 review, finding 1: real openers the strip used to mangle.
    # A keycap is digit + U+FE0F + U+20E3 (Me); it must reduce to its digit,
    # not leave the enclosing-keycap glyph behind ("1⃣ Ship small").
    ("keycap_reduces_to_its_digit", "1️⃣ Ship small.\n2️⃣ Measure.", "1 Ship small"),
    ("keycap_list_opener", "1️⃣ First lesson: ship small", "1 First lesson: ship small"),
    ("hash_keycap_is_decoration", "#️⃣ Hashtag keycap", "Hashtag keycap"),
    ("leading_currency_kept", "$5M raised to fix search", "$5M raised to fix search"),
    (
        "leading_currency_kept_k",
        "$100k salaries are a myth",
        "$100k salaries are a myth",
    ),
    ("leading_euro_kept", "€10 a month is too much", "€10 a month is too much"),
    ("leading_plus_one_kept", "+1 for boring technology", "+1 for boring technology"),
    (
        "leading_minus_number_kept",
        "-5 degrees and the CI still runs",
        "-5 degrees and the CI still runs",
    ),
    ("leading_dotnet_kept", ".NET 10 is out", ".NET 10 is out"),
    ("bullet_then_dotnet", "• .NET 10 ships", ".NET 10 ships"),
    ("leading_ellipsis_dots_stripped", "...Wait for it", "Wait for it"),
    ("dash_bullet_stripped", "- Lessons from a migration", "Lessons from a migration"),
    ("plus_bullet_stripped", "+ Lessons from a migration", "Lessons from a migration"),
    ("degree_sign_kept", "30° in the server room", "30° in the server room"),
    ("degree_celsius_kept", "It was 25°C in Berlin", "It was 25°C in Berlin"),
    # PR #493 review, round 2: the badge boilerplate must match "view" as a
    # WORD — "review"/"preview" used to truncate the sentence ("How we re").
    (
        "review_is_not_badge_boilerplate",
        "How we review verified credentials before granting access.",
        "How we review verified credentials before granting access",
    ),
    (
        "preview_is_not_badge_boilerplate",
        "I preview verified badges before sharing them",
        "I preview verified badges before sharing them",
    ),
    (
        "third_person_badge_share_still_stripped",
        "View the verified credential on Example.\nShipping the platform",
        "Shipping the platform",
    ),
    ("only_symbols_falls_back", "🎉🎉 #yay", DEFAULT_TITLE),
    ("empty_falls_back", "", DEFAULT_TITLE),
    ("whitespace_falls_back", "  \n\t ", DEFAULT_TITLE),
    ("one_enormous_token_cut_mid_word", "x" * 80, "x" * 69 + "…"),
]


@pytest.mark.parametrize(
    "content,expected", [c[1:] for c in TITLE_CASES], ids=[c[0] for c in TITLE_CASES]
)
def test_derive_title(content: str, expected: str):
    title = derive_title(content)
    assert title == expected
    assert len(title) <= TITLE_MAX_CHARS


@pytest.mark.parametrize(
    "content,old,new",
    [
        (
            # A first sentence that ends inside the old 60-char window was
            # still cut, mid-word-sequence, with an ellipsis.
            "Today I learned that observability is a team sport, not a tool.",
            "Today I learned that observability is a team sport, not a…",
            "Today I learned that observability is a team sport, not a tool",
        ),
        (
            "🚀 New role! #career #growth",
            "🚀 New role! #career #growth",
            "New role!",
        ),
        (
            "#hiring\nWe are hiring engineers",
            "#hiring",
            "We are hiring engineers",
        ),
    ],
    ids=["no_false_ellipsis", "emoji_and_hashtags", "hashtag_first_line"],
)
def test_old_vs_new_derivation(content: str, old: str, new: str):
    """The measured regression, pinned both ways: what the OLD derivation
    stored and what the new one derives for the same body."""
    assert legacy_derive_title(content) == old
    assert derive_title(content) == new


def test_title_never_ends_with_ellipsis_when_nothing_was_dropped():
    for content in (
        "A complete short sentence.",
        "x" * TITLE_MAX_CHARS,
        "word " * 10,
    ):
        title = derive_title(content)
        assert not title.endswith("…"), title


def test_a_natural_ellipsis_in_the_text_is_preserved():
    assert derive_title("Wait for it…") == "Wait for it…"


def test_derivation_is_deterministic_and_idempotent_on_its_own_output():
    for _, content, _ in TITLE_CASES:
        assert derive_title(content) == derive_title(content)
        assert derive_summary(content) == derive_summary(content)
    # A derived title fed back as a body derives to itself.
    title = derive_title(LIVE_SAMPLE)
    assert derive_title(title) == title


# --- summary ------------------------------------------------------------------


def test_summary_joins_clean_lines_into_prose():
    body = "🚀 Big news!\n\n#hiring #remote\nWe are growing.\nView my verified achievement from X."
    assert derive_summary(body) == "Big news! We are growing."


def test_summary_cut_on_word_boundary_with_ellipsis():
    body = " ".join(["architecture"] * 30)
    summary = derive_summary(body)
    assert len(summary) <= SUMMARY_MAX_CHARS
    assert summary.endswith("architecture…")
    assert "  " not in summary


def test_summary_short_body_is_whole_and_unmarked():
    assert derive_summary("Short body.") == "Short body."


def test_summary_of_unreadable_body_is_empty():
    assert derive_summary("🎉 #tag") == ""
    assert derive_summary("") == ""


def test_legacy_summary_is_raw_first_200_chars():
    body = "🚀 " + "a" * 300
    assert legacy_derive_summary(body) == body[:200]


# --- truncate_on_word ---------------------------------------------------------


def test_truncate_fits_untouched():
    assert truncate_on_word("abc", 3) == "abc"


def test_truncate_cut_exactly_at_a_space_keeps_the_whole_word():
    # budget = 19; text[19] is a space, so no word is backed off.
    text = "aaaa bbbb cccc dddd eeee"
    assert truncate_on_word(text, 20) == "aaaa bbbb cccc dddd…"


def test_truncate_backs_off_a_partial_word():
    text = "alpha beta gamma delta epsilon zeta"
    assert truncate_on_word(text, 30) == "alpha beta gamma delta…"


def test_truncate_does_not_back_off_to_a_tiny_head():
    # The only space is at index 2 → backing off would leave "ab"; cut mid-word.
    text = "ab " + "c" * 40
    assert truncate_on_word(text, 25) == text[:24] + "…"


def test_truncate_drops_dangling_joiners_before_the_ellipsis():
    text = "Lessons learned, the hard way, from twenty years of releases"
    out = truncate_on_word(text, 32)
    assert out == "Lessons learned, the hard way…"


# --- clean_line -----------------------------------------------------------------


@pytest.mark.parametrize(
    "line,expected",
    [
        ("—", ""),
        ("…", ""),
        ("#only #tags", ""),
        ("  spaced    out  ", "spaced out"),
        ("“Quoted” opening is kept", "“Quoted” opening is kept"),
        ("(Parenthetical) opening is kept", "(Parenthetical) opening is kept"),
        ("Soft­hyphen stays one word", "Softhyphen stays one word"),
        ("Great talk… see more", "Great talk"),
        ("reposted this", ""),
        # Keycap: the enclosing mark (U+20E3, category Me) is removed.
        ("1️⃣ Ship small.", "1 Ship small."),
        ("Step 2⃣ done", "Step 2 done"),
        # ZWNJ/ZWJ between letters is orthography (Persian), kept...
        ("Hello‌world", "Hello‌world"),
        ("می‌خواهم", "می‌خواهم"),
        # ...but at an edge or beside an emoji it is glue, removed.
        ("‌edge joiner", "edge joiner"),
        ("trailing joiner‍", "trailing joiner"),
        ("a‍🎉 b", "a b"),
        ("° alone is not a title", "alone is not a title"),
        ("25℃ outside", "25℃ outside"),
        ("Product™ launch", "Product launch"),
        # "#1" is a rank, "#_x" / "#-x" are not hashtags: trailing run kept.
        ("Ranked #1", "Ranked #1"),
        ("snake #_case", "snake #_case"),
        ("dash #-tag", "dash #-tag"),
        # Touching tags, and a tag glued to the preceding word, are stripped as
        # the original regex stripped them.
        ("Done #a#b", "Done"),
        ("Done#tag", "Done"),
        ("Ends with a dot. #tag", "Ends with a dot."),
        ("#tag", ""),
    ],
)
def test_clean_line(line: str, expected: str):
    assert clean_line(line) == expected


# --- trailing hashtag strip: equivalence + linear cost (finding 2) ---------------

# The regex the hand-written strip replaced. It is the REFERENCE for behaviour
# only — on long inputs it is quadratic, which is why it is no longer used.
_REFERENCE_TRAILING_RUN = re.compile(r"(?:\s*#(?=[^\W\d_])[\w-]+)+\s*$")


def test_trailing_strip_matches_the_replaced_regex_on_short_inputs():
    """Same output as the old regex, over a fixed-seed sample of short strings
    built from the characters that matter (word chars, digits, "_", "-", "#",
    whitespace, a combining mark, a non-decimal digit)."""
    import random

    alphabet = list("ab1_- #\t.é²٣") + ["́"]
    rnd = random.Random(493)
    for _ in range(20000):
        text = "".join(rnd.choice(alphabet) for _ in range(rnd.randint(0, 10)))
        assert pm._strip_trailing_hashtags(text) == _REFERENCE_TRAILING_RUN.sub(
            "", text
        ), repr(text)


def test_trailing_strip_examines_each_character_a_bounded_number_of_times(
    monkeypatch,
):
    """The adversarial shape from the review — a long hashtag run followed by
    one word, ~20k characters — must cost O(n), asserted by COUNTING character
    examinations rather than by wall-clock time (no flaky bound under -n auto).
    The replaced regex retried the run from every "#": quadratic."""
    calls = 0
    real = pm._is_word_char

    def counting(ch: str) -> bool:
        nonlocal calls
        calls += 1
        return real(ch)

    monkeypatch.setattr(pm, "_is_word_char", counting)

    followed_by_text = "#tag " * 4000 + "word"
    assert pm._strip_trailing_hashtags(followed_by_text) == followed_by_text
    # Lower bound too: a version that never calls the helper (e.g. the old
    # regex) would satisfy the upper bound with calls == 0.
    assert len("word") <= calls <= 2 * len(followed_by_text)

    calls = 0
    all_tags = "Body " + "#tag " * 4000
    assert pm._strip_trailing_hashtags(all_tags) == "Body"
    assert 4000 * len("tag") <= calls <= 2 * len(all_tags)


def test_long_adversarial_body_derives_correctly():
    body = "#tag " * 4000 + "word"
    assert len(body) > 20000
    summary = derive_summary(body)
    # The run is LEADING here (stripped), and "word" survives.
    assert summary == "word"
    assert derive_title("Intro " + "#tag " * 4000 + "end").startswith("Intro tag tag")


def test_boilerplate_patterns_are_generic():
    """The pattern list must stay GENERIC (template product): every entry has
    to match a phrase LinkedIn or a badge platform produces for ANY owner, and
    none may carry an owner name or a domain."""
    samples = [
        "View my verified achievement from Credly.",
        "View my verified achievement on Accredible!",
        "View the verified credential at the issuer",
        "Interesting… see more",
        "Reposted this",
    ]
    for pattern in LINKEDIN_BOILERPLATE_PATTERNS:
        assert any(pattern.search(s) for s in samples), pattern.pattern
        # An escaped dot followed by letters is a domain ("example\.com").
        assert not re.search(r"\\\.[a-z]{2,}", pattern.pattern), pattern.pattern


# --- machine-output recognition ----------------------------------------------


def test_is_machine_title_recognises_both_derivations_and_empty():
    assert is_machine_title(legacy_derive_title(LIVE_SAMPLE), LIVE_SAMPLE)
    assert is_machine_title(derive_title(LIVE_SAMPLE), LIVE_SAMPLE)
    assert is_machine_title("", LIVE_SAMPLE)
    assert is_machine_title(None, LIVE_SAMPLE)
    assert not is_machine_title("A title a human wrote", LIVE_SAMPLE)


def test_is_machine_summary_recognises_both_derivations_and_empty():
    assert is_machine_summary(legacy_derive_summary(LIVE_SAMPLE), LIVE_SAMPLE)
    assert is_machine_summary(derive_summary(LIVE_SAMPLE), LIVE_SAMPLE)
    assert is_machine_summary(None, LIVE_SAMPLE)
    assert is_machine_summary("", LIVE_SAMPLE)
    assert not is_machine_summary("Hand-written blurb.", LIVE_SAMPLE)


def test_legacy_title_matches_the_shipped_algorithm():
    """Byte-for-byte the pre-v1.17.0 `_derive_title`: if this drifts, the
    upsert and the re-derive tool stop recognising old rows."""
    assert legacy_derive_title("") == DEFAULT_TITLE
    assert legacy_derive_title("Short") == "Short"
    assert legacy_derive_title("x" * 80) == "x" * 60 + "…"
    assert legacy_derive_title("word " * 30) == ("word " * 12).strip() + "…"
