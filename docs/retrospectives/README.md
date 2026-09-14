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

| Release | PRs merged | Verdicts (loose / canonical-heading) | Mean rounds | Approved r1 | Rework share of verdicts | "Claim not measured" findings | Median files/PR | Tokens | Tokens / merged PR | Agent-time |
|---|---|---|---|---|---|---|---|---|---|---|
| [v1.12.0](v1.12.0.md) | 10 | 24 / n-a¹ | **2.4** | 20% (2/10) | 58%⁴ | **9**⁵ | 17 | 9.07M² | 907k² | 28.1h² |
| [v1.13.0](v1.13.0.md) | 16 | 52 / **50** | **3.13** | **0% (0/16)** | 68%⁴ | **12**⁵ | 14 | not recorded³ | n-a³ | 23.5h tag→tag |
| [v1.14.0](v1.14.0.md) | 11 | 23 / **20** | **1.82** | 27% (3/11)⁶ | 45%⁷ | **4**⁵ | 20 | **8.38M**³ | 762k³ | **35.5h**³ · 53.0h tag→tag |
| [v1.14.1](v1.14.1.md) | 17¹¹ | 44 / **41**¹⁰ | **2.41**¹⁰ | **29% (5/17)** | 59%⁸ | **5**⁵ | 8 | **2.60M**⁹ | **153k**⁹ | **6.0h**⁹ · 107h tag→tag |

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
