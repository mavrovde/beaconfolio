---
name: release-retro
description: >-
  The release retrospective — how to analyse a shipped release (its issues, PRs, review
  threads and effort telemetry) and turn what actually happened into edits to the committed
  AI configuration. Use it at every release, right after the tag, and whenever a post-mortem
  is called for. Encodes what to measure (acceptance-criteria quality, issue grounding, code
  defect classes, review-catch patterns, cost and rounds), how to classify a finding into an
  action, and the hard rule that a retro producing no config change must say why.
---

# Release retrospective

A release is not finished when the tag is pushed. It is finished when what the release *taught*
is written into the configuration that governs the next one. Otherwise every release pays for
the same lessons again — and this repo has receipts for that: the same reviewer caught the same
class of defect (a claim asserted rather than measured) in four consecutive PRs before it became
a rule.

**Owner directive (2026-09-06):** the retrospective is part of the release process, not an
optional extra. `release-manager` does not report a release complete without it.

## Inputs — gather before analysing

**Run `scripts/retro_metrics.sh <prev-tag> <release-PR>` FIRST.** It is the instrument for every
headline figure this document asks for — corpus, median files/PR, canonical verdicts, mean rounds,
round-1 approvals, rework share — with the three bounding rules that have each cost a release
already baked in (bound on the release PR's `mergedAt`; normalise to UTC; replay every verdict at
`mergedAt`). Paste its output into the working notes and quote it; **do not re-derive the jq by
hand.** Five consecutive retrospectives have found "a claim asserted rather than measured" as the
top or joint-top defect class, and the instances are overwhelmingly hand-counted figures **in these
very documents** — #430's blocker was a published "series' best rounds figure" that was false,
#429's two majors were a wall-clock that did not reproduce and a headline verdict count produced by
an undocumented filter. A figure an executable produces can be re-derived by the next reader; one
you typed cannot.

The script deliberately decides nothing and cannot see everything — the class counts, the AC
analysis and the severity populations are still read by hand from the threads below, and it cannot
distinguish an independent verdict from a self-review (same GitHub identity; see rule 13's
disclosure requirement). Everything else here is evidence, not opinion. Collect it first, then
reason.

```bash
# The release's issues and PRs.
# `--limit` as well as `--search`: gh's DEFAULT page is 30, and windows in this series
# have reached 18 merged PRs — the bound and the page size are two different guards, and
# only one of them was here before #452 round 2.
gh pr list --repo mavrovde/beaconfolio --state merged --limit 400 \
  --search "merged:>=<prev-tag-date>" \
  --json number,title,labels,mergedAt,reviews
gh issue list --repo mavrovde/beaconfolio --state closed --limit 400 \
  --search "closed:>=<prev-tag-date>" \
  --json number,title,body,comments

# Every review verdict in the window — the richest signal in the repo.
# BOTH streams: this repo's sanctioned verdict is often a COMMENT, because
# same-identity `gh pr review --approve` is blocked (env-gotchas). Reading
# `reviews` alone silently loses those — the same bug the merge gate's jq had.
gh pr view <n> --repo mavrovde/beaconfolio --json reviews,comments \
  --jq '[(.reviews[]?.body),(.comments[]?.body)][]'

# Effort telemetry (recorded at close-the-loop; not retrievable later)
# GitHub Project 3: Tokens (k), Time of processing (min), Review rounds, Agent, Model
gh project item-list 3 --owner mavrovde --limit 200 --format json
```

**If a telemetry field is empty, SAY IT IS EMPTY.** At v1.13.0 `Tokens (k)` and
`Time of processing (min)` were unset for every item in the repository and `Review rounds` for every
issue the release shipped; the previous retro's token/time figures were console session estimates.
Publishing an estimate in a column headed "Tokens" makes the series a fiction — the very defect these
retros keep finding in PR bodies. Label estimates as estimates, and prefer the proxies GitHub
actually holds and that anyone can re-derive: PR count, verdict count, rounds, `changedFiles`
(median PR size), and open→merge wall clock:

