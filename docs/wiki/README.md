# `docs/wiki/` — wiki pages held in-repo until the wiki exists

Pages here are **destined for the repository wiki**
(`https://github.com/mavrovde/beaconfolio/wiki`) and live in the repo only because
the wiki git repository does not exist yet.

Measured 2026-09-07:

```bash
gh api repos/mavrovde/beaconfolio --jq .has_wiki        # -> true
git ls-remote https://github.com/mavrovde/beaconfolio.wiki.git
# -> remote: Repository not found.
```

The wiki is *enabled* but **uninitialized**: GitHub creates
`beaconfolio.wiki.git` only when the first page is created **through the web UI**.
That is an owner action that cannot be automated from here — hence this
directory.

## Moving a page to the wiki (owner action, then anyone)

1. **Owner:** open `https://github.com/mavrovde/beaconfolio/wiki` and click
   *Create the first page*. Any content will do; it is replaced in step 3.
2. `git clone https://github.com/mavrovde/beaconfolio.wiki.git` (now succeeds).
3. Copy the page in **verbatim**, named after its `#` title —
   `production-deployment.md` → `Production-deployment.md` (the wiki derives the
   page name from the filename; hyphens render as spaces).
4. Commit and push the wiki repo.
5. In this repository, replace the moved file with a one-line pointer to the wiki
   page and update the links in `docs/DEPLOYMENT.md`,
   `.claude/skills/ssh-deploy/SKILL.md` and the `CLAUDE.md` AI-config map, so no
   reader is sent to a stale copy. **Two live copies is the failure mode this
   step exists to prevent.**

## Pages

| File | Wiki page | Canonical for |
|---|---|---|
| `production-deployment.md` | *Production deployment* | Host lifecycle and multi-project layout: provisioning, OS hardening, the shared edge, the port registry, TLS issuance/renewal, backup/restore, incident response (#310). |
| `team-and-process.md` | *Team and process* | Team composition (one human owner + eight subagents), the issue→PR→review→merge→retro loop, the four-gate model and why enforcement is executable, the review gate and separation-of-duties problem, effort telemetry, the retrospective cycle. |
| `delivery-statistics.md` | *Delivery statistics* | Three-release series (v1.13.0 → v1.14.0 → v1.14.1) measured under the retrospective counting conventions: what moved, why it moved, the KPI targets for v1.14.2 and the mechanisms meant to hit them. Complements `docs/retrospectives/` (per-release record) with the cross-release read. |

`docs/DEPLOYMENT.md` remains canonical for the compose project runbook
(environment variables, image coordinates, rollout secrets, per-release operator
actions) and is **not** a wiki page.
