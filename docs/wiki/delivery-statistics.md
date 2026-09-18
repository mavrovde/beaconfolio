# Delivery statistics — reading one three-release window

> **The numbers are not here.** They are in
> [the trend table](../retrospectives/README.md#the-trend-table), which is the one place
> a release figure is written. This page is the *analysis* of the v1.13.0 → v1.14.1
> window: what moved, why, and what was changed in response.

> **Status (updated 2026-09-18): this page is the ANALYSIS of one window; the figures
> live elsewhere.** Its window is v1.13.0 → v1.14.1. **Every release since has shipped
> past it** — how many, and how each scored, is a figure, so it is not written here: the
> series — including how the plan in the second half of this page actually scored — lives ONLY in the
> canonical sites: the trend table in
> [`docs/retrospectives/README.md`](../retrospectives/README.md) and the per-release
> records in [`docs/retrospectives/`](../retrospectives/).
>
> **The metrics table that used to open this page has been DELETED, not refreshed.** It
> restated ten rows the trend table already carries, and refreshing a restated figure
> re-creates the copy the rule exists to remove. Restating series numbers outside the
> canonical site is a counted defect class here: the v1.14.1 retro PR was blocked on 13
> findings of exactly that shape ([v1.14.2 §3](../retrospectives/v1.14.2.md)), and the
> v1.15.0 record found this page still carrying every one of them while a CHANGELOG entry
> claimed otherwise ([v1.15.0 §3](../retrospectives/v1.15.0.md), finding 5). What stays
> here is what exists nowhere else — the *reading* of that window: which PRs dominated the
> cost, what the rounds figure was actually made of, and what was changed in response.

What one three-release window actually cost, what moved, and why. Then the plan for the
targets set on the next one, and how it scored.

Window: **v1.13.0 → v1.14.0 → v1.14.1**, measured 2026-09-14.
**→ The numbers for this window, and every window since, are in
[the trend table](../retrospectives/README.md#the-trend-table).** Read them there; the
counting conventions that produce them are in the same file, and since v1.15.0 they are
executable (`scripts/retro_metrics.sh`).

> **Why the series exists.** A single release's numbers mean almost nothing: mean review
> rounds can halve because the team improved or because the work got easier, and one data
> point cannot tell you which. Only a series separates the two, and only if every release
> is counted the same way. That is the trend table's job. This page's job is the second
> half — *why* a column moved, which a table cannot say.

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

Mean rounds and rework share both moved the wrong way from v1.14.0 to v1.14.1 (the two
cells are in [the trend table](../retrospectives/README.md#the-trend-table)). Two
contributions, and they are not equally flattering.

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

### The cost columns were never a series — and were RETIRED at v1.15.0

Each release measured a different population: no capture at all, Project 3 fields
including an unshipped item, a live subagent-only capture, partial coverage. Six
releases, six meanings, which is not a series — so `Tokens`, `Tokens / merged PR` and
`Agent-time` were **formally retired** as trend columns after a fourth consecutive
failure of the clause that demanded they be filled. Historical cells stay as the record;
new rows read `retired`. The reasoning, and what replaced them (PR count, verdict count,
rounds, median files/PR, open→merge wall clock — all printed by
`scripts/retro_metrics.sh`), is in
[`docs/retrospectives/README.md` note 21](../retrospectives/README.md#the-trend-table).
The one release with an end-to-end capture published it as its own appendix, which is now
the sanctioned form: [v1.14.1's per-run table](../retrospectives/v1.14.1.md#appendix--per-run-effort-telemetry).

One measurement rule was learned the hard way and outlived the columns: **effort
telemetry is not recoverable after the fact.** When a release manager was asked to
reconstruct it, it correctly refused. It is captured during the cycle or it does not
exist.

---

## How these numbers are counted

**This page no longer restates the counting conventions.** They are the specification and
they have exactly one home:
[`docs/retrospectives/README.md` § How to count consistently](../retrospectives/README.md#how-to-count-consistently)
— the corpus bound, the heading-anchored filter, the replay at `mergedAt`, the widened
sweep, and the incident behind each. Since v1.15.0 they are also **executable**
(`scripts/retro_metrics.sh <prev-release-PR> <release-PR>`), which is the point: a figure
an executable produces can be re-derived by the next reader; one typed into a second
document cannot. A copy of the conventions here would be one more thing to keep in sync,
and this page is the evidence that it would not stay in sync.

**One correction this page originated, kept because it is about an issue rather than a
cell.** Issue #386 set the v1.14.2 KPI baseline from a mid-cycle count over a partial
corpus. The canonical window figures (in the trend table) are different, the baseline in
#386 was corrected against them, and a target measured against the wrong baseline is
worse than no target. #386 itself closed at v1.15.1 — resolved by the telemetry
retirement above rather than by a fifth attempt
([v1.15.0 §5](../retrospectives/v1.15.0.md), [v1.15.1 §1](../retrospectives/v1.15.1.md)).

---

## The plan for the KPIs

The targets set for v1.14.2 on issue **#386**. The baseline column they were measured
against is **not restated here** — read it in
[the trend table](../retrospectives/README.md#the-trend-table)'s v1.14.1 row, which is
where it is maintained.

| Dimension | v1.14.2 target |
|---|---|
| Mean review rounds / PR | ≤ 1.6 |
| Round-1 approvals | ≥ 50% |
| PRs merged with no verdict | **0** |
| Merges on a stale approval | **0** (hold) |
| PRs consuming ≥4 verdicts | ≤ 1 |
| Subagent tokens / merged PR | ≤ 120k *(dimension retired at v1.15.0)* |
| Review share of agent spend | ≤ 65% *(dimension retired at v1.15.0)* |
| Docs-only push wall-clock | ≤ 2 min |
| PR opened → first verdict | ≤ 30 min |
| Fake-greens reaching review | 0 |

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
    beside it as the control, and it fell sharply in this window.
  - A no-verdict or stale-approval count can hit zero because merges stopped passing
    through the gate. Provenance is measured first; unmeasured merges are reported as
    unmeasured.
  - *(A third falsifier was added at v1.15.1, by evidence this plan did not anticipate:
    **mean rounds can fall because the reviewer is the author.** A finding an author
    makes while re-reading their own diff becomes another commit before the verdict is
    posted, so it costs no round at all. Read every rate beside the
    `Non-independent verdicts` column — [v1.15.1 §4](../retrospectives/v1.15.1.md).)*

---

## Outcome (updated 2026-09-18 — links, not restated figures)

The plan above has since met every release that followed it (the count, like every other
figure, is read off [the trend table](../retrospectives/README.md#the-trend-table) rather
than maintained here — a counter in prose is a figure that rots on a one-release fuse).
The short version, each claim sourced where the numbers live:

- **The mechanisms shipped.** #377's scoped pre-push gate landed at v1.14.2 (a
  docs-only push measured in seconds — timings in the
  [v1.14.2 record](../retrospectives/v1.14.2.md)); #393's mutation contracts — the
  gap this page measured as "of the seven `scripts/*.test.sh` self-tests, none" —
  closed at v1.14.3 (#427), and the four hooks now all carry contracts in CI.
- **The process targets largely came good one release late**: v1.14.2 went backwards
  on the review targets amid its no-verdict-merge incident; v1.14.3 posted the best
  rounds figure since v1.14.0 at a rising median PR size, with all of its posted
  verdicts landing pre-merge — though one PR (#412) merged with none at all
  — scored clause by clause in [v1.14.2 §6/§8](../retrospectives/v1.14.2.md) and
  [v1.14.3 §7/§8](../retrospectives/v1.14.3.md).
- **The telemetry meta-target ("zero runs with unrecorded cost") failed four times
  running** — so "the first honestly comparable token figure" this page promised for
  v1.14.2 does not exist and never will. The v1.14.3 prediction made the clause binary,
  it failed a fourth time at v1.15.0, and the clause resolved as written: **the columns
  were retired and #386 closed on that resolution**, at v1.15.1
  ([v1.15.0 §5/§7](../retrospectives/v1.15.0.md),
  [README note 21](../retrospectives/README.md#the-trend-table)).
- **The falsifiers earned their keep, and kept earning it**: the "merges stopped passing
  through the gate" clause fired at v1.14.2 and again, once, at v1.14.3 (#412); at
  v1.15.0 the "reviewer is the author" confound appeared and is now a trend-table column
  rather than a footnote.
- **What the last three releases changed about the instrument, not the numbers**: the
  retro's figures became executable (`scripts/retro_metrics.sh`, v1.15.0); the release cut
  gained a queue gate and a previous-retrospective report (`bump_version.sh`, v1.15.0 and
  v1.15.1); the rule-13 verdict audit became order-aware with a named acknowledgement
  ledger (v1.15.1, #409); and a non-independent verdict must now disclose itself
  (CLAUDE.md rule 13, v1.15.0 — the rate is the `Non-independent verdicts` column of [the
  trend table](../retrospectives/README.md), not a figure repeated here).

## Links

[Team and process](team-and-process.md) · [`docs/retrospectives/`](../retrospectives/)
(per-release records, the trend table, and the counting conventions) · `CLAUDE.md` (the
operative rules) · Issues #386 (KPIs, closed at v1.15.1 by the telemetry retirement),
#377 (scoped pre-push gate, shipped), #393 (mutation contracts, shipped), #409
(verdict-audit ordering/cadence, shipped at v1.15.1).
