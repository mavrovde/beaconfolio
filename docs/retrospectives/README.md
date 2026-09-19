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
PR**, *round-1 approval rate* = **Approved r1**. **v1.15.1 adds `Non-independent verdicts`** — the share
of a window's canonical verdicts written by the session that authored the PR, disclosed under
CLAUDE.md rule 13. It is a COLUMN and not a footnote because v1.15.1 and v1.15.2 each posted
`100% round-1 approvals` on `100% solo verdicts`, and those two cells must be visible together or
the first will be quoted alone. It is measurable **only** from the disclosure paragraph — reviewer
and author share one GitHub identity here, so nothing mechanical can derive it. v1.14.2 adds two
columns its own evidence demanded — **Merged w/o valid APPROVE** (tracked only in prose footnotes until now, and v1.14.2
introduced a second failure mode: merging against a *standing* REQUEST CHANGES) and **Class G**
(fake-greens, the class #393 guards). Both are back-filled only where a release's own record
measured them; **`n-a` means not measured, never estimated.**

| Release | PRs merged | Verdicts (loose / canonical-heading) | Mean rounds | Approved r1 | Rework share of verdicts | "Claim not measured" (F) findings | Class G findings | Merged w/o valid APPROVE | Non-independent verdicts | Median files/PR | Tokens ⚰️ | Tokens / merged PR ⚰️ | Agent-time ⚰️ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [v1.12.0](v1.12.0.md) | 10 | 24 / n-a¹ | **2.4** | 20% (2/10) | 58%⁴ | **9**⁵ | n-a | n-a | n-a²⁷ | 17 | 9.07M² | 907k² | 28.1h² |
| [v1.13.0](v1.13.0.md) | 16 | 52 / **50** | **3.13** | **0% (0/16)** | 68%⁴ | **12**⁵ | n-a | 0 | n-a²⁷ | 14 | not recorded³ | n-a³ | 23.5h tag→tag |
| [v1.14.0](v1.14.0.md) | 11 | 23 / **20** | **1.82** | 27% (3/11)⁶ | 45%⁷ | **4**⁵ | n-a | 1 (#321) | n-a²⁷ | 20 | **8.38M**³ | 762k³ | **35.5h**³ · 53.0h tag→tag |
| [v1.14.1](v1.14.1.md) | 17¹¹ | 44 / **41**¹⁰ | **2.41**¹⁰ | **29% (5/17)** | 59%⁸ | **5**⁵ | **2** | 1 (#355) | n-a²⁷ | 8 | **2.60M**⁹ | **153k**⁹ | **6.0h**⁹ · 107h tag→tag |
| [v1.14.2](v1.14.2.md) | 14¹² | 40 / **38**¹³ | **2.71**¹³ | **0% (0/14)**¹³ | 63%¹³ | **22**⁵ ¹⁴ | **8** | **6 of 14 (43%)**¹⁵ | n-a²⁷ | 7 | not recorded¹⁶ | n-a¹⁶ | n-a¹⁶ · **20.1h tag→tag** |
| [v1.14.3](v1.14.3.md) | 17 | 36 / **34**¹⁷ | **2.00**¹⁷ | **18% (3/17)**¹⁷ | 50%¹⁷ | **8**⁵ (2 on the retro PR) | **9**¹⁸ | **1 (#412)**¹⁹ | n-a²⁷ | 8 | partial²⁰ | n-a²⁰ | n-a²⁰ · **15.8h tag→tag** |
| [v1.15.0](v1.15.0.md) | **6**²² | 11 / **11**²³ | **1.83** | **50% (3/6)**²⁴ | 45%²³ | **7**⁵ (5 on doc surfaces) | **0**²⁵ | **0**³⁰ | **3 of 11 (27%)**²⁷ | 7 | retired²¹ | retired²¹ | retired²¹ · 71.6h tag→tag²⁶ |
| [v1.15.1](v1.15.1.md) | **6**²⁸ | 6 / **6** | **1.00**²⁹ | **100% (6/6)**²⁹ | **0%**²⁹ | **0**²⁹ | **0** in review²⁹ | **0** | **6 of 6 (100%)**²⁷ | **9** | retired²¹ | retired²¹ | retired²¹ · 4.03h tag→tag²⁸ |
| [v1.15.2](v1.15.2.md) | **3**²⁸ | 3 / **3** | **1.00**²⁹ | **100% (3/3)**²⁹ | **0%**²⁹ | **0**²⁹ | **0**²⁹ | **0** | **3 of 3 (100%)**²⁷ | 6 | retired²¹ | retired²¹ | retired²¹ · 1.60h tag→tag²⁸ |
| [v1.16.0](v1.16.0.md) | **10** | 27 / **26**³¹ | **2.60** | **30% (3/10)**³² | **62%** | **9**⁵ (4 on doc surfaces) | **8** | **0** | **2 of 26 (8%)**³³ | **14** | retired²¹ | retired²¹ | retired²¹ · **8.57h tag→tag** |

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
disagreed with the thread the one time it was filled (5 recorded vs 3 posted on #240). **Second
instance, v1.15.1:** #386 carries `Review rounds: 4` against a thread of one ([v1.15.1
§4](v1.15.1.md)). Two occasions filled, two disagreements — this note is where that count lives, so
other surfaces link here rather than restating it.
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
**The canonical cells use the OPENS-WITH filter** (marker anchored at the START of the first
non-empty line — the fn-10 fix, now in "How to count consistently"): the older in-line test
returns **35 / 2.06 / 51.4%** on this window by admitting one author comment on #421 that
itself ends *"(Not a verdict…)"*. v1.14.1's cells (41/2.41/59%) were published under the
in-line test, fn 10 stating their anchored equivalents (40/2.35/58%) — compare like with like.
¹⁸ **All 9 class-G findings were raised BEFORE #393's mutation contracts merged in #427, the
window's last feature PR** — this cell is the pre-control baseline, and most instances sit
outside #393's mechanical scope (workflow steps, an eslint rule, a proxy test, a Playwright
config). The v1.14.3 prediction splits the clause accordingly.
¹⁹ **#412, the P0 revert of the premature release cut, merged 9 minutes after opening with
zero verdicts.** The bypass log does not exist (never reached a hooked `gh pr merge`), and the
weekly `Verdict Audit` had already fired for the week — mechanical detection would have waited
until Sep 21 (#409's cadence half, second measured instance). The retrospective review is
posted on #412; see [v1.14.3.md §4](v1.14.3.md).
²⁰ **Partial, stated as such: 3,405k tokens / 1,727 min over 8 of the 11 board items**; the
other three were not captured at close-the-loop and are not reconstructable
(`Review rounds`/`Agent`/`Model` are 11 of 11 after the retro's thread-derived back-fill).
Summing a gap is the note-3 defect; **#386 stays open a third release on this criterion.**

²¹ **RETIRED at v1.15.0 — `Tokens`, `Tokens / merged PR` and `Agent-time` are no longer series
columns.** The clause v1.14.3 declared **binary** ("filled for every shipped board item at
close-the-loop, or the columns formally retired") failed a **fourth** consecutive time: Project 3
holds **none** of `Tokens (k)` / `Time of processing (min)` / `Review rounds` / `Agent` / `Model`
for **#431, the one issue v1.15.0 fully shipped**, nor for #424. The four cells above it read
*estimates* (v1.12.0), *not recorded* (v1.13.0, v1.14.2), *fields including an unshipped item*
(v1.14.0), *subagent-only* (v1.14.1) and *partial, 8 of 11* (v1.14.3) — six releases, six
different meanings, which is not a series. **Historical cells stay: they are the record.** New
rows read `retired`. What replaces them is what GitHub actually holds and anyone can re-derive —
PR count, verdict count, rounds, median files/PR, open→merge wall clock — all printed by
`scripts/retro_metrics.sh`. A cycle that DOES capture per-run effort end-to-end publishes it as
that release's own appendix (the way [v1.14.1](v1.14.1.md#appendix--per-run-effort-telemetry)
did), never as a column. **#386 is resolved by this retirement**, not by another attempt.

²² **6 PRs — the smallest corpus in the series, and every RATE in this row must be read with that
denominator.** 3 of the 6 are ≤8-file docs/config PRs and only one (#433) is a feature PR with a
reviewer-driven round trip. Prefer per-PR normalisation when comparing this row to the 14-17 PR
windows: class F is *flat* in absolute terms (8 → 7) and therefore **worse per PR** than v1.14.3.

²³ **First window where the LOOSE and ANCHORED filters return the same number: 11 and 11**, and
all 11 are pre-merge (zero back-fills, second window running). No author fix-report in the window
even *contains* an uppercase marker — #429's and #433's both open "fix report (not a verdict)" and
avoid the words entirely, which is the v1.13.0 rule working at the author side rather than being
caught at the filter. Rework share `(11 − 6)/11` = 45%, full corpus; every PR was reviewed, so
there is no second denominator this time.

²⁴ **The series-best round-1 rate is confounded by self-review, and must never be quoted alone.**
The owner directed the window to run solo (no subagents), so 3 of 6 PRs merged on a verdict
written by the **main session**. Split: agent-reviewed PRs (#429 #430 #433 #435) **1 of 4**;
main-session-reviewed (#434 #436) **2 of 2** — and #434 was the release's **largest** PR (24 files,
+1983 lines, new endpoint + migration), approved in one round by the session that had just rebased
it. All the solo verdicts disclosed this voluntarily; from v1.15.0 CLAUDE.md rule 13 **requires**
the disclosure, because reviewer and author share one identity and nothing downstream can detect
it. See [v1.15.0.md §4](v1.15.0.md).

²⁵ **Class G = 0, on a window that tested #393's gate not at all.** One instance was raised at
*nit* (#433 r1: deleting a patch together with its paired assertion left the suite green) and
fixed. The v1.14.3 prediction's mechanical half scores **n/a** by its own falsifier — the window
added no new `scripts/*.test.sh` and touched no hook contract, so there was nothing for #393's
contracts to cover. Carried forward unchanged to the v1.15.0 prediction.

²⁶ **71.6h tag→tag is an idle gap, not cost.** #433 and #434 were opened 2026-09-15 and merged
2026-09-18 across a ~66h owner-directed priority hold on another project. Active work is two
bursts totalling ~3h; #436 went open→merge in **14 minutes**. Per-PR lead times are in
[v1.15.0.md §5](v1.15.0.md) — quote those, never this span.

**v1.14.3's prediction: 4 of 6 clauses PASS, 1 FAILS, 1 n/a.** Merged with no valid APPROVE
**0 of 6** ✅ (from 1; the falsifier was checked, not assumed — all 6 carry pre-merge verdicts and
the bypass log is empty). Class N **1** with **#424 shipped** ✅. Mean rounds **1.83** / zero PRs
at ≥4 verdicts ✅, median files/PR 8 → 7 and so above the ~5 ambiguity floor. Class G **0** ✅ on
count, its mechanical half **n/a** (note 25). ❌ **Class F 7** against a target of ≤4 — flat in
absolute terms on a third the corpus, and **5 of the 7 are in the two documentation PRs whose
purpose was reducing class F**; the AC half of that clause passes (**0** ticked-without-evidence).
❌ **Telemetry, fourth strike on a clause declared binary → the columns are retired** (note 21).
The class-F failure is what motivated making the retro's figures executable rather than writing
another paragraph. See [v1.15.0.md §7](v1.15.0.md).

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

**v1.14.0's standing prediction — CHECKED AT v1.15.0 AS SCHEDULED: 3 PASS, 1 FAIL, 1 resolved by
retirement.** Stale approvals **0 of 6** ✅ (from 4 of 10 — third consecutive clean release).
PRs merged with no verdict at all **0** ✅ — the first fully clean window since the control landed
(1, 6, 1 in the three releases between). Merged-result findings **0 in review** ✅; one was caught
*pre-push* by `check_changelog_merge.sh` (deleting the `### Added` heading along with the exempt
placeholder bullet fails check 4), which is the layer the clause wanted it caught at.
❌ **Class-F blocker+major 7** against ≤2 — missed at every release since the clause was set
(5, 22, 8, 7); four consecutive misses on one clause is itself the finding, and it is why v1.15.0
made the retro's figures executable instead of restating the target. `Review rounds` **resolved by
retirement** (note 21): unfilled for both shipped issues, and the thread-derived `Mean rounds`
column supersedes a board field v1.12.0 already measured disagreeing with the thread.
**Its falsifier still bites and is still reported as such:** merge provenance is unmeasurable here
— all merges report `mergedBy: mavrovde`, since owner and agents share one identity — so the
defensible claim stays *"no merge that reached the gate carried an uncovered commit"*, supported
this window by the empty bypass log and by 6 of 6 merges carrying pre-merge verdicts.
See [v1.15.0.md §7](v1.15.0.md).

²⁷ **`Non-independent verdicts` is back-filled only where a release's own record measured it, and
`n-a` everywhere else means NOT MEASURED — not "zero".** The pre-v1.15.0 rows are `n-a` because the
disclosure clause did not exist until v1.15.0's change D, so nothing distinguishes a solo verdict
from an independent one in those windows; assuming they were all independent would invent a
baseline. v1.15.0's cell (3 of 11 verdicts, on 2 of 6 PRs) comes from its §4 table; v1.15.1's and
v1.15.2's are 9 of 9 verdicts across both windows, each carrying the disclosure — measured by
matching the disclosure paragraph in every verdict body, **after stripping markdown emphasis**: a
first matcher for `not an independent` returned 8 of 9, because #437 writes
`— **not** an independent` and the bold splits the phrase (v1.15.1 §4).

²⁸ **6 PRs and 3 PRs, and the tag→tag spans ARE the work this time.** Unlike v1.15.0's 71.6h idle
gap, v1.15.1's 4.03h and v1.15.2's 1.60h are continuous sessions with per-PR lead times of 12–75
minutes ([v1.15.1 §5](v1.15.1.md), [v1.15.2 §5](v1.15.2.md)). **The corpus bound changed at
v1.15.1:** `scripts/retro_metrics.sh` now takes the previous RELEASE PR's number for the lower edge
(`retro_metrics.sh 436 441`), not the previous tag, because the tag commit read `11:09:19Z` and its
own release PR #436 merged at `11:09:20Z` — the mirror of note 12, and it put #436 into v1.15.1's
corpus as a seventh PR. The tag form still works and says which bound kind it used.

**Re-derivability, measured on every row rather than asserted from one sample.** The first draft of
this note claimed "every earlier row remains re-derivable" on the strength of a single spot check;
#452's review falsified it, because the script listed with a bare `--limit 100` in default order
and silently returned a short corpus (the v1.12.0 window came back with 7 of its 10 PRs). With the
server-side `merged:>=` bound and the truncation guard added in #452, the whole series was re-run:

- **`PRs merged` re-derives for all nine rows** under the PR-number lower bound —
  `245 281` → 10, `281 300` → 16, `300 327` → 11, `327 385` → 17, `385 406` → 14, `406 428` → 17,
  `428 436` → 6, `436 441` → 6, `441 446` → 3.
- **`Median files/PR` re-derives for all nine rows** (17, 14, 20, 8, 7, 8, 7, 9, 6).
- **The TAG form over-counts FOUR of the nine windows by exactly one PR**, and in each the extra is
  the *previous release's own PR*: three older windows — v1.13.0 16→17 (#281), v1.14.1 17→18
  (#327), v1.14.3 17→18 (#406) — **plus v1.15.1 itself**, this note's motivating case
  (`ref:v1.15.0 441` → **7**, extra #436, against 6 under the PR form). The other five agree with
  the PR form exactly. So the asymmetry is not a v1.15.1 curiosity: it reproduces on four of nine
  windows, which is the measured argument for the PR-number bound. *(Round 2 of #452 caught this
  cell at "three windows" — the count had silently excluded the very window the sentence two
  paragraphs above uses as its example.)*
- **The verdict counts and the rates derived from them do NOT re-derive before v1.15.0, and were
  never expected to:** those cells were counted with the matchers notes 1 and 5 describe, which
  this instrument replaced (e.g. v1.12.0 publishes 24 loose verdicts / 2.4 mean; the instrument's
  heading-anchored, merge-replayed count is 23 / 2.30). Only the three newest rows — v1.15.0
  (`v1.14.3 436`: 6 / 11 / 1.83 / 50% / 45% / median 7), v1.15.1 and v1.15.2 — reproduce
  **every** cell exactly.

²⁹ **The rate cells in these two rows are not a measurement of the gate, and must never be quoted
alone.** Every one of the 9 verdicts across both windows was written by the session that authored
the PR (the owner directed the window to run solo). A finding an author makes while reviewing their
own diff becomes another commit *before* the verdict is posted, not a REQUEST CHANGES followed by a
fix — so `mean rounds 1.00` and `rework share 0%` mean the rework happened before the clock started,
not that there was none: two of v1.15.1's six PRs carry a defect found and fixed pre-merge. The
class-F and class-G cells have the same defect one level down — they count what a session caught
re-reading itself. **The control that shows what that misses:** v1.15.0's record states its bypass
log "holds nothing for this window"; the log holds `2026-09-18T10:13:18Z bypass PR=435`, and #435
merged three seconds later, inside that window. Self-review re-measured eleven claims on that PR in
a table and missed the twelfth. See [v1.15.1 §3 and §4](v1.15.1.md) for the full analysis and for
which cells remain comparable with the 14–17 PR windows (median files/PR: yes; the rate cells: no).
Note the falsifier that did **not** fire at v1.15.1: median files/PR ROSE 7 → 9, and the window
contains an 89-file PR — the rounds did not fall because the work got small. At v1.15.2 it fell to
6, close to the ~5 ambiguity floor, and that row is read accordingly.

³⁰ **v1.15.0's `Merged w/o valid APPROVE` cell stands at 0 — the merge it concerns was gated — but
the sentence that release's record used to support it does not.** #435 merged with
`PR_MERGE_GATE=0` (one line in the bypass log at `10:13:18Z`; merge at `10:13:21Z`) while carrying a
covering pre-merge APPROVE posted at `10:12:15Z` naming the head `9be3b678`. So nothing merged
unreviewed and the cell is right; the claim "the bypass log holds nothing for this window" is wrong.
Corrected here rather than in three places — the analysis is in [v1.15.1 §3](v1.15.1.md).
**A second, live defect fell out of it:** #392 specifies that a bypass leaves *both* a log line and
a PR comment; **no comment was ever posted on #435**, because the comment is emitted from a detached
background subshell with all output and failures discarded — filed as **#453**. An empty bypass log
is still positive evidence; an absent bypass **comment** is not, and this convention should not be
read as if it were.

³¹ **The instrument changed IN this window, and both numbers are published.** v1.16.0's change A
replaced three drifted copies of the verdict filter with one executable grammar,
`scripts/verdict-heading-lib.sh` — the marker must OPEN the first non-empty line, after at most a
whitelisted `Round N —` / `PR-REVIEWER VERDICT:` prefix, with a non-hyphen boundary after it. The
cell reads **26 canonical / 27 loose**: the 27th body is #458's author note
*“Round-3 delta — head is now …; the round-3 APPROVE covered …”*, which the pre-v1.16.0 filter
counted as the newest verdict and which the merge gate would have merged on ([v1.16.0
§6 A](v1.16.0.md)). **Comparability was measured, not assumed:** re-running the instrument on the
three windows published under the anchored filter reproduces every cell with
`non-verdict bodies skipped: 0` — v1.15.0 (`v1.14.3 436`), v1.15.1 (`436 441`), v1.15.2
(`441 446`). Over all 229 merged PRs / 361 marker-bearing first lines the grammar accepts 354 and
rejects 7, and exactly **one** historical classification moves: **#83** (2026-07-26, a blockquoted
verdict), outside every window the audit runs on — re-measured against the pre-change script on
`--since 2026-08-15`, which returns an identical PR-by-PR classification. Rows above v1.16.0 keep
the filter they were published under; each row's footnote says which.

³² **`Approved r1` counts PRs whose FIRST verdict was an APPROVE — not PRs that merged after one
round**, and v1.16.0 is the window where the two diverge visibly: **#449** is one of the three and
then took **four** verdicts, because its round-1 APPROVE was superseded by a delta-confirm that
found a blocker. The definition is unchanged since v1.12.0 and was deliberately NOT redefined —
silently changing it would break every row above — so read this column beside `Mean rounds`, never
alone. [v1.16.0 §8](v1.16.0.md) carries the clause that fixes the instrument rather than the
column.

³³ **8% is measured over 23 of 26 verdicts, because 3 state nothing either way.** Rule 13 obliges
only a *non-independent* verdict to disclose, so silence is ambiguous: an independent review that
did not bother looks exactly like an undisclosed solo one. Both of this window's solo verdicts
(#448 r1, #449 r1) disclose — the disclosure clause is 11 of 11 across three releases — but the
column's denominator is the number of verdicts that said *something*. v1.16.0's change C makes
provenance a statement in **both** directions in `pr-reviewer.md` and the playbook; from the next
release this cell is measured over all canonical verdicts or not at all.

**v1.15.0's prediction: 4 pass, 1 n/a, 1 partial — scored at v1.15.1.** Merged with no valid
APPROVE **0 of 6** and stale approvals **0 of 6** ✅ (checked against the bypass log, which is empty
for that window — note 30). Disclosure **6 of 6 = 100%** ✅, and its falsifier (b) did not apply:
with no independent verdicts at all the clause was maximally testable rather than vacuous. Release
cut with an empty queue ✅ — `Release queue for 'release:v1.15.1': empty (checked).` quoted in #441's
body **at cut time**, satisfying falsifier (c); v1.15.2 repeated it on #446. Mean rounds **1.00**
with zero PRs at ≥4 verdicts ✅ and the median-files control did not fire (7 → 9). Class G **n/a** a
third window running — both instances were in *new* scripts, killed by their own new self-tests
before review, so #393's existing contracts had nothing to cover. ⚠️ **Class F scores 0 on the
letter and is reported as unmeasured on the intent**: with the author as reviewer, "how many
unmeasured claims reached review" is unanswerable, and the one checkable claim from the previous
record was false (note 30). See [v1.15.1 §7](v1.15.1.md) and [v1.15.2 §7](v1.15.2.md).

**v1.15.1's + v1.15.2's standing prediction: 5 clauses PASS, 3 FAIL — scored at v1.16.0**, the
first window since v1.14.3 with a corpus large enough to test any of them (10 PRs / 26 verdicts,
against 6/6 and 3/3). Passes: ≥1 independent verdict with the solo share **100% → 8%** ✅ —
falsifier (b) respected, since the window's largest PR (#455, 97 files) carries an independent
verdict; **0** merged without a valid APPROVE and **0** stale approvals ✅, the first large-corpus
window for which that means anything; 100% disclosure on the non-independent verdicts ✅ (11 of 11
across three releases — with the gap note 33 describes); the cut made with an empty release queue
and the previous retrospective present, both quoted at cut time ✅; class T **0** ✅ with the files
grepped named, which is what falsifier (d) asked for. ❌ **Class F 9, 4 of them on doc surfaces**,
against ≤4/≤2 — top or joint-top for the **sixth consecutive retrospective**; its re-measurement
control PASSED while the class scored 9, so the control is what [v1.16.0 §8](v1.16.0.md) replaces,
not the target. ❌ **The release-time security check was posted after the release PR merged** — run
and clean, on the thread too late, which is the back-filled-verdict shape. ❌ **4 of 8 closed
issues on Project 3**, two of those four in the previous release's bucket. The two behavioural
failures are one sentence: *the evidence exists, but not where the rule requires it at the time it
requires it.* See [v1.16.0 §7](v1.16.0.md).

**Standing prediction (set by v1.16.0, checked at the next release):** see
[v1.16.0 §8](v1.16.0.md). It **keeps clauses 1, 3, 5 and 6 of [v1.15.1 §8](v1.15.1.md) as written**
(independent verdict; zero invalid-APPROVE and zero stale merges; empty release queue + previous
retro, evidenced at cut time; class T ≤1) and revises the four that failed or passed too easily:
class F stays at **≤4 / ≤2 on doc surfaces** but its control becomes *re-measure the load-bearing
sentence of the previous retro's LARGEST change*; the disclosure clause becomes **100% of verdicts
state provenance in EITHER direction**, denominator = all canonical verdicts; the security-check
clause is scored from the thread's timestamps against `mergedAt`, never from alert counts; and the
board clause narrows to *in that release's bucket*, exempting an issue opened and closed inside a
single PR (the rule-11 shape, #461). Two new clauses: the tightened merge-gate grammar either
**denies at least one merge or is never noticed**, with a FALSE deny reported verbatim; and **mean
rounds ≥2.0 while classes F and G fall**, the test of whether rounds are spent on material
difficulty rather than on unmeasured claims.

**Superseded — the v1.15.1/v1.15.2 standing prediction** (kept for the record): see
[v1.15.1 §8](v1.15.1.md) for the six clauses and [v1.15.2 §8](v1.15.2.md) for the two it adds.
In brief — **at least one INDEPENDENT `pr-reviewer` verdict in the window** (scored against its
largest PR, `n/a` if the solo directive still stands); class-F blocker+major **≤4 and ≤2 on
documentation surfaces**, plus a new control: **re-measure one load-bearing evidence sentence from
the previous retrospective and report whether it reproduced**; zero merges with no valid APPROVE
and zero stale approvals; **100% disclosure** (now a hold at 9 of 9); a cut with an empty release
queue **and** the previous release's retrospective present, both from the `bump_version.sh` output
captured at cut time; **class T ≤1**; a **release-time security check posted on every release PR
before its merge**; and **every issue a release closes present on Project 3 with its
`release:vX.Y.Z` label before the cut**.

**Superseded — the v1.15.0 standing prediction** (kept for the record): class-F blocker+major
**≤4 AND ≤2 of them on retro/wiki documentation surfaces** (the second half is the real test of
`scripts/retro_metrics.sh`); zero merges with no valid APPROVE and zero stale approvals; **every
non-independent verdict carries the rule-13 disclosure** (100%, reported as an independent/solo
split table); a release cut with an **empty `release:vX.Y.Z` queue**, evidenced by
`bump_version.sh` printing `empty (checked)` at cut time; mean rounds **≤2.2** with zero PRs at ≥4
verdicts; class G **≤4** and **0 on the surfaces #393's contracts cover** (carried forward — v1.15.0
scored that half n/a).

**Falsification stated up front:** (a) the no-verdict and stale-approval clauses go to zero for
free on a small corpus — v1.15.0 was **6 PRs**; state the corpus size beside every rate and prefer
per-PR normalisation. (b) The disclosure clause is vacuous if the window runs with independent
reviewers throughout — score it *"n/a — no solo verdicts"*, never a pass. (c) The release-queue
clause **cannot be scored after the fact**, because a retro that re-labels issues (as v1.15.0's §2
did) erases the evidence — capture the `bump_version.sh` output **at cut time**. (d) If class F
falls while the retrospective simply publishes fewer numbers, the instrument has produced the
appearance of success and nothing else; the control is that §5 and the trend row stay fully
populated. (e) The older falsifier still stands: if mean rounds rise back above 3.0 while classes
F, G and S stay low, the constraint has moved to material difficulty and the answer is not another
charter paragraph.

*(Those are v1.15.0's falsifiers, kept because they were scored above. The LIVE set belongs to the
standing prediction and is in [v1.15.1 §8](v1.15.1.md) — including the two that only exist because
of this window: an independent-review clause can be satisfied trivially by reviewing the easiest PR,
and class T cannot be counted at all unless the retro names the files it grepped.)*

## How to count consistently

**Run `scripts/retro_metrics.sh <prev-tag> <release-PR>` — it encodes the rules below and prints
every headline figure.** From v1.15.0 that is how a row is produced. The prose here stays as the
*specification* (a third party must be able to re-derive a cell from it, which is what #429's
round-1 major was about), and the bullets keep the incidents that explain each rule — but the
figures themselves should come from the executable, because five consecutive releases have found
hand-counted numbers in these very documents to be the top defect class.

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

  **`scripts/retro_metrics.sh` RUNS the canonical half of this, with the server-side bound and the
  truncation guard — run it rather than pasting.** The two blocks below are kept because they show
  the loose and the anchored matcher *side by side*, which the script does not; both were themselves
  instances of the `--limit` defect until #452 round 2 (the first returned **7** for the v1.12.0
  window against the correct **10**), which is why they now carry the same bound and guard.

  ```bash
  # The corpus is every PR MERGED BETWEEN THE TAGS — not `git log <prev>..<tag>`,
  # which cites issue numbers as well as PRs and sweeps in PRs that merged before
  # the previous tag. Both published counts for v1.12.0 (29/14 and 32/12) came
  # from getting the CORPUS wrong, not the matcher.
  #
  # TWO bounds, both load-bearing:
  #   * the DATES are rendered in UTC. `%aI`/`%cI`/`%cs` render in the COMMIT's own
  #     offset, and a `+02:00` string compared against a `Z` value mis-selects the
  #     corpus (note 11). Measured: `%cs` on 5012056c (2026-09-19T00:09:14+02:00)
  #     gives 2026-09-19 — one day LATE, silently dropping every merge 22:09Z..24:00Z.
  #   * the LISTING is bounded server-side and `--limit` is a truncation guard, not a
  #     page size: `gh pr list` runs in DEFAULT order, so a bare limit filtered
  #     client-side returns an arbitrary prefix.
  PREV=$(TZ=UTC git log -1 --format=%cd --date=format-local:%Y-%m-%dT%H:%M:%SZ <prev-tag>)
  CUR=$(TZ=UTC git log -1 --format=%cd --date=format-local:%Y-%m-%dT%H:%M:%SZ <tag>)
  LIM=400
  PRS=$(gh pr list --state merged --limit $LIM --search "merged:>=${PREV%%T*}" \
          --json number,mergedAt,reviews,comments)
  [ "$(printf '%s' "$PRS" | jq length)" -lt $LIM ] \
    || echo "TRUNCATED at $LIM — raise it; this count cannot be measured"
  printf '%s' "$PRS" \
    | jq "[.[] | select(.mergedAt > \"$PREV\" and .mergedAt <= \"$CUR\")]
          | map([(.reviews[]?.body),(.comments[]?.body)]
                | map(select(test(\"APPROVE|REQUEST CHANGES\"))) | length)
          | add"
  ```

  **What the corrected block returns, and why it is not the published number.** Measured on the
  v1.12.0 window at #452 round 2: the OLD bare-`--limit 100` form returned **5** PRs where the
  reviewer measured **7** on what looked like the same command. The tempting explanation — "the
  default order is not stable" — is wrong, and measurement says so: re-run within one moment and
  the old form is perfectly repeatable (`%aI`-rendered bounds → 6, 6, 6; UTC-rendered bounds →
  5, 5). Two other things moved instead. The two runs **rendered the window bounds differently**,
  which shifts which PRs fall inside the window, and the `--limit 100` prefix **shifts as the
  repository grows**, so a reading taken before #455 merged is not the same corpus as one taken
  after. Neither is a stability property of `gh`; both are the defect the corrected form removes,
  which returns **9 PRs / 22 loose verdicts**. The published row is **10 / 24**, and the
  difference is one PR: **#281, the v1.12.0 release PR itself, merged at `07:53:36Z` — one second
  after its own tag commit's `07:53:35Z`** — carrying exactly 2 verdicts. 9 + 1 = 10 and 22 + 2 =
  24. That is note 28's one-second asymmetry demonstrated a third time, and it is why the corpus of
  record is `retro_metrics.sh` bounded on the release PR's `mergedAt`, not this block.

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
  # Same corpus, same bound and guard as the block above (PRS/PREV/CUR/LIM are reused).
  printf '%s' "$PRS" \
    | jq "[.[] | select(.mergedAt > \"$PREV\" and .mergedAt <= \"$CUR\")]
          | map([(.reviews[]?.body),(.comments[]?.body)]
                | map(select(split(\"\n\") | map(select(test(\"\\\\S\"))) | (.[0]//\"\")
                             | test(\"REQUEST CHANGES|APPROVED?\"))) | length)
          | add"
  ```

  **From v1.14.3 the canonical filter is ANCHORED: the marker must OPEN the first non-empty
  line** (`startswith`/`^`-anchored, not `test(...)` anywhere in the line) — the fix footnote
  10 promised. The in-line form admits an author body whose first line merely *mentions* a
  verdict: measured on #421, a live-demonstration comment ending *"(Not a verdict; the
  standing verdict is the REQUEST CHANGES above.)"* — which is fn 10's #373 hole one level
  deeper. When re-counting a pre-v1.14.3 window, use the filter its row was published under
  (each row's footnote says which).

  **From v1.16.0 the grammar is ONE executable artifact, `scripts/verdict-heading-lib.sh` — source
  it, do not re-type it.** The anchored `test(...)` above is the *shape*; the library adds what
  measurement over 361 real headings showed was needed (a whitelisted `Round N —` /
  `PR-REVIEWER VERDICT:` prefix, and a non-hyphen boundary so `APPROVE-ADJACENT` is not a verdict)
  and is shared by all three readers — `pre-merge-gate.sh`, `audit_no_verdict_merges.sh` and
  `retro_metrics.sh`. Three drifted copies is how #458's author note became "the newest verdict" in
  the merge gate (note 31). Two portability traps it pins with mutants: **`gh … -q` is gojq on Go
  RE2 and has no lookahead** (a `(?!…)` boundary passes every `jq` self-test and dies at runtime),
  and a mutation needle must target the grammar, not the comment above it.

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
