# Release retrospectives

One file per release, `vX.Y.Z.md`, committed. This directory exists so the retrospectives can be
**compared across releases** — an analysis that lives only in a GitHub comment can be read once but
never trended, and trending is the whole point: the defect classes, the review-round average and
the rework share only mean something as a series.

Written by the `ai-integration` agent at every release (CLAUDE.md rule 8, `/retro`, and the
`release-retro` skill). The issue comment on the roadmap issue is the announcement; **this file is
the record**.

## What each file contains

The five questions from the `release-retro` skill, always in the same order so columns line up
across releases:

1. **Acceptance criteria** — unachievable ones, silently-skipped ones, `Closes` against unmet ACs
2. **Issue quality** — grounding accuracy, whether the implementer had to re-research
3. **Code quality** — review blockers clustered by CLASS, with counts
4. **Review actions** — what reviewers caught that authors missed, and what repeated
5. **Cost** — tokens, wall time, rounds, and the share spent on rework

…then the change list (what was edited in the AI configuration and why), and a **prediction** that
the next retrospective checks.

## The trend table

Update this when you add a retro. These are the numbers worth watching; everything else is context.

**The three KPI columns #386 asks for already exist** and are named here so the criterion is
checkable rather than re-added: *rounds/PR* = **Mean rounds**, *tokens/PR* = **Tokens / merged
PR**, *round-1 approval rate* = **Approved r1**. v1.14.2 adds two columns its own evidence
demanded — **Merged w/o valid APPROVE** (tracked only in prose footnotes until now, and v1.14.2
introduced a second failure mode: merging against a *standing* REQUEST CHANGES) and **Class G**
(fake-greens, the class #393 guards). Both are back-filled only where a release's own record
measured them; **`n-a` means not measured, never estimated.**

| Release | PRs merged | Verdicts (loose / canonical-heading) | Mean rounds | Approved r1 | Rework share of verdicts | "Claim not measured" (F) findings | Class G findings | Merged w/o valid APPROVE | Median files/PR | Tokens | Tokens / merged PR | Agent-time |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [v1.12.0](v1.12.0.md) | 10 | 24 / n-a¹ | **2.4** | 20% (2/10) | 58%⁴ | **9**⁵ | n-a | n-a | 17 | 9.07M² | 907k² | 28.1h² |
| [v1.13.0](v1.13.0.md) | 16 | 52 / **50** | **3.13** | **0% (0/16)** | 68%⁴ | **12**⁵ | n-a | 0 | 14 | not recorded³ | n-a³ | 23.5h tag→tag |
| [v1.14.0](v1.14.0.md) | 11 | 23 / **20** | **1.82** | 27% (3/11)⁶ | 45%⁷ | **4**⁵ | n-a | 1 (#321) | 20 | **8.38M**³ | 762k³ | **35.5h**³ · 53.0h tag→tag |
| [v1.14.1](v1.14.1.md) | 17¹¹ | 44 / **41**¹⁰ | **2.41**¹⁰ | **29% (5/17)** | 59%⁸ | **5**⁵ | **2** | 1 (#355) | 8 | **2.60M**⁹ | **153k**⁹ | **6.0h**⁹ · 107h tag→tag |
| [v1.14.2](v1.14.2.md) | 14¹² | 40 / **38**¹³ | **2.71**¹³ | **0% (0/14)**¹³ | 63%¹³ | **22**⁵ ¹⁴ | **8** | **6 of 14 (43%)**¹⁵ | 7 | not recorded¹⁶ | n-a¹⁶ | n-a¹⁶ · **20.1h tag→tag** |
| [v1.14.3](v1.14.3.md) | 17 | 36 / **34**¹⁷ | **2.00**¹⁷ | **18% (3/17)**¹⁷ | 50%¹⁷ | **8**⁵ (2 on the retro PR) | **9**¹⁸ | **1 (#412)**¹⁹ | 8 | partial²⁰ | n-a²⁰ | n-a²⁰ · **15.8h tag→tag** |

¹ v1.12.0's verdict headings predate the mandated form, so a canonical-heading re-count undercounts
that window (15). From v1.13.0 the heading is charter-mandated **and** gate-enforced, so this column
is exact and becomes the primary one at v1.14.0. v1.13.0's 50 includes #293's two `⛔ REJECTED`
verdicts, which BOTH published matchers missed — see "How to count consistently".
² Console session estimates, not Project 3 fields — labelled as estimates.
³ **Decided at v1.14.0: the token/time columns STAY.** They were empty repo-wide at v1.13.0 and are
now filled for 31 of 55 Project 3 items, including 8 of 8 in the `v1.14 reach` bucket — so v1.14.0's
8.38M / 35.5h are recorded FIELDS, not console estimates (v1.12.0's still are). Two caveats that
change the reading: the total includes **#310, still `In Progress`**, whose 2 900k/640min covers host
work that has not shipped; and `Review rounds` is still unset for all 8 items, so **do not publish
from that field** — the thread is the instrument (executable, re-derivable by anyone) and the field
disagreed with the thread the one time it was filled (5 recorded vs 3 posted on #240).
⁴ Rework share is measured in **verdicts**, not tokens — a redefinition, and v1.12.0's cell was
re-derived under it (its originally published 75% was token-based). See "How to count consistently".
⁵ The two earliest cells count **different severity populations** (v1.12.0 blocker-only, v1.13.0
blocker + major); v1.14.0's **4** is blocker + major, so it is comparable with v1.13.0's 12 and not
with v1.12.0's 9. See "How to count consistently".
⁶ v1.14.0's three round-1 approvals (#315, #320, #327) are **ALL also stale merges** — the rate
partly recovered by approving early and merging the fixes unreviewed. Read this column beside the
stale-approval count, never alone.
⁷ Denominator: the full 11-PR corpus, for series comparability. #321 merged with **zero** verdicts, so
the "every PR spends one verdict on round 1" identity does not hold; over the 10 reviewed PRs the
figure is 50%. See "How to count consistently".

**v1.12.0's prediction: FAILED.** It asked for mean rounds < 2.0 and ≥40% round-1 approvals;
measured **3.13** and **0%** — no PR in the release was approved on its first round. Its own falsification test (PR size) was also refuted — median size FELL 17→14
while rounds rose. See [v1.13.0.md §5](v1.13.0.md) for the diagnosis (the release's material changed:
credential-, billing- and container-configuration-shaped features produced 9 blockers in classes that
barely existed at v1.12.0), and note the counter-evidence to a "churn" reading: **zero review rounds
found nothing**.

**v1.13.0's prediction: 3 of 4 clauses PASS, 1 FAILS.** Class-A findings **zero** ✅ (every
`check_compose_env` mention in the window is a passing gate report, 45→50 knobs); round-1 approvals
**27%** ✅ (target ≥20%); mean rounds **1.82** ✅ (target ≤2.8) while median PR size
ROSE 14→20, so the fall is not "smaller PRs". **Merges on a stale approval: 4 of 10 reviewed merges**
❌ — #320 merged four commits after its only verdict (including the fixes to the reviewer's own
findings and a behaviour change), #315 merged two seconds before its delta-confirm was posted, #314
merged a `main` merge, and the RELEASE PR #327 merged a CHANGELOG commit its verdict never saw, so
the `v1.14.0` tag sits on an uncovered commit; #321 was merged with **no verdict at all**. Read
clauses 2 and 3 together: **all three** round-1 approvals are also stale merges, so the rate partly
"recovered" by approving early and merging the fixes unreviewed. Its falsification clause did **not** trigger (class A went to zero and
rounds FELL). See [v1.14.0.md §6](v1.14.0.md).

⁸ Full 17-PR corpus: `(41 − 17)/41`. Over the **16** PRs actually reviewed (#355 merged with zero
verdicts) it is `(41 − 16)/41` = **61%**. State which denominator you used.
⁹ Exactly **2,600,168 tokens over 361.8 agent-minutes across 26 runs**, **SUBAGENT ONLY** —
main-loop tokens excluded, so the true cycle cost is higher. The per-run table is committed as the
appendix to [`v1.14.1.md`](v1.14.1.md#appendix--per-run-effort-telemetry), so the figure is
re-derivable; a figure held only in a machine-local file is not a measurement anyone else can
check. **Not comparable with v1.14.0's 8.38M**, which came from Project 3 fields and included an
unshipped in-progress item. The first two adjacent releases whose token figures can be honestly
compared will be v1.14.1 ↔ v1.14.2. Captured live during the cycle — the release-manager correctly
refused to reconstruct it afterwards, because it is not recoverable.

¹⁰ **A measured hole in the canonical filter.** The filter admits any posted body whose first
non-empty line carries `APPROVE` or `REQUEST CHANGES` — which on #373 admits the *author's*
`## Round-2 APPROVE noted — and the head moved, so this needs a round 3`, a comment flagging that
an approval no longer covered the head. The convention's own wording is "posted **review** bodies";
under it the release is **40 / 2.35 / 58%** and #373 took 7 verdicts, not 8. The cells keep 41/2.41
because that is what the documented filter returns as run. This is the same class of hole already
footnoted for the loose matcher, one level in: **position is not authorship.** Next retro fixes the
filter — and note the author-body case is the mirror of the v1.13.0 finding that a fix report must
not *open* with a marker.

**How "PRs merged with no verdict" is measured (#392):** `scripts/audit_no_verdict_merges.sh`
applies the canonical first-non-empty-line filter over each merged PR's reviews AND comments —
run it rather than re-deriving the jq. The scheduled `Verdict Audit` workflow runs it
red-when-dirty for merges after 2026-09-14 (the control's landing date; #321/#355 predate it and
stay documented here, not alarmed on). The CLI bypass (`PR_MERGE_GATE=0`) now leaves a log line
and a PR comment, so a bypass count is measurable; a web-UI merge remains detectable only
after the fact — that limit is structural (no PreToolUse hook exists there) and stated rather
than papered over.

¹¹ **Normalise timestamps to UTC before comparing.** The corpus query does a **string** compare on
`mergedAt`, and `git log --format=%cI` emits tag stamps in local time (`+02:00` here). Mixing a
`+02:00` bound with a `Z` value silently mis-selects the corpus. Also expect the window query to
return **one more PR than the corpus**: the release PR whose merge commit *is* the previous tag
belongs to the previous release (#327 ↔ `v1.14.0`'s `a3de0f5`).

¹² **The release PR is excluded by ONE SECOND** if you bound on the tag commit's committer date.
`e1825949` is `19:46:02Z`; #406's `mergedAt` is `19:46:03Z`. **Bound the corpus on the release
PR's `mergedAt`**, not on `git log -1 --format=%cI <tag>`. This is the mirror of note 11 (where
the query returned one PR too many) and bites in the opposite direction.

¹³ **Replayed at `mergedAt`, which is what makes these numbers true.** Six of v1.14.2's 38
canonical verdicts were posted **after** their PR merged (retrospective back-fills, §1 of that
record). Counting them naively reports **five round-1 approvals (36%)**; replayed at `mergedAt`
the figure is **0 of 14**, because every PR that was reviewed before merge opened with a REQUEST
CHANGES. The loose/canonical cells keep 40/38 because that is what the documented filter returns
as run, and **Mean rounds (2.71) and Rework share (63%) stay NAIVE for comparability with the
four prior rows, which are all naive; only Approved r1 is the replayed figure.** Replayed, the
other two read **2.29**/PR (32 pre-merge verdicts; **3.56** over the 9 PRs actually reviewed)
and **56%** — quote those when the claim is about the gate, the cells when it is about the trend. This also closes the
author-body hole note 10 left open: a verdict must both **open** with the marker (position is not
authorship) **and predate the merge** (a back-fill is not a gate).

¹⁴ **82% of v1.14.2's class F is one PR.** 18 of the 22 are on **#389 — the v1.14.1
retrospective PR itself**, whose round-1 verdict lists thirteen blockers, each a published number
contradicted by measurement. The cause is structural: that retro published the same figures into
four files. See [v1.14.2.md §3](v1.14.2.md) and the single-source rule now in the `release-retro`
skill.

¹⁵ **Not bypasses — merges that never reached the gate.** `pre-merge-gate.sh`'s bypass trace
(#392) writes `$HOME/.claude/merge-gate-bypass.log` and posts a PR comment on every
`PR_MERGE_GATE=0` merge; **neither exists for any of the six**. Five merged with zero verdicts
(#394 #395 #396 #397 #403) and #402 merged against a **standing REQUEST CHANGES** — a failure
mode no prior release had. All six were back-filled with `APPROVE — retrospective review` in a
single 19-second batch an hour later, which is why `audit_no_verdict_merges.sh` **reports this
window clean**: it tests presence, not ordering (→ #409). An empty bypass log is now positive
evidence and should be quoted whenever this cell is non-zero.

¹⁶ **Not recorded, and that is a miss rather than a convention.** No per-run capture was kept;
Project 3 holds `Tokens (k)` / `Time of processing (min)` for **8 of 16** items (1,884k / 373 min)
— a gap, not a sample, since the four Dependabot PRs, the release PR and the two largest gate PRs
carry nothing and one filled row is still in progress. Summing it would repeat the defect note 3
exists to stop. v1.14.1 ↔ v1.14.2 were to be the first honestly comparable token figures; they
are not, and **#386 stays open on this criterion alone**.

¹⁷ **The first window where naive == replayed: zero verdicts were posted after their PR
merged**, so every cell is both at once. All 34 canonical verdicts are pre-merge; the 16
reviewed PRs' APPROVEs are all delta-confirms at the merged head (stale approvals **0 of 16**).
Mean rounds over the 16 actually reviewed: **2.13**; rework share over them: 53%.
¹⁸ **All 9 class-G findings were raised BEFORE #393's mutation contracts merged in #427, the
window's last feature PR** — this cell is the pre-control baseline, and most instances sit
outside #393's mechanical scope (workflow steps, an eslint rule, a proxy test, a Playwright
config). The v1.14.3 prediction splits the clause accordingly.
¹⁹ **#412, the P0 revert of the premature release cut, merged 23 minutes after opening with
zero verdicts.** The bypass log does not exist (never reached a hooked `gh pr merge`), and the
weekly `Verdict Audit` had already fired for the week — mechanical detection would have waited
until Sep 21 (#409's cadence half, second measured instance). The retrospective review is
posted on #412; see [v1.14.3.md §4](v1.14.3.md).
²⁰ **Partial, stated as such: 3,405k tokens / 1,727 min over 8 of the 11 board items**; the
other three were not captured at close-the-loop and are not reconstructable
(`Review rounds`/`Agent`/`Model` are 11 of 11 after the retro's thread-derived back-fill).
Summing a gap is the note-3 defect; **#386 stays open a third release on this criterion.**

**v1.14.2's prediction: 2 of 6 clauses PASS, 4 FAIL** — but the two headline failures moved
hard in the right direction: no-valid-APPROVE merges **6 → 1** (and the 1 is the predicted
"never reached the gate" mode, quoted via the absent bypass log), class F **22 → 8** with the
retro-PR share 18 → 2. Class G's ❌ (9, target ≤3) is scored beside its own rule: **#393
shipped** (#427) but as the window's last feature PR, so every instance predates the control.
Passes: class N = 1 ✅, mean rounds 2.00 / zero ≥4-verdict PRs ✅ with median files/PR RISING
7 → 8 (the falsifier did not fire). Telemetry ❌ for the third time — the v1.14.3 prediction
makes that clause binary. See [v1.14.3.md §7](v1.14.3.md).

**v1.14.1's prediction: 2 of 6 clauses PASS, 3 FAIL, 1 ⚠️ unmeasured.** Class C findings **0** ✅
(from 7 — #391 shipped in #398, and class B also went to zero); docs-only push **13s** ✅ (target
≤2 min). Failed: **PRs merged with no verdict 5** ❌ (from 1, plus one merged against a standing
REQUEST CHANGES); **mean rounds 2.71 / 4 PRs at ≥4 verdicts** ❌ (targets ≤1.6 / ≤1); **class F
22** ❌ (target ≤2). ⚠️ **Merges on a stale approval 0 of 9 reviewed** — v1.14.1's own falsifier
("clauses 2 and 3 can hit zero because merges stopped passing through the gate") **fired**: 6 of
14 merges never reached it, so this is a statement about the 9 that did. Its scoring rule worked
exactly as designed — of the three issues it filed, **#391 ✅ and #392 ✅ shipped and their class
went to zero; #393 ✗ did not ship, and class G quadrupled 2 → 8.** See
[v1.14.2.md §6](v1.14.2.md).

**v1.14.0's standing prediction — early read at v1.14.1 (formal check still due at v1.15).** Stale
approvals **0 of 16** ✅ (from 4 of 10 — `pre-merge-gate.sh` working); class-F blocker+major **5** ❌
(target ≤2 — the draft scored this **2 ✅** and review re-derived it at 5); PRs merged with **no
verdict at all: 1** ❌ (#355, second release running after #321); **merged-result findings: 8** ❌ —
classes B ∪ C, stale base and `[Unreleased]` collision, hit **8 of 16 reviewed PRs — half of
everything reviewed**, and **4 of the 7 class-C PRs are also class B**, because the collision *is* the stale base landing in
`CHANGELOG.md`. #365 is the worst variant: the merge **deleted the released `## [1.14.0]` heading**
rather than duplicating one. Project 3 `Review rounds` ⚠️ filled for 6 of 14 rail issues,
retroactively.
**Read the ✅ on stale approvals with its limit:** the prescribed falsifier is merge provenance, and
it is **unmeasurable here** — all 17 merges report `mergedBy: mavrovde`, since owner and agents share
one identity and the API exposes no CLI-vs-web-UI distinction. The defensible claim is "no merge that
*reached* the gate carried an uncovered commit"; #355 proves at least one did not reach it.

**Standing prediction (set by v1.14.0, checked at v1.15):** zero merges whose newest canonical
APPROVE predates a commit on the PR; zero PRs merged with no posted verdict at all; zero
merged-result findings (Alembic head fork / "green alone, broken by the merge"); class-F blocker+major
findings **≤2**; Project 3 `Review rounds` filled for every issue the release ships, or the column
formally retired.

**Falsification stated up front:** clauses 1 and 3 can go to zero for the wrong reason — if fewer
merges pass through a guarded session, the gate is being ROUTED AROUND, not obeyed. So measure merge
PROVENANCE first (`gh pr view <n> --json mergedBy`, plus whether the thread shows a delta-confirm) and
report web-UI merges as *unmeasured*, never as a pass. Second falsifier: if mean rounds rise back above
3.0 while classes F, G and S stay low, the constraint has moved back to material difficulty and the
answer is not another charter paragraph.

## How to count consistently

So the series stays comparable, count the same way every time:

- **The corpus is every PR merged in `(previous release PR's `mergedAt`, this release PR's
  `mergedAt`]`.** Do **not** bound on the tag commit's committer date: at v1.14.2 the tag commit
  read `19:46:02Z` and its own release PR merged at `19:46:03Z`, so `<= CUR` dropped #406 from
  its own release (note 12). Get the bound with
  `gh pr view <release-PR> --json mergedAt --jq .mergedAt`.
- **Replay every verdict at `mergedAt` before counting it.** A verdict posted *after* the merge is
  a retrospective record, not a gate, and counting it silently inflates the two columns that
  matter: at v1.14.2 six post-merge back-fills turned a true **0 of 14** round-1 approvals into a
  reported 36% (note 13). So a countable verdict must satisfy **both** halves — the marker in the
  **first non-empty line** (position is not authorship) **and** `submittedAt`/`createdAt <=
  mergedAt`. Report the naive number alongside it when they differ, and say which is which.
- **Verdicts** = posted review bodies containing the UPPERCASE marker `APPROVE` or
  `REQUEST CHANGES`, counted over the release's **merged** PRs. Count these, **not** the Project 3
  `Review rounds` field — v1.12.0 found that field disagreeing with the thread (5 recorded vs 3
  posted on #240). **Run this, do not count by hand** — four hand counts (30, 32, 34, 29)
  were reported for v1.12.0 and none reproduced:

  ```bash
  # The corpus is every PR MERGED BETWEEN THE TAGS — not `git log <prev>..<tag>`,
  # which cites issue numbers as well as PRs and sweeps in PRs that merged before
  # the previous tag. Both published counts for v1.12.0 (29/14 and 32/12) came
  # from getting the CORPUS wrong, not the matcher.
  PREV=$(git log -1 --format=%aI <prev-tag>); CUR=$(git log -1 --format=%aI <tag>)
  gh pr list --state merged --limit 100 --json number,mergedAt,reviews,comments \
    --jq "[.[] | select(.mergedAt > \"$PREV\" and .mergedAt <= \"$CUR\")]
          | map([(.reviews[]?.body),(.comments[]?.body)]
                | map(select(test(\"APPROVE|REQUEST CHANGES\"))) | length)
          | add"
  ```

  Case matters: a lowercase "approve" in prose is not a verdict, and matching case-insensitively
  inflated the v1.12.0 count by one. And run the widened sweep even when you expect nothing:
  v1.14.0's found **no** missed verdict — the first window for which that is true, because the two
  canonical headings have been charter-mandated since v1.13.0 — but it did surface a `COMMENTED`
  review with a **zero-length body** on #322, which appears as a blank first line and is not a
  verdict. Say so rather than leaving the reader to wonder what the blank was.

  **The loose matcher over-counts, measurably, and v1.13.0 quantified it.** A body containing a
  marker is not necessarily a verdict: on #291 it returns 11 where the thread holds **8** reviewer
  verdicts, because three of the marker-bearing comments are the AUTHOR's fix reports (`## Round 4 —
  the three blockers, each measured against the unfixed hook`, whose first marker is `APPROVED`);
  #282 returns 5 for 4. Reviewer and author post under the SAME identity here, so no author filter
  can separate them — only the marker's POSITION can. Since v1.13.0 `pr-reviewer` MUST state the
  verdict in the body's first non-empty line and `pre-merge-gate.sh` reads exactly that line, so
  count with the heading-anchored filter and report the loose number alongside it while the series
  still contains pre-mandate releases:

  ```bash
  gh pr list --state merged --limit 100 --json number,mergedAt,reviews,comments \
    --jq "[.[] | select(.mergedAt > \"$PREV\" and .mergedAt <= \"$CUR\")]
          | map([(.reviews[]?.body),(.comments[]?.body)]
                | map(select(split(\"\n\") | map(select(test(\"\\\\S\"))) | (.[0]//\"\")
                             | test(\"REQUEST CHANGES|APPROVED?\"))) | length)
          | add"
  ```

  **…and it also UNDER-counts, which is the half that actually changed a headline number.** Always
  run the widened sweep once — print every first line that matched NEITHER marker and read them:

  ```bash
  # every heading the matcher rejected — read these, don't trust the count
  gh pr view <n> --json reviews,comments --jq '
    [((.reviews//[])[]|{t:.submittedAt,b:.body}),((.comments//[])[]|{t:.createdAt,b:.body})]
    | sort_by(.t) | map(.b|split("\n")|map(select(test("\\S")))|(.[0]//"")|.[0:60]) | .[]' \
    | grep -viE "APPROVE|REQUEST CHANGES"
  ```

  On v1.13.0 that sweep found one class of miss and it mattered: **#293's two `## ⛔ REJECTED`
  verdicts** — the heading `pr-reviewer.md` prescribed until v1.13.0, containing neither marker. It
  hid two real REQUEST-CHANGES rounds and made #293 look like the release's only round-1 approval,
  when the true figure is **0 of 16**. For any window before v1.13.0, add `|REJECTED` to the
  matcher. From v1.13.0 the charter prescribes only the two canonical headings.

  Do NOT retro-fit the heading-anchored number onto pre-v1.13.0 releases: it returns 15 for v1.12.0's
  24, an undercount caused by format drift, not a correction.
- **Rework share of verdicts** = verdicts posted in rounds 2+ ÷ total verdicts, i.e.
  `(verdicts − PRs) ÷ verdicts` (every PR spends exactly one verdict on round 1). v1.13.0:
  `(50 − 16) / 50` = **68%**.
  **This is a REDEFINITION, not a correction, and the v1.12.0 cell was re-derived under it.** The
  column used to be *tokens* spent in rounds 2+ ÷ total measured review tokens, and v1.12.0
  published **75%** on that basis. Token telemetry turned out to be unrecorded repo-wide (see the
  trend table's note 3), so a token-based column could only ever be re-derived from console
  estimates. v1.12.0's cell now reads **58%** = `(24 − 10) / 24`, the verdict-based figure for the
  same window — the 75% is not wrong, it measured a different thing that nothing records. If token
  telemetry is ever actually captured, add it as a SEPARATE column rather than redefining this one
  again.
- **"Claim not measured" findings** = the count of class-F review findings, and **the two published
  cells count different populations**: v1.12.0's **9** is blocker-level only; v1.13.0's **12** is
  blocker *and* major (its §3 table is explicitly "Blocker- and major-level findings"). Read the
  column as two data points, not a trend, until one of them is re-split — each release's own record
  carries the severity-resolved detail. State the severity population whenever you fill this cell;
  this is the same comparability trap the verdicts column already carries a footnote for.
- **Merges on a stale approval** = merged PRs carrying at least one commit whose `committedDate` is
  newer than the selected canonical APPROVE. Replay the thread **as it stood at `mergedAt`** — today's
  thread can contain a delta-confirm posted after the merge (#315's was, by two seconds), which makes
  a stale merge look clean:

  ```bash
  M=$(gh pr view <n> --json mergedAt --jq .mergedAt)
  gh pr view <n> --json reviews,comments,commits --jq "
    {commits:.commits,
     reviews:[.reviews[]|select(.submittedAt<=\"$M\")],
     comments:[.comments[]|select(.createdAt<=\"$M\")]}"
  ```

  `pre-merge-gate.sh` enforces this since v1.14.0, so from v1.15 a non-zero count also means the gate
  was bypassed or the merge never reached it (a web-UI merge is invisible to a PreToolUse hook —
  report those as *unmeasured*, not as a pass).
- **The rework-share identity assumes every PR spends one verdict on round 1**, which #321 broke by
  merging with zero. v1.14.0's cell uses the full **11-PR** corpus and its **20** canonical verdicts,
  for series comparability — `(20 − 11)/20 = 45%`; over the **10** PRs that were actually reviewed it
  is `(20 − 10)/20 = 50%`. State which denominator you used, **and re-derive it after the release PR
  merges**: this bullet first shipped reading `(19 − 10)/19 = 47%`, the pre-#327 state, contradicting
  the trend row three lines above it (#329 review round 1). The corpus moves under a retro that runs
  as the release ships.
- **Release attribution** = the tag the work actually **shipped in**, not the one it was planned
  for. v1.12.0 found #235 filed under v1.11.1 although its PR merged after that tag, understating
  the release by ~11%.
- **A multi-phase item's bucket is where its REMAINING work lands**, not where its first phase
  shipped. Otherwise a phase-1 delivery keeps its release open forever: v1.12.0 read "in progress"
  for hours after it was tagged because #247 (phase 1 shipped, phases 2–3 pending) and #61 (blocked
  on an owner-gated deploy) still sat in its bucket, and the roadmap tracker — which spans every
  release — was bucketed at all. **Move the item when a phase ships; a tracking issue gets no
  release bucket.**
