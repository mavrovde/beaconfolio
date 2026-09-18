---
description: Release retrospective — analyse the shipped release's issues, PRs, reviews and telemetry, then turn what happened into committed config changes
---

Run the release retrospective. Argument = the release tag just shipped (e.g. `v1.12.0`); with no
argument, use the newest tag. $ARGUMENTS

**Load the `release-retro` skill first** — it holds the method (the five questions, how to classify
a finding into an action, the enforcement order). This command is the runbook; the skill is the how.

This is a **mandatory step of the release process** (owner directive 2026-09-06, CLAUDE.md rule 8):
`release-manager` does not report a release complete until this has run and its PR is open.

## 1. Delimit the window

```bash
PREV=$(git tag --sort=-v:refname | sed -n '2p')     # the tag before this one
git log --oneline "$PREV..$TAG" | cat                # what shipped
# BOUND THE LISTING SERVER-SIDE. `gh pr list --limit N` returns merged PRs in
# DEFAULT order, which is not merge order, so a bare --limit takes an arbitrary
# prefix and a client-side mergedAt filter then runs over a set that need not
# contain the window — measured on this repo at PR #452: the v1.12.0 window
# returned 7 of its 10 PRs at --limit 100, silently.
gh pr list --repo mavrovde/beaconfolio --state merged --limit 200 \
  --search "merged:>=$(git log -1 --format=%cs "$PREV")" \
  --json number,title,labels,mergedAt,url
```

Keep only PRs merged inside the window. Note which issues they closed. **The corpus of
record is the one `scripts/retro_metrics.sh` prints in step 2** — it applies the exact
instants and carries a truncation guard; this listing is for labels and titles.

## 2. Gather the evidence (do NOT skip to conclusions)

**First, the numbers — run the instrument, don't hand-count:**

```bash
scripts/retro_metrics.sh <prev-release-PR> <release-PR-number>   # e.g. 436 441
# a tag still works and still bounds on the tag COMMIT date (`ref:v1.14.3 436`),
# which re-admits the previous release's own PR — prefer the PR form.
```

It prints the corpus, median files/PR, canonical verdicts (heading-anchored AND replayed at
`mergedAt`), mean rounds, round-1 approvals and rework share, with the bounding rules from
`docs/retrospectives/README.md` encoded rather than re-remembered. Eyeball the corpus it prints
against `git log --oneline <prev-tag>..HEAD` before using a single figure — the two known
asymmetries (a PR whose merge commit IS the previous tag; a PR merged between the tagged commit
and the tag's creation) are the only things it cannot decide for you. Everything it prints is
quotable in the record; anything it does not print — class counts, severities, AC analysis — is
still read by hand from the threads.

For every PR in the window:

```bash
gh pr view <n> --repo mavrovde/beaconfolio --json title,body,reviews,labels \
  --jq '{title, body, labels:[.labels[].name], reviews:[.reviews[].body]}'
```

For every closed issue: its body (acceptance criteria) and its close-the-loop comment.
From **GitHub Project 3**: `Review rounds`, `Agent`, `Model` per item — and say plainly how many
items carry each. **`Tokens (k)` and `Time of processing (min)` were RETIRED from the trend table
at v1.15.0** after four consecutive releases in which they were unrecorded, partial, or estimated;
do not reinstate a column by summing a gap (see `docs/retrospectives/README.md` note 21). If a
cycle DOES capture per-run effort end-to-end, publish it as that release's own appendix — the way
v1.14.1 did — not as a series column.

The review bodies are the richest signal in the repository. Read them, not their summaries.

## 3. Answer the five questions (see the skill)

1. **Acceptance criteria** — unachievable ones, silently-skipped ones, `Closes` with an unmet AC.
2. **Issue quality** — was the grounding real and still accurate; did the implementer re-research?
3. **Code quality** — cluster review blockers by CLASS; a class appearing 3× is a charter bug.
4. **Review actions** — what did reviewers catch that authors missed, and what repeated?
5. **Cost** — tokens, wall time, rounds; the share spent on rework; model mix.

Report numbers and quotes. "Report what you measured, not what you expect" (rule 7) applies to the
retrospective itself.

## 4. Decide the changes

Enforcement order: **hook > skill > charter > CLAUDE.md > command**. For each finding, name the
single cheapest change that prevents recurrence, and say which evidence motivated it. Prune as
readily as you add. If a gap has no owner, propose a **new role** — with the recurrence evidence,
not a hunch.

## 5. Deliver

- **Write `docs/retrospectives/vX.Y.Z.md`** — the permanent record, five sections in the standard
  order, committed with the config changes. Update the trend table in
  `docs/retrospectives/README.md` (PRs merged, verdicts, mean rounds, round-1 approvals, rework
  share, blocker counts, tokens, agent-time) and check the counting conventions documented there.
- Post the retrospective on the roadmap issue (#265) as the announcement, linking to that file.
- Open a PR with the config changes, labelled `ai-config` + a priority, reviewed under rule 13.
- Record a **prediction**: the observable you expect to move, so the next retro can check it.
- Update the CLAUDE.md AI-config map in the same PR if the tooling surface changed.

## 6. Close the loop on the previous prediction

Before finishing, check the PREVIOUS retro's prediction against this release's numbers and say
whether it held. A prediction nobody checks is decoration.

## Delegation

`ai-integration` owns this work — it can be run directly with the Agent tool for the analysis and
the config edits. Keep the review independent: `pr-reviewer` reviews the resulting PR, never the
agent that wrote it.