```bash
# BOUNDED AND GUARDED, like the listing at the top of this file — this line was a bare
# `--limit 100` in default order until #452 round 2, which is §79's "second instance in
# the same file" in the file that TEACHES the method. `gh pr list` does not list in merge
# order, so a bare limit hands you an arbitrary prefix.
# The date is rendered in UTC: `%cs`/`%aI` use the COMMIT's own offset (note 11) — on
# 5012056c (00:09:14+02:00) `%cs` says 2026-09-19, a day late, dropping 22:09Z..24:00Z.
PREV=$(TZ=UTC git log -1 --format=%cd --date=format-local:%Y-%m-%d <prev-tag>)
LIM=400
PRS=$(gh pr list --state merged --limit $LIM --search "merged:>=$PREV" \
        --json number,createdAt,mergedAt,changedFiles)
[ "$(printf '%s' "$PRS" | jq length)" -lt $LIM ] \
  || echo "TRUNCATED at $LIM — raise it; these figures cannot be measured"
printf '%s' "$PRS" \
  | jq -r '.[] | [.number, .changedFiles, (((.mergedAt|fromdate)-(.createdAt|fromdate))/60|floor)] | @tsv'
```

**Count verdicts with the shared grammar, not a regex you write here.** `scripts/retro_metrics.sh`
reads `scripts/verdict-heading-lib.sh`, the same definition the merge gate and the no-verdict audit
use. Two shapes it exists to exclude, both measured: a marker anywhere in the BODY matches the
author's fix reports (11 vs 8 on #291), and a marker anywhere in the FIRST LINE matches the author's
delta requests (#458 counted as a 5th round until v1.16.0). The instrument prints
`non-verdict bodies skipped: N` — quote it, because a round count that silently drops is the same
defect wearing the other polarity. Rounds published before v1.16.0 were measured with the loose
first-line filter; say so rather than re-deriving old rows.

**…and replay the thread at `mergedAt` before counting anything.** A countable verdict must
satisfy **both** halves: the marker opens the body (position is not authorship) **and** it was
posted **before the merge**. At v1.14.2 six verdicts were back-filled after their PRs merged —
`APPROVE — retrospective review (round 1)`, all six inside 19 seconds — and the naive filter
turned a true **0 of 14** round-1 approvals into a reported **36%**. A retrospective verdict is an
honest fix-forward record and it is *not* a gate; a metric that cannot tell them apart will report
a release as reviewed when it was not. The same replay is what `audit_no_verdict_merges.sh`
currently lacks (#409).

**Bound the corpus on the release PR's `mergedAt`, not on the tag commit's date.** At v1.14.2 the
tag commit read `19:46:02Z` and its own release PR merged at `19:46:03Z`, so the obvious
`mergedAt <= <tag date>` query dropped #406 from its own release. (v1.14.1 hit the same trap from
the other side — one PR too many.) Always print the corpus and eyeball it against
`git log <prev>..<tag>` before computing a single figure.

## The five questions

Answer each with numbers and quotes, never impressions.

### 1. Acceptance criteria — were they checkable, and were they checked?
- Did any AC turn out **unachievable** as written? (v1.12.0: #277's "mutation-pin the refresh
  idiom" — the two forms are observably equivalent, so no test can distinguish them.)
- Did any AC get **silently skipped** and only surface in review? (#279's frontend latch was
  absent from the first implementation entirely.)
- Did a PR claim `Closes #NN` while an AC was unmet? That is a rule-7 violation and a signal
  that the AC was written to be closed rather than to be true.
- **Action shape:** if ACs are being written unachievably, the fix belongs in `issue-author`'s
  charter (how to write a verifiable criterion) — not in a reminder to try harder.

### 2. Issue quality — did the implementer have to re-research?
- Were `path:line` citations present and still accurate at implementation time?
- Did the issue survive contact with the code, or did the diagnosis change on first read?
- **Action shape:** grounding failures → `issue-author`; stale-by-the-time-you-start failures →
  a note about re-verifying citations, in the dev charters.

### 3. Code quality — what classes of defect reached review?
Cluster the review blockers by CLASS, not by count. Three PRs blocked for the same reason is a
charter bug; three unrelated blockers are normal engineering. v1.12.0's classes were:
- **check-then-insert races** (an application-level guard where only a DB constraint holds),
- **fake-green tests** (a mock that never intercepted; an assertion that could not fail),
- **claims asserted rather than measured** (a "no-op" migration path that wasn't, a grep result
  overstated twice),
- **content lost in a rebase** and not re-verified after conflict resolution.
- **Action shape:** a class that a *gate could catch* becomes a hook or lint; a class that needs
  judgement becomes a charter paragraph with the incident named.

### 4. Review actions — what did reviewers catch that authors missed?
This is the highest-value section, because every reviewer catch is a defect the authoring agent
should have caught first.
- Which catches **repeated** across PRs? Those belong in the author-side charter.
- Did reviewers verify by **running** things, or by reading? (The former is what caught the racy
  promote, the vacuous viewport assertion and the duplicate constraint.)
- Did any review round produce **zero** findings? Rounds that find nothing may mean the gate is
  working — or that the reviewer scope was too narrow.
- **Action shape:** a repeated catch → the dev charters gain the check the reviewer performs.

### 5. Cost — where did the tokens and rounds go?
- Tokens and wall time per delivery, and the **share spent on rework** (rounds 2+).
- Rounds per PR: rising average means an instruction is missing.
- Model mix per item, once recorded — cost per delivered issue by model.
- **Action shape:** rework share is the number to drive down; name the single change most likely
  to move it and record the prediction so the NEXT retro can check it.
- **Before calling rounds "churn", check whether any round found NOTHING.** v1.13.0's mean rose
  2.4 → 3.13 while **zero** of its 33 negative verdicts came back empty — every one
  reproduced a defect. Rounds that all find real blockers are the gate working on harder material,
  and the right target is then "the same defect, one layer earlier" (a lint, a stated observable),
  not "fewer rounds". Check the material too: v1.13.0's features were credential-, billing- and
  container-config-shaped, and produced 9 blockers in classes v1.12.0 barely had.

## Turning findings into changes

Use the enforcement order from the `ai-integration` charter — **hook > skill > charter >
CLAUDE.md > command** — and prefer the cheapest thing that actually prevents recurrence:

| What you observed | What to change |
|---|---|
| A gate could have caught it mechanically | a hook or a lint, with a failing-first case in its `*.test.sh` |
| Reusable knowledge, needed on demand | a `lessons-learned` entry — with the incident, so a future reader can judge whether it still applies |
| One role keeps making one mistake | that agent's charter |
| A project-wide expectation was never written down | a CLAUDE.md rule (and renumber references — grep for every variant, including hyphen and en-dash forms) |
| A repeatable procedure | a command |
| **No existing role owns the work** | propose a NEW agent, with the evidence that the gap is real and recurring — not speculative |

**Deletions count.** An instruction nobody follows, or that fires on the wrong trigger, makes the
configuration worse: it dilutes what matters and costs tokens on every load. Say what you removed.

## A release figure is written ONCE — every other document links to it

**This is the highest-value rule in this skill, and it was learned the expensive way.** The
v1.14.1 retrospective published the same figures into **four** places — `v1.14.1.md`,
`docs/retrospectives/README.md`'s trend table, `docs/wiki/team-and-process.md` and
`docs/wiki/delivery-statistics.md`. Its PR (#389) was blocked on **13 class-F blockers in round
one**, every one a published number contradicted by measurement, and the reviewer's first finding
names the mechanism exactly:

> *"The cost figures disagree with themselves across three files in this PR. Same window, same
> instrument, **four readings**."*

Rounds 2 and 3 existed only because each correction had to land in four files and landed in three
(*"`delivery-statistics.md:92-94` — still **two** guarded commands"*). **18 of v1.14.2's 22
class-F findings are this one PR.** Four copies of a number are four chances to be wrong and one
chance to be right.

So:

- **Canonical:** `docs/retrospectives/vX.Y.Z.md` (this release's figures) and
  `docs/retrospectives/README.md`'s trend table (the series). Nothing else.
- **Everywhere else — wiki articles, charters, `CLAUDE.md`, issue bodies — LINK.** Write
  "see [the v1.14.2 retrospective](…)", not the number. If a narrative genuinely needs a figure
  inline, quote **one** and link it in the same sentence, so a reader can tell instantly whether
  it is current.
- **Do not "refresh" a restated figure you find in another document — delete it and link.**
  Updating it re-creates the copy you are trying to remove.
- A correction is applied **once**, at the canonical site. If you find yourself running the same
  `sed` across three files, stop: that is the defect, not the fix.

## Output

1. **The permanent record: `docs/retrospectives/vX.Y.Z.md`**, committed in the same PR as the
   config changes, with the five sections in the same order every time so the numbers line up as a
   series. Then update the trend table in `docs/retrospectives/README.md` — an analysis that lives
   only in a GitHub comment can be read once but never trended, and trending is the point.
2. **A retrospective comment on the roadmap issue** pointing at that file — the announcement, not
   the record.
3. **A PR** carrying the config changes, labelled `ai-config`, reviewed like any other (rule 13 has
   no carve-out for configuration).
4. **A prediction**: name the observable you expect to move (e.g. "review rounds on frontend PRs
   below 2.0") so the next retro can check it rather than re-deciding.

## The hard rule

**A retrospective that produces no configuration change must say why** — in writing, on the issue.
"Nothing came up" is almost never true after a release with review rounds in it; it usually means
the analysis stopped at the summary instead of reading the review threads. If the release genuinely
taught nothing new, say that explicitly and name what you checked.
