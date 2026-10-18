"""Unit tests for the pure title/summary derivation (app.services.post_metadata).

No I/O. Every expected value is spelled out literally, so a change to the
derivation shows up as a diff of what a search engine would see.
"""

import re

import pytest

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
    ],
)
def test_clean_line(line: str, expected: str):
    assert clean_line(line) == expected


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
