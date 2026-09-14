# Delivery statistics — three releases measured

What the last three releases actually cost, what moved, and why. Then the plan for
the targets set on the next one.

Window: **v1.13.0 → v1.14.0 → v1.14.1**, measured 2026-09-14. Every figure here was
produced by running the counting commands in
[`docs/retrospectives/README.md`](../retrospectives/README.md) — not by reading an
earlier summary. Where a number in an older document disagrees, this page says so and
explains which is right.

> **Why this page exists.** A single release's numbers mean almost nothing: mean
> review rounds can halve because the team improved or because the work got easier,
> and one data point cannot tell you which. Only a series separates the two, and only
> if every release is counted the same way.

---

## The table

| Metric | v1.13.0 | v1.14.0 | v1.14.1 | Direction |
|---|---|---|---|---|
| PRs merged | 16 | 11 | **17** | — |
| Canonical verdicts | 50 | 20 | **41** | — |
| **Mean review rounds / PR** | 3.13 | 1.82 | **2.41** | ↗ worse than v1.14.0 |
| **Round-1 approvals** | 0% (0/16) | 27% (3/11) | **29% (5/17)** | ↗ best in series |
| Rework share of verdicts | 68% | 45% | **59%** | ↗ worse |
| Median files / PR | 14 | 20 | **8** | ↘ smaller PRs |
| **Merges on a stale approval** | not measured | **4 of 10** | **0 of 16**³ | ↘ **much better** |
| PRs merged with no verdict at all | 0 | 1 (#321) | **1 (#355)** | flat |
| Subagent tokens | not recorded | 8.38M¹ | **2.60M**² | — |
| Agent-time | 23.5h tag→tag | 35.5h¹ | **6.0h**² | — |

¹ Project 3 recorded fields, including one still-`In Progress` item whose host work has
not shipped — the figure is not purely v1.14.0's delivered scope.
² **Subagent runs only.** Main-loop tokens are not included, so the true cycle cost is
higher. Not comparable with v1.14.0's number, which was collected differently. See
[§ The cost columns are not yet a series](#the-cost-columns-are-not-yet-a-series).
³ Measured over the 16 PRs that carried a verdict. Merge provenance is **not
establishable** in this repository — every merge reports the same identity — so read
this as "no merge that reached the gate carried an uncovered commit", not as proof that
every merge reached it. #355 is direct evidence at least one did not.

**Round-1 approvals rose in every release of the series — 0% → 27% → 29%**, while
median PR size went **14 → 20 → 8** — a rise, then a fall to half where it started. That is the headline, and the next section is about
why the other columns went the wrong way at the same time.

---

## Reading the dynamic

### What genuinely improved: approval coverage

The clearest win in the series, and the only column that went from broken to solved.

At v1.14.0, replaying every thread **as it stood at merge time**, four of ten reviewed
merges carried commits no approval had seen: one merged four commits after its only
verdict — including the fixes to the reviewer's own findings *and* a behaviour change —
one merged two seconds before its delta-confirm was posted, one merged a `main` merge,
and the **release PR** merged a CHANGELOG commit, so the `v1.14.0` tag sits on a commit
no review covered.

At v1.14.1 the same replay returns **0 of 16**. Every reviewed PR merged with an
approval newer than its last commit.

The cause is not diligence. It is `.claude/hooks/pre-merge-gate.sh`, which refuses
`gh pr merge` when the newest canonical `APPROVE` predates any commit on the PR. The
rule existed before; the hook is what made it true.

> **The falsification test, and its limit.** This clause can hit zero for the wrong
> reason: a web-UI merge is invisible to a `PreToolUse` hook, so merges routed around
> the gate would look identical to merges that passed it. The prescribed check is merge
> provenance — and **here it cannot settle the question.** All 17 merges report
> `mergedBy: mavrovde`, because the owner and every agent post under the same identity,
> and the API exposes no CLI-versus-web-UI distinction.
>
> So the honest reading is narrower than "the gate worked": **of the merges that
> reached the gate, none carried an uncovered commit**, and 16 of 17 threads show an
> approval newer than the last commit. That is a real improvement on 4-of-10, but the
> zero is *partly unmeasured* rather than fully confirmed — and #355 merging with no
> verdict at all is direct evidence that at least one merge in this window did not stop
> at the gate. Closing this measurement gap is itself a v1.14.2 task.

### What got worse, and the honest reason

Mean rounds rose 1.82 → 2.41 and rework share 45% → 59%. Two contributions, and they
are not equally flattering.

**1. The material was harder — genuinely.** v1.14.1 was a security-and-hardening
release. Its reviews caught a **live open redirect that survived three separate fixes
and three green CI boards**, a **new security bypass introduced by an optimisation to
the destructive-command guard** (a helper assumed to be identity on quote-free input
also de-escaped `\X` and blanked `#`, flipping **seven** guarded commands from deny to
allow — one of them the exact command from the incident the guard was written for), a drift checker whose entire `lint` category **could not fail**, and a CHANGELOG
tool that **silently deleted** unrecognised sections — 66 commits in this repository's
history carry one. Rounds spent finding those are not waste.

**2. Two PRs dominated, and that part was avoidable.** #373 took 8 verdicts and #371
took 4 — **12 of 41 verdicts, at least 964,411 tokens, 46% of all review spend (37% of
total spend), on 2 of 17 PRs.** That is a floor: it sums only the ten runs dedicated to
those two PRs, so any verdict raised for either inside a batched run is uncounted. The causes were self-inflicted and specific:

- a fix aimed at the **wrong vulnerability** (reverse tabnabbing, when the alert was an
  open redirect);
- a guard **that never ran in production** — the specs exercised a configuration the
  deployed app does not use, so three green rounds proved nothing;
- a claim that a value was a module constant when it was read from the environment;
- a published count of remediated findings that was wrong twice running — "from 65 to 9
  actionable findings" when the measurement was 8, then 5.

Each cost a full round. None was a hard problem; all were unverified claims.

**The distribution is the finding, not the mean.** Excluding those two PRs, the other
15 averaged **1.93** verdicts — essentially v1.14.0's 1.82. The team did not get
uniformly slower; a small number of PRs went badly wrong and dragged the average.
Chasing the mean would be chasing an artefact.

### The tax that was paid and then removed

**Five stale-base blockers across five PRs**, two of which consumed a full review round
and produced nothing but "rebase first" — about 140,000 tokens. Fixed mid-cycle: the
merge gate now refuses a `CONFLICTING` base, and `/prep-pr` step 2 checks CHANGELOG
*entries* rather than headings, because merging two `[Unreleased]` sections duplicates
headings and entries independently and a heading-only check passes while the entries
underneath are doubled.

**Batching was tried and abandoned mid-cycle.** Four runs reviewed 3–4 PRs each and cost
425,000 tokens; the worst single run was **162,690 tokens in 25.5 minutes**. Verdicts
arrived late and together, so fixes for the first PR could not start until the last was
analysed. Runs after the ban are one-PR-per-review and cheaper per verdict.

### Still unfixed: PRs merged with no verdict at all

One per release, two releases running — #321 at v1.14.0, **#355 ("Add Bandit security
scan workflow") at v1.14.1**. Rule 13 admits no carve-out for CI-only or
workflow-only changes, and the merge gate is supposed to refuse this. One slipping
through in consecutive windows means the gate was bypassed or never reached, and the
count is flat rather than falling.

This is the one clause of v1.14.0's standing prediction that v1.14.1 does **not**
satisfy. It is reported here rather than omitted, because a statistics page that only
shows the columns that improved is advertising.

### The cost columns are not yet a series

v1.13.0 recorded no tokens at all. v1.14.0's 8.38M comes from Project 3 fields and
includes an item still in progress. v1.14.1's 2,600,168 was captured live from agent
completion reports and covers **subagents only**; the per-run table is committed as an
appendix to `docs/retrospectives/v1.14.1.md`, so it is the first cost figure in this
series a reader can re-derive.

**Do not read 8.38M → 2.60M as a 69% cost reduction.** They measure different
populations. The columns stay because a series has to start somewhere, but the first
release where two adjacent numbers are comparable is the next one — and that is itself
a target below.

One measurement rule was learned the hard way: **effort telemetry is not recoverable
after the fact.** When a release manager was asked to reconstruct it, it correctly
refused. It is captured during the cycle or it does not exist.

---

## How these numbers are counted

Briefly, because the conventions changed the headline more than once.

**A verdict is a posted body whose first non-empty line carries `APPROVE` or
`REQUEST CHANGES`.** Position, not authorship — every agent here posts under the
owner's identity, so an author's fix report and a reviewer's verdict cannot be told
apart any other way. A loose full-body match returns **44** for this window against the
canonical **41**. The three extras are *not* all author fix reports, which is worth
stating precisely: one is (#371's `## All four blockers fixed, plus the majors`), one is a
release-manager's review *request* (#385), and one is a close-the-loop comment (#355).

**And the canonical filter has the same hole one level in.** Because it keys on position,
it admits #373's author comment `## Round-2 APPROVE noted — and the head moved, so this
needs a round 3` — a note that an approval no longer covered the head, counted as a
verdict. Under the convention's own wording ("posted **review** bodies") the window is
**40 / 2.35 / 58%**. The published figures keep 41 because that is what the documented
filter returns as run; the discrepancy is recorded in `docs/retrospectives/README.md` so
the next cycle fixes the filter instead of rediscovering it.

**Run the widened sweep even when you expect nothing.** Every first line the matcher
*rejected* was read for this window. It found **no missed verdict** — the rejects are
author fix reports, Bandit/CodeQL bot messages, and a handful of **zero-length comment
bodies** on #371 and #373, which appear as a blank first line and are not verdicts.
That sweep is not optional theatre: at v1.13.0 it found two `## ⛔ REJECTED` verdicts in
a since-retired heading format, which had hidden two real rounds and made that release
look like it had one round-1 approval when the true figure was **0 of 16**.

**Get the corpus right before blaming the matcher.** The corpus is every PR *merged
between the tags*, not `git log <prev>..<tag>` — which cites issue numbers as well as
PRs and sweeps in PRs merged before the previous tag. Both wrong published counts for
v1.12.0 came from the corpus, not the regex. Four hand counts of that window (30, 32,
34, 29) were reported and **none reproduced**; count by script.

**A correction this page makes.** Issue #386 set the v1.14.2 KPI baseline at "2 of 13
round-1 approvals (15%)" and "33 rounds / 13 PRs". Those were counted mid-cycle over a
partial corpus. The canonical window figures are **5 of 17 (29%)** and **41 verdicts /
17 PRs = 2.41**. The baseline in #386 has been corrected, because a target measured
against the wrong baseline is worse than no target.

---

## The plan for the KPIs

Targets for v1.14.2 (issue **#386**), restated against the corrected baseline.

| Dimension | v1.14.1 (corrected) | v1.14.2 target |
|---|---|---|
| Mean review rounds / PR | **2.41** | ≤ 1.6 |
| Round-1 approvals | **29%** | ≥ 50% |
| PRs merged with no verdict | **1** | **0** |
| Merges on a stale approval | **0** | **0** (hold) |
| PRs consuming ≥4 verdicts | **2** | ≤ 1 |
| Subagent tokens / merged PR | **~153k** (2.60M ÷ 17) | ≤ 120k |
| Review share of agent spend | **81%** | ≤ 65% |
| Docs-only push wall-clock | full gate, ~15 min | ≤ 2 min |
| PR opened → first verdict | often hours | ≤ 30 min |
| Fake-greens reaching review | **5** | 0 |

### What is actually being changed to hit them

Targets without mechanisms are wishes. Each of these is a concrete change, most already
shipped or in flight.

**Fewer rounds — attack the outliers, not the mean.** Since 15 of 17 PRs already sit at
1.93, the work is preventing the #373-shaped PR. The mechanism is `/prep-pr` step 7:
list every number and claim in the PR body, commit message and CHANGELOG entry, then
*run the thing that produces it at this head*. Three of #373's rounds were unverified
claims — a fix for the wrong vulnerability, a guard that never ran in production, and a
published remediation count that was wrong twice running.

**Zero no-verdict merges.** The recurrence of #321 and #355 is a gate-coverage question
before it is a discipline question: establish whether the gate was bypassed or never
reached, then close that path. Reported as unmeasured if provenance cannot be
established — never as a pass.

**Faster pushes — issue #377 (P0, in implementation).** Path-scoped gates: a docs-only
push runs docs checks only, a backend-only push runs backend legs only, a one-project
frontend change runs that project's Vitest alone. Pushes to `main` and release branches
keep the **full** gate, because that is where a migration-head fork or a CHANGELOG
collision actually costs a red deploy. The rationale is behavioural: cheap gates get
run, expensive gates get bypassed, and a bypassed gate protects nothing. The PR must
report before/after wall-clock for all three shapes — not "should be faster".

**Lower cost.** Two identified pots go to zero by rule rather than by effort: batching
(425k tokens across four runs) is banned, and stale-base rounds (~140k) are now a
mechanical deny. The rest follows from fewer rounds.

**Zero fake-greens.** Every one of the five was found by *mutation*, never by reading —
four in a single test file (an indentation-protected fixture, a masking bug, a harness
that never asserted the script ran, and a counter killed by a subshell), plus an entire
lint category that could not fail. The target is not "write better tests" but a
mechanical step: **neuter the thing under test and confirm the suite goes red, before
requesting review.**

How far that is from true today, measured rather than assumed: of the four `PreToolUse`
hooks, **three** carry a `--mutations` contract (`pre-push-tests`, `pre-merge-gate`,
`guard-stack-resources`) and `guard-destructive` does not; of the seven `scripts/*.test.sh`
self-tests, **none** does — including `dedup_changelog_unreleased.test.sh`, which
is where four of the five fake-greens lived. Closing that gap is filed as issue **#393**.

**Make the cost columns comparable.** Capture per-agent telemetry live for every run,
so v1.14.2 is the first release whose token figure can be honestly compared with its
predecessor. Meta-target: **zero runs with unrecorded cost.**

### How this will be judged

Stated in advance so it cannot be rationalized afterwards.

- The v1.14.2 retrospective reports **every row above with its measured number**, beside
  this baseline.
- **A target missed with a reason is a useful result; a target quietly dropped is not.**
  Any KPI that moves the wrong way gets explained, not omitted.
- **Falsifiers**, because these metrics can improve for bad reasons:
  - Round-1 approvals can rise by *approving early and merging the fixes unreviewed* —
    which is precisely what happened at v1.14.0, where all three round-1 approvals were
    also stale merges. So round-1 approvals are read **beside the stale-approval
    count**, never alone.
  - Mean rounds can fall because PRs got trivially small. Median files/PR is published
    beside it as the control; it already fell 20 → 8 this window.
  - A no-verdict or stale-approval count can hit zero because merges stopped passing
    through the gate. Provenance is measured first; unmeasured merges are reported as
    unmeasured.

---

## Links

[Team and process](team-and-process.md) · [`docs/retrospectives/`](../retrospectives/)
(per-release records and counting conventions) · `CLAUDE.md` (the operative rules) ·
Issues #386 (KPIs), #377 (scoped pre-push gate).
