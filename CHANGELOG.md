# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **The no-verdict merge path is closed at both ends (#392, v1.14.1 retro change B)** — #321 and
  #355 merged with zero verdicts in consecutive releases; mechanism established for the record:
  both merged in the GitHub **web UI** (a Dependabot PR and the security-tab "set up this
  workflow" flow), where a `PreToolUse` hook does not exist. The CLI half: `pre-merge-gate.sh`'s
  `PR_MERGE_GATE=0` bypass is still allowed but **never invisible** — it appends a line to a local
  audit log (`PR_MERGE_GATE_LOG`) and best-effort posts a `## ⚠️ MERGE-GATE BYPASS` comment on the
  PR, fire-and-forget so an offline `gh` cannot block an authorized merge; both traces are pinned
  by new self-test cases and a 23rd gate mutation. The web-UI half:
  `scripts/audit_no_verdict_merges.sh` + the scheduled **Verdict Audit** workflow, red-when-dirty
  (the Live-Freshness alarm shape) for merges after the 2026-09-14 cutover, self-testing its own
  detector first (7 cases, mutations 4/0/0 — including "the first-line filter widens to the whole
  body", the exact hole that would count a fix report as a verdict). First live run named exactly
  #321 and #355 and nothing else. Measurement convention recorded in
  `docs/retrospectives/README.md`.
- **`scripts/check_changelog_merge.sh` — the `[Unreleased]` collision becomes a lint (#391,
  v1.14.1 retro change A)** — validates the **merged result** of HEAD with `origin/main`, formed
  with `git merge-tree` (the machinery `gh pr merge` actually runs — measured: replaying #357's
  original pre-rebase head, `merge-file` reports a conflict while `merge-tree` auto-merges cleanly
  and produces the duplicate `### Added` x2 the reviewer found). Four checks: exactly one
  `## [Unreleased]`; no duplicate `### ` heading inside it (fence-aware); **no released heading
  present on `origin/main` but absent from the merge** — the #365 case, where a merge deleted
  `## [1.14.0]` and a heading-count check passed; no `[Unreleased]` line lost (set semantics, so
  the dedup fixer's reorders pass). A conflicting merge fails with rebase-first. Both historical
  replays reproduce through the script itself: #365's pre-fix head red on checks 2+3, #357's
  recovered original head red on check 2, both post-fix heads green. Wired as the pre-push
  `changelog` leg (selected by any `CHANGELOG.md` diff — the one doc whose defect lives in the
  merged result) and into CI beside the migration lint; self-test 15 cases with a
  **message-anchored mutation contract, 5 killed / 0 survived / 0 invalid** — rc-only assertions
  let overlapping checks mask a neutered one, which the first harness draft measured first-hand.
- **v1.14.1 release retrospective + the cross-release read (#386)** — `docs/retrospectives/v1.14.1.md`
  records the release under the counting conventions, and the trend table gains its row.
  Measured: **17 PRs, 41 canonical verdicts, 2.41 mean rounds, 29% round-1 approvals (best in the
  series), median 8 files/PR**.
  - **Merges on a stale approval fell 4-of-10 → 0-of-16** — `pre-merge-gate.sh` working. Reported
    with its limit: merge provenance is *unmeasurable* here (all 17 merges share one identity), so
    the defensible claim is "no merge that reached the gate carried an uncovered commit".
  - **The dominant defect is the merged result nothing validates — classes B ∪ C, 8 of 16 reviewed
    PRs, half of everything reviewed**, and **4 of the 7 `[Unreleased]`-collision PRs are also
    stale-base PRs**: the collision is
    the stale base landing in `CHANGELOG.md`. #365 is the worst variant — the merge **deleted the
    released `## [1.14.0]` heading**. The tool and the `/prep-pr` step already existed; the gap is
    enforcement level, so the retro's main action moves the check from a command to a lint measured
    against the merged result (filed as #391, with #392 and #393 for the other two).
  - **Corrects the KPI baseline published on #386** across all three cells: "2 of 13 (15%)",
    "33 rounds / 13 PRs" and "~191k tokens/PR" were counted mid-assembly over a partial corpus.
    Canonical is **5 of 17 (29%)**, **41/17 = 2.41** and **~153k** (2,600,168 ÷ 17).
  - **The per-run effort telemetry is now committed** as an appendix to the retro. It was held in a
    machine-local scratch file, so none of the cost figures was re-derivable by a reader — rule 7
    applies to the retrospective's own numbers too.
  - **Scores its own prediction honestly, including the cell that flipped.** Class F ("claim not
    measured") was drafted as **2 ✅** and re-derived at blocker-or-major level as **5 ❌**. Class B's
    published list is also corrected: `CLAUDE.md` records a *different* five, measured under a looser
    predicate, and #373 was in neither class — its base was `0 behind main, CLEAN`.
- **Lessons §60 + `pr-reviewer` charter — a "read-only" agent that runs `git checkout` mutates the
  shared working tree.** During #389's round-3 review the reviewer ran `git checkout <sha>` in the
  main tree to trace how a table changed across commits, and left HEAD detached. The next fix
  commit landed on **no branch**; `git push` failed with `git push origin HEAD:<name-of-remote-branch>`,
  which reads like a usage hint and actually means the commit is orphaned. Recovered losslessly
  (`git checkout <branch> && git merge --ff-only <sha>`) only because the orphan's parent happened
  to be the branch tip. The charter's "no Edit/Write tools by design" bounded the wrong surface:
  `git checkout` is neither Edit nor Write and is the most state-mutating command in the repo.
  Review-only now means **read-only to repository state**, with `git show <sha>:<path>` /
  `git diff a..b` / `git log -p` named as the replacements, and a `git status -sb` check before any
  commit in a long session.
- **Lessons §58b correction (#390 review follow-up)** — the entry said "the `rstrip` and CRLF
  mutants survived"; there was no CRLF *mutant* at that head. The two that survived at 26/0 were
  `rstrip` (a fixture hole) and drop-the-final-newline (the one real assertion hole), and the CR
  defect was a **live defect found by byte probing**, not by mutation. Folded in here rather than
  spent as its own review round, on the reviewer's explicit advice. The corrected text carries a
  stronger warning: mutation only tests the failures you already thought of.
- **Two wiki articles (`docs/wiki/`)** — *Team and process*, how a one-human/eight-agent team ships
  and why nearly every rule here is executable rather than written down; and *Delivery statistics*,
  the v1.13.0 → v1.14.0 → v1.14.1 series with the v1.14.2 KPI plan and its falsifiers.
  Discussion #387 opens both for comment.

### Changed
- **The pre-push gate now runs only the legs the DIFF can break (#377)** — it ran the entire round
  on every push regardless of what changed, so a two-file documentation commit paid
  **11m44s** for backend pytest, ruff, mypy, three Vitest projects and ~12 script/hook
  self-tests. Measured on this machine, same tree, same suites:

  | push | before | after |
  |---|---|---|
  | docs-only (`README.md` + `CHANGELOG.md`) | 11m44s | **13s** |
  | backend-only (one file under `backend/app/`) | 11m44s | **1m21s** |
  | `projects/public/**` only | 11m44s | **15s** |
  | protected branch / unmapped path | 11m44s | 11m11s (unchanged by design) |

  Legs come from `git diff --name-only @{push}..HEAD` (falling back to `@{upstream}`, then to
  merge-base(`origin/main`)) through the new `.claude/hooks/prepush-select-lib.sh`. Frontend
  selection is **per Vitest project** — `projects/public/**` never runs `admin`, while
  `projects/shared/**` runs all three because both apps consume it — and a change to
  `hook-parse-lib.sh` runs all four hook self-tests, since they share that parsing model.
  - **The polarity is the whole design, not a footnote.** Narrowing a gate is the one change that
    can succeed at being fast while quietly ceasing to protect anything, so every ambiguity
    resolves towards running MORE: the map's default arm is `ALL`, and so are an empty diff, a
    range that cannot be computed, a detached HEAD, a root that is not a repository, `main`,
    `master`, any `release/*`, `PREPUSH_FULL=1`, a refspec targeting a protected branch, and
    `--all`/`--mirror`/`--tags`. The PII/de-brand guard is never selectable away.
  - **Cross-cutting contracts are mapped explicitly**, because a per-directory map would miss them:
    the six version carriers outside `docs/` (`backend/app/main.py`, `frontend/package.json`,
    `frontend/package-lock.json`, `frontend/projects/shared/package.json`,
    `frontend/projects/public/src/app/version.ts`, `docker-compose.prod.yml`) each select the
    version-consistency leg, and `backend/app/config.py` / `README.md` / `docs/DEPLOYMENT.md` /
    `setup.sh` each select the documented-knob contract they feed (#296/#297/#298).
  - **Proved able to fail.** `pre-push-tests.test.sh` now runs **122 cases** in two layers —
    the mapping driven directly, and the whole hook driven end-to-end against throwaway git
    repositories so the `@{push}`/`@{upstream}`/merge-base resolution is exercised rather than
    mocked — plus a `--mutations` contract that neuters one selection rule at a time, including
    "the selector returns an empty selection". Result: **24 killed, 0 survived,
    0 invalid**. Without it, a selector that silently selected nothing would pass every
    "X must not be selected" case in the file.
  - **Renames select BOTH endpoints.** `git diff --name-only` with git's default rename
    detection reports only the DESTINATION, so `git mv frontend/projects/admin/…/foo.ts
    frontend/projects/public/…/foo.ts` would have selected the public legs and never run
    `admin` — the project that just lost a module its specs import — and the behaviour was
    `diff.renames`-config dependent, so two developers got different coverage from one diff.
    The selector passes `--no-renames`; two end-to-end cases and a mutation pin it.
  - **Protected-branch detection is structural, not a substring probe.** `git push origin
    +main` (the `+` sits where the probe wanted a space) and `git push origin
    HEAD:refs/heads/main` (ends `/main`, not `:main`) are pushes to the prod-deploy trigger
    that used to receive a SCOPED gate. Each word is now parsed as a refspec — destination
    half, leading `+` and `refs/heads/` stripped — while a branch merely NAMED
    `feature-main-nav` still scopes.
  - **Headroom for the full round.** The reviewer measured `pre-merge-gate.test.sh --mutations`
    at **543s alone** under load (2.37), with the hook legs subtotalling 646s *before*
    pytest/Vitest/lints — so the 671s full round is an idle-machine number and a `main` push, the
    case that always forces `ALL`, sat close to the 900s `PreToolUse` timeout. A timed-out hook
    does **not** deny, so overrun there is a fail-OPEN gate, not a slow one. The hook's timeout in
    `.claude/settings.json` is raised to **1800s**; the other three hooks are unchanged (15s/30s).
  - **The mutation contract runs when a hook actually changed, not in every full round.** It
    costs ~100s and putting it everywhere took the full round 704s → **808s** against the hook's
    900s `PreToolUse` timeout — and a timed-out hook does not deny, so proving the narrowing
    sound would have bought a fail-OPEN. A full round now runs the plain cases exactly as before
    (measured 671s); a push that NAMES `.claude/hooks/**` additionally runs `--mutations`.
  - **`bandit` joins the backend lint leg**, matching `deploy.yml` exactly; it was the one CI
    backend check this gate never mirrored.
  - **CI is untouched**: `deploy.yml` still runs every leg on every push.
- **The merge gate's post-network deadline case is deterministic (#377)** — `pre-merge-gate.sh`
  gained `PR_MERGE_GATE_PARSE_DEADLINE`, defaulting to `PR_MERGE_GATE_DEADLINE`, so production
  behaviour is unchanged. The self-test can now hold the parse phase open while the stubbed `gh`
  outruns the post-network budget; previously both phases shared one knob and the case denied from
  whichever fired first — it failed inside the loaded pre-push gate and passed 100/0 when run alone.

### Fixed
- **`dedup_changelog_unreleased.py` no longer rewrites released history (#383)** — the blank-line
  collapse ran over the whole reconstructed file, including the tail below the first
  `## [x.y.z]` heading that the script's own docstring promised never to touch. It silently removed
  blank lines inside shipped release notes (visible in #371's own diff). Cosmetic in prose, but a
  released section containing a fenced code block would have had its internal blank lines collapsed
  too — a content change, in the file of record. The collapse now runs over the rebuilt
  `[Unreleased]` block alone and the tail is concatenated untouched.
  - The docstring's **strong** guarantee is restored ("byte-for-byte below the first released
    heading"). #371 had weakened the promise to match the bug; that is the documentation equivalent
    of the silent-deletion mistake lessons §58 was written about — a tool that rewrites a file of
    record must fail by doing LESS, never by dropping silently.
  - **A second bug had to be fixed before "byte-for-byte" was true** (#390 review): `open()` did
    universal-newline translation, so CRLF and lone-CR line endings were rewritten to LF and the
    write-back made it permanent — and a lone `\r` inside a released entry is a **content** change,
    not whitespace. Both opens now pass `newline=""`.
  - **The first assertion could not see any of this.** `tail="$(sed -n ...)"` strips trailing
    newlines and is line-oriented, so trailing whitespace, a missing final newline and CR bytes were
    structurally invisible; two mutants survived it at a green 26/0. The case now extracts the tail
    as raw bytes and uses `cmp`.
  - **The byte-extraction helper itself had a silent-pass path** (#390 review, round 2): it
    hardcoded the fixture's release heading and wrote a `<MISSING>` sentinel when it found none, so
    a renamed heading made both snapshots the same sentinel and `cmp` compared nothing while
    printing a green tick — measured at 28/0 with the #383 bug reintroduced. It now finds the first
    released heading by pattern and exits non-zero if there is none. A helper that silently passes
    is the exact defect class this file exists to detect.
  - **…and the fix to that had the same shape again.** `cut_tail`'s non-zero exit does not
    propagate (the call sites ignore it, and the file runs without `set -e`), so a failed
    extraction left two EMPTY snapshots — and `cmp -s` calls two empty files equal. Both compare
    sites now require `[ -s ]` on each snapshot, and report an empty snapshot as an **extraction**
    failure rather than a rewrite — `cmp` prints nothing for two empty files, so the old detail was
    blank and pointed at the wrong file. **Three instances of one class in a single PR**, recorded
    as lessons **§58b**: a verifier's failure mode is to pass, so every layer added to one needs its
    own proof — and, measured during review, **the hole is as often in the FIXTURE as in the
    assertion** (`$(...)` strips only trailing newlines, so trailing spaces and CR bytes *were*
    visible). Of the two mutants that survived at 26/0, `rstrip` was a fixture hole and
    drop-the-final-newline the one real assertion hole; the CR defect was never a mutant at all but
    a live defect found by byte probing — mutation only tests the failures you already thought of.
  - Proven, not asserted: self-test **28 passed / 0 failed**, and **four** mutants each make it go
    red — whole-file collapse (27/1), `rstrip` over the tail (26/2), dropping the final newline
    (25/3), and reverting `newline=""` (26/2). Against the repo's real `CHANGELOG.md`, `diff` of
    everything from `## [1.` down is **empty**; 28 release headings and 235 entries unchanged.

## [1.14.1] - 2026-09-14

### Added
- **The CLAUDE.md AI-config map is now enforced, not just written (#246)** —
  `scripts/check_aiconfig_map.sh` compares the map against the filesystem and
  `.claude/settings.json`: every agent/command/skill/hook/lint on disk must have a row, every row
  must name a file that exists, every **enabled** plugin must appear in the plugin row *and* carry a
  rationale line (and vice versa — a listed-but-disabled plugin fails), and prose counts
  ("all eight —") must match the table. Dependency-free bash, wired into the pre-push docs leg, the
  CI Version Consistency job and `verify_all.sh`.
  - It found real drift on its first run against `main`: **8 command rows carried a leading `/`**
    that no lookup matched, and the plugin cross-check flagged two names the purpose column
    mentions as *dropped*. Both are now handled precisely rather than approximately.
  - `check_aiconfig_map.test.sh` proves it can fail: **12 cases, all failing-first** — an
    undocumented agent/command/hook/skill, a row naming a deleted file, a deleted lint script, an
    enabled-but-unlisted plugin, a listed-but-disabled plugin, a missing rationale, and a stale
    prose count; plus a control that an agreeing map passes and a case pinning that **one shared
    rationale line counts for both plugins** it names.
- **Self-test for the live-freshness verdict script, wired into pre-push + CI (#280)** —
  `scripts/check_live_freshness.test.sh` drives all five states (fresh, version-stale,
  admin-route-stale, down, mixed-down+stale) with stubbed curl/jq, asserting exit code AND verdict
  line; the mixed state pins the staleness-beats-outage precedence (#254) and fails against a
  regressed `*)` branch. Runs in the pre-push docs leg and the CI Version Consistency job.
- **v1.14.0 release retrospective, and the gates it produced (#328)** — the cycle's evidence turned
  into committed configuration, archived as `docs/retrospectives/v1.14.0.md` with the trend row in
  that directory's README:
  - **`scripts/check_migration_heads.sh` + self-test** — exactly ONE Alembic head, measured on the
    working tree **unioned with a git ref** (`--against origin/main`). Dependency-free (no alembic
    import, no database, no Python), wired into the pre-push gate and CI's Version Consistency job.
    #323 and #325 both chained onto `trans0009`; each branch was single-head in isolation, so every
    gate on both was green, and `alembic upgrade head` — which `docker-entrypoint.sh` runs on every
    container start — refuses to run on the merged result. The self-test replays that exact incident
    from this repo's history: **26 cases** pass locally (23 in CI, where a depth-1 clone cannot
    resolve the historical commits — a `MIN_CASES` floor keeps that note enforceable), and three
    mutations turn **9 / 6 / 1** of them red.
  - **`.claude/hooks/guard-stack-resources.sh` + self-test** — a free-disk floor
    (`DOCKER_DISK_FLOOR_GB`, default 5) and ONE Docker compose project, checked before
    `up`/`build`/`run`/`pull` only; `down`/`ps`/`logs`/`exec`/`builder prune` are never blocked,
    because those are what you run to recover from a full disk. Three parallel stacks filled the disk
    and crashed the daemon this cycle, costing ~2 hours. **44 cases, 11 mutations killed, 0
    survived.** The documented `DOCKER_STACK_GUARD=0` bypass is read from the COMMAND TEXT per
    segment, like both sibling hooks — the first version read only the hook's own environment, which
    nothing in this harness sets, so the printed remedy was a deny loop with no exit.
- **Snyk adopted for code, dependencies and the four published images (#358)** — three scan
  surfaces now feed the Security tab: **Snyk Code** (SAST), **Snyk Open Source** (both dependency
  trees — the npm lockfile and the backend requirements via a scan-only venv) and **Snyk Container**
  (a matrix over `beaconfolio-{backend,frontend,admin-frontend,proxy}`, replacing the stock
  template's `your/image-to-test` placeholder). Each uploads SARIF under its own `category`, so
  Snyk, Bandit and CodeQL results coexist instead of displacing one another.
  - The token is scan-quota only and **never reaches a test or E2E stack** (rule 10, stated in the
    workflow); a missing `SNYK_TOKEN` fails loudly rather than pseudo-passing.
  - Robustness measured against real runs: the backend venv install runs the repo's own
    `scripts/patch_linkedin.sh` first, because the `linkedin-api==2.2.1` sdist ships a malformed
    `entry_points.txt` that aborts pip (`Invalid script entry point` — the package itself is on
    PyPI and downloads fine); SARIF is **parsed** before upload, so a rejected token or an unpublished
    image warns and skips instead of failing the run with a misleading upload error. Recorded
    gotcha: **Snyk Code answers HTTP 403 when `sastEnabled` is off on the Snyk org** — an
    org-settings toggle, not a bad credential.
  - Release triage (rule 8) and the `security-triage` charter now name the Snyk and Bandit feeds
    alongside CodeQL and Dependabot, with the per-category triage note.
- **SonarQube adoption, local-first (#359, adapting stock PR #357)** — `scripts/sonar_local.sh`
  runs a dockerized SonarQube Community + scanner against the committed
  `sonar-project.properties` (both stacks, coverage reused from pytest/Vitest output) and
  exits by the quality-gate verdict; the stock `sonarqube.yml` workflow is now
  **secrets-gated** (absent `SONAR_TOKEN`/`SONAR_HOST_URL` → clean skip, never red — the
  rollout-job pattern). Recorded decision: SonarCloud is the recommended CI target for this
  public repo (free, PR decoration without Developer Edition).

### Changed
- **Reviews must run on a rebased branch, and one PR at a time (owner directive 2026-09-13)** —
  rule 13 and the `pr-reviewer` charter now require `git fetch origin main && git rebase
  origin/main` plus a `MERGEABLE` / zero-commits-behind check *before* a verdict is requested, and
  the reviewer posts a short `REQUEST CHANGES` naming the gap instead of spending a full analysis
  to report "rebase first". Measured in the v1.14.1 cycle: **five stale-base blockers across five
  PRs** (#357, #364, #365, #366, #367), **two of which consumed a review round and nothing else** —
  #364's verdict states verbatim that the stale, conflicting base was the *only* thing blocking it.
  The refusal must be **posted, not said in chat**: `pre-merge-gate.sh` compares a verdict only
  against commits *on the PR*, so it cannot see `main` move, and an un-posted refusal would leave a
  stale APPROVE standing on a branch that is behind but has no new commit. A stale review is also misleading — it clears code against a base that will
  never merge. Batching several PRs into one review run is likewise forbidden: verdicts arrive
  late and together, and fixes for the first cannot start until the last is analysed.
- **`scripts/dedup_changelog_unreleased.py` + its self-test** — merging two `[Unreleased]`
  sections duplicates headings *and* entries independently, so a heading-only check passes while
  entries are doubled; that shipped to review twice (#354, #362) and cost a round each. The helper
  **never loses content**: headings it does not recognise (`### Docs`, `### Deprecated`,
  `### Documentation` — all real in this repo's history) are kept rather than dropped, preamble
  text before the first heading is kept, and entry splitting is fence-aware so a `- ` inside a code
  block is not torn out. 24 self-test cases, each loss case taken from a real defect caught in
  review, plus a no-loss check against the repo's own 27-release CHANGELOG (entry count asserted, not hard-coded).
- **CI frontend jobs use the same worker-teardown retry as the pre-push gate (#319)** — each of the
  three Vitest project steps in `deploy.yml` now runs through `scripts/run_frontend_suites.sh`
  (signature-narrow single retry for the upstream Vitest teardown race, #309) instead of a bare
  `npm run test:coverage:*`, closing the gap where the pipeline was less robust than the local gate.
- **Rebranded to Beaconfolio; repository renamed to `mavrovde/beaconfolio` (#330, executing #88)** —
  the product name, the repository slug and the GitHub description/homepage now say **Beaconfolio**,
  and `beaconfolio.com` is registered. The prior working name could not ship: `hirefolio.com` has been
  registered since 2011 and serves a live job-search product in the identical niche. `beaconfolio` was
  verified free across `.com`, `.dev`, `.io`, the GitHub org namespace, npm and PyPI via registry RDAP
  and the authenticated GitHub API before registration.
  - **Image paths moved with the slug.** `IMAGE_NAME` derives from `github.repository`, so builds
    publish to `ghcr.io/mavrovde/beaconfolio-*` from **v1.14.1** onward; every tag through **`1.14.0`
    exists only at `ghcr.io/mavrovde/hirefolio-*`**. Deploying a pre-rename tag now requires pinning
    `IMAGE_REPO` explicitly. The four new GHCR packages are created **private** — visibility does not
    follow a repository rename — and must be made public once (`docs/DEPLOYMENT.md`, Registry notes).
  - **Every identifier renamed, as a HARD BREAK with no compat window** — defensible because
    nothing is deployed anywhere (the prod host has no Docker yet): the env prefix is now
    `BEACONFOLIO_*` (9 keys, was `HIREFOLIO_*`), the npm scope `@beaconfolio/shared` (was
    `@mavrov/shared`), the importer's `BEACONFOLIO_API_URL` (was `MAVROV_API_URL`), the default
    database `beaconfolio` / test database `test_beaconfolio`, the compose project `beaconfolio`,
    the deploy dir default `/opt/beaconfolio`, and the domain defaults `beaconfolio.com` (proxy
    `server_name`, CORS, `PUBLIC_URL`, SEO surfaces, live-freshness target). An existing `.env`
    written for the old names must be renamed key-for-key.
  - **The de-brand guard now hunts the OLD identity too** (`scripts/check_no_pii.sh`): check B
    matches `mavrov.de` **and** `hirefolio` (case-insensitive) across the whole tree minus the
    historical surfaces — the former #313 deferral exclusions (compose files, proxy defaults,
    workflows, CLAUDE.md, backend/frontend/agents/importer code) are all IN SCOPE now that #330
    renamed them. Exempt: `de-brand:` markers and the legacy GHCR pins. The self-test grew to
    **62 cases**, including one that replays the sweep's own miss (mixed-case `Mavrov.de` — the
    guard caught 3 of those in real code the moment it was tightened).
  - **Legacy subsystems removed** (owner directive during #330): `specs/` (pre-issue-flow spec
    documents), the root `agents/` A2A multi-agent team (`intake.py`, `orchestrator.py`, the a2a
    venv — independent of the `.claude/` toolkit, which is untouched), and `docs/agent-runs/`
    (the A2A system's four July run logs). All stay reachable in git history. The shared
    `PLAYBOOK.md` — which the eight `.claude/agents/` charters cite as their working flow —
    moved to `.claude/PLAYBOOK.md` with content intact; the CI playbook-drift step and the
    pre-push hook step that exercised `agents/tests/` were removed with the subsystem.
  - **Immutable records verified byte-identical to `main`**: this changelog's shipped entries,
    `docs/retrospectives/` and `LICENSE`. (`specs/` and `docs/agent-runs/` are removed, not
    rewritten — their content is unchanged in git history; an early sweep pass touched two
    retrospective lines and was reverted verbatim before merge.)
- **`.claude/hooks/pre-merge-gate.sh`: an APPROVE must be NEWER than every commit on the PR.**
  Replaying the release's own threads as they stood at merge time, **4 of 10 reviewed merges** carried
  commits no approval had seen — including the fixes to a reviewer's own findings, two merges of
  `main`, and the release PR itself. The remedy is the delta-confirm verdict this repo already posts.
  Self-test 85 → 94 cases (3 fail against the pre-change hook), mutation contract 18 → 20 killed.
- **Charters, playbook, skills and commands** taught the cycle's defect classes with the measurement
  behind each: assert a control at the SEAM (#322's PII test passed with the control deleted), jsdom
  never applies the component stylesheet (#325 — 447 unit tests green with the CSS gone), a
  conditional `test.skip` reports green against a dead stack (#323), a test pinning today's payload
  pins today's bug (#323's expiry off-by-one), one machine/one Docker stack and a worktree per
  concurrent agent, and — found by this PR's own review — that an `ENV=value` **prefix is command
  text**, so a hook documenting a bypass must parse it per segment or the documented remedy is a deny
  loop with no exit. Recorded as `lessons-learned` §49–§55; `env-gotchas` gains the shared-checkout
  trap (a moved `HEAD` sends a commit to `main`) and the shallow-fetch trap (proving a CI step
  locally with `git fetch --depth=1` shallows your own repository), both measured while writing this
  retrospective.

### Removed
- **The `frontend-design` plugin** — carried as a conditional KEEP through two releases with no
  evidence of use in either; the cycle's only design-shaped work (#311) shipped through a hand-written
  renderer without it. An enabled plugin costs tokens on every load; re-enabling is one line, and the
  trigger is written into CLAUDE.md.

### Fixed
- **Snyk scan follow-ups from the #368 review (#358)** — three corrections to the scanning surface,
  each one measured rather than assumed:
  - **`.snyk` now declares `version: v1.25.0`.** Without it the policy can be judged invalid and
    **silently ignored** — the worst failure mode an exclude list has, since it looks like it works.
  - **The backend scan venv uses the repo's own `scripts/patch_linkedin.sh`**, like every other
    install leg (`backend/Dockerfile`, `deploy.yml`, `copilot-setup-steps.yml`). The previous
    comment blamed "absent from PyPI"; the run log actually says
    `ERROR: For req: linkedin-api==2.2.1. Invalid script entry point` — the sdist ships a malformed
    `entry_points.txt` that aborts pip. It now resolves properly instead of limping on a
    best-effort fallback.
  - Undocumented `**/` glob prefixes dropped from `.snyk` — the documented form already matches at
    any depth.
- **Unmatched URLs now render the site's own 404 instead of Express's bare page (#324)** — the public
  app declared no `**` route, so an unknown URL never reached Angular at all: the SSR engine declined
  the request and Express answered its own `Cannot GET /…` body (measured: 404, `x-powered-by:
  Express`, `content-length: 153`, **no `<head>`**). `/blog/<unknown>` and `/for/<unknown>` were
  already correct because their routes match — that asymmetry was the bug. A lazy `**` route now
  renders a terminal-styled `NotFoundComponent` (site header, the echoed path, links back to the
  portfolio, the blog and the CV) and sets a **real HTTP 404** through the `RESPONSE_INIT` pattern
  (#109) already used by the blog and tailored pages.
- **A 404 no longer claims to be the home page (#324)** — `SeoService.setNotFound()` emitted no
  canonical of its own, but the runtime-config re-apply (`updateSeo({})` → `data.url || '/'`) had
  usually already written `<link rel="canonical" href="{site}/">` into the head, so every not-found
  body told crawlers it WAS the home page. `setNotFound()` now removes the canonical outright (none
  is correct for a 404; `updateSeo` re-creates it for the next real page), and a `nofollow` asserted
  by the wildcard page survives a late config arrival. `/blog/<unknown>` and `/for/<unknown>` keep
  their existing `noindex` title/meta behaviour. Covered by unit specs (public: 55 files / 490 tests,
  100% coverage) and a new `e2e/public/not-found.spec.ts` reading the wire.
- **Snyk Code no longer scans the throwaway venv the scan job itself creates (#358 follow-up)** —
  the first real run after `sastEnabled` was enabled produced **100 alerts, 79 of them inside
  `backend/.snyk-venv`** (`pip/_vendor/…` and other third-party package sources), burying the 21
  findings that are actually ours. Fixed at the source: the resolution venv now lives in
  `$RUNNER_TEMP`, outside the checkout, so code analysis cannot walk into it — dependencies are
  judged by SCA, which reads the manifests directly. A committed `.snyk` policy additionally
  excludes the other vendored/generated trees (`node_modules`, `dist`, `.angular`, local venvs,
  coverage, `.scannerwork`).
- **Rate limiting no longer trusts the attacker-controlled `X-Forwarded-For` hop (#273, security)** —
  the per-client-IP key came from `x-forwarded-for.split(",")[0]`, which is whatever the caller
  typed: nginx **appends** with `$proxy_add_x_forwarded_for`, it never replaces, so rotating that
  header minted a fresh bucket per request and the profile, contact-form and tailored-link budgets
  were bypassable at will. Measured against the running v1.14.0 stack through the real proxy:
  `GET /api/app/stats/public` with `X-Forwarded-For: 1.2.3.4` reported `visitor_ip = 1.2.3.4`.
  - `app.services.rate_limit.client_ip` now believes forwarding headers **only from a trusted
    peer** (`TRUSTED_PROXY_CIDRS` — the same knob, same default `172.16.0.0/12`, the proxy
    container already uses; the running nginx sits at `172.18.0.8`), and then reads `X-Real-IP`
    (set by our nginx to `$remote_addr` on every proxied location), else the **last**
    `X-Forwarded-For` hop that is not itself one of our proxies, else the peer address. A direct
    caller — bare dev, an exposed container port — is keyed by its own address, so a spoofed
    header buys nothing there either. Values that are not IP addresses are never used as keys.
  - All three public limiters inherit it (profile GET, contact POST, tailored-link visit/CV), and
    `GET /stats/public` now reports the same derived address instead of echoing hop 0 back.
  - **`uvicorn --no-proxy-headers` is part of the fix.** uvicorn's `ProxyHeadersMiddleware` is on
    by default and rewrites `scope["client"]` from `X-Forwarded-For` when the peer is in
    `FORWARDED_ALLOW_IPS` (hop 0 when that is `*`) — measured: with it on, 7 requests with a
    rotating spoofed first hop all passed a 5/60 limiter; with it off the 6th got `429`. The app's
    `TRUSTED_PROXY_CIDRS` check is now the single decision point (`backend/Dockerfile`, pinned by
    a test). Nothing in the backend reads `scope["scheme"]`; nginx still logs the real client IP.
- **Analytics no longer starves the connection pool — and both counters are now exact (#326)** —
  an engagement emit opened its own session from the REQUEST pool while the request that scheduled
  it still held its own (a background task is part of the ASGI cycle), so at concurrency ≥ pool
  capacity one request wanted two connections and the pool deadlocked against itself. Every request
  still returned `200`, so the loss was invisible. Measured on `/cv/download`, 300 requests at
  concurrency 60: **32.3 s, 106 `QueuePool limit … connection timed out`, 194/300 events,
  139/300 `download_count`**. After: **1.4 s, 0 timeouts, 300/300 events, 300/300 increments**;
  at 600 requests / concurrency 120 (2× capacity) **1.9 s, 600/600, 600/600, 0 timeouts**.
  - **Analytics has its own small pool** (`analytics_engine`, `pool_size =
    ENGAGEMENT_MAX_CONCURRENT_WRITES = 4`, `max_overflow = 0`), so a side write can never take a
    connection a request is waiting for. Separation — not a bigger number — is the fix: bounding
    the emits on the *shared* pool was measured to be **worse than leaving them unbounded**
    (397 timeouts and 152 HTTP 500s vs 106 timeouts and none), because a bounded emit that cannot
    get a connection blocks every emit behind it while the connection holders wait on those emits.
  - **Backpressure with a countable drop**: emits queue under a semaphore, and one arriving with
    `ENGAGEMENT_MAX_PENDING_EVENTS` (1000) already in flight is dropped, counted
    (`engagement.dropped_event_count()`) and logged at WARNING. Analytics never grows memory
    without bound and never loses an event silently.
  - **`download_count` is incremented by the database**, not read-modify-write in Python. The old
    form lost concurrent increments outright — measured with analytics OFF (1.5 s, zero errors, no
    pool pressure whatsoever): 300 downloads at concurrency 60 left the counter at **3**. It is now
    `UPDATE … SET download_count = download_count + 1 … RETURNING id`, evaluated under the row lock.
  - **Pool sizing is explicit and documented** (`DB_POOL_SIZE` 20 + `DB_MAX_OVERFLOW` 40 = a hard
    ceiling of 60, inside Postgres' default `max_connections` of 100) and **`echo=True` is gone**:
    `DB_ECHO` defaults to `false`, so production no longer logs every statement and every bound
    parameter. No request-path latency cost: 60 sequential downloads, three alternating rounds,
    mean **4.75/3.92/4.40 ms before** vs **4.30/3.58/3.61 ms after**.
- **Bandit CI workflow rebuilt on the repo's own Bandit contract, with stable SARIF
  (#355 follow-up)** — the stock template had three defects, all measured: it scanned every
  path at every severity and flooded the Security tab with **100 findings** (98× B101
  `assert`-in-tests noise, a rule-10-compliant dummy fixture token, and one deliberate
  local-probe `verify=False`); it drove the scan through `shundor/python-bandit-scan`, an
  unmaintained third-party action pinned to a 2022 commit — the source of the
  *"Node 20 is being deprecated"* pipeline warning; and its SARIF carried **no category**, so
  another tool's upload could displace its results.
  - The job now runs `bandit` **directly** under the CLAUDE.md contract
    (`-ll --skip B101`) across `backend/app`, `backend/scripts`, `backend/ensure_admin.py`,
    `importer` and the root proxy probe — wider than the backend-local command, which sees
    `backend/app` only — emitting SARIF via `bandit[sarif]`.
  - SARIF is **validated before upload** (missing/malformed → warn and skip, never a failed
    upload masquerading as a broken pipeline) and published under an explicit
    `category: bandit` so Bandit, Snyk and CodeQL results coexist.
  - Actions moved to the Node 24 generation (`actions/checkout@v7`, `actions/setup-python@v7`,
    `github/codeql-action/upload-sarif@v4`), matching the rest of the repo's workflows.
  - **The scanned path list is chosen by measurement, not intuition.** An earlier draft scanned
    `scraper/` and the root `scripts/` — which contain **zero Python** (they are Node and bash) —
    while missing `backend/scripts/` (12 Python files: password reset, key backfill, db probe,
    seeders) and `backend/ensure_admin.py`. Those held **two genuine MEDIUM B310 findings**, now
    fixed at the root: `backend/scripts/seed_blog.py` validates that the env-supplied `API_URL`
    is an `http(s)` URL before use, so a `file://` or `ftp://` value can no longer turn an "HTTP"
    call into a local-filesystem read. Measured after the fix: **0 findings, 0 warnings.**
  - The intentional `verify=False` in `verify_proxy_routes.py` carries a **bare** `# nosec B501`
    with the rationale on the lines above: Bandit parses anything trailing the marker as further
    test IDs, which emitted 15 spurious warnings per run. Measured after the fix:
    **0 warnings, valid SARIF 2.1.0, 0 findings.**

### Security
- **Open redirect in the CV download link, closed at its source (#376)** — `getDownloadUrl` returned
  any absolute URL from the API response verbatim into `window.open`. **Two earlier attempts at this
  were not enough, and both are worth recording**: `noopener` guards reverse tabnabbing, a *different*
  vulnerability; and a regex gate on `http`/`//` missed backslash authority forms
  (`/\evil.com/x`, `\\evil.com/x` — the WHATWG parser treats a backslash as a separator) *and* only
  applied when `environment.apiUrl` was set, which **neither shipped environment does** — both are
  `''`, so the guard never ran in production. **A third attempt still leaked**: `URL.pathname` can
  begin with *two* slashes (`..//evil.com/x` over-pops the base, leaving an empty first segment), and
  a `startsWith('/')` guard accepts that happily — 5 of 80 vectors escaped, again only in the
  `apiUrl = ''` configuration that production actually ships. The URL is now parsed
  **unconditionally** against a throwaway base, keeping only `pathname + search`, and **every leading
  slash or backslash is collapsed to exactly one** — closing the class rather than the spellings.
  Measured 0 escapes across 80 vectors with `/a//b` preserved. Pinned by cases that run with
  `apiUrl = ''` — the shipped value — after the first set tested a configuration production never uses.
  The cases now assert an **invariant** (the result is never protocol-relative and never
  scheme-bearing) rather than a list of vectors: three rounds of green suites coexisted with a live
  bypass precisely because the table only held the spellings someone had thought of.
- **`x-powered-by` is no longer advertised** — `app.disable('x-powered-by')` in the SSR server; it was
  the header the bare Express 404 leaked before #324. Asserted on the wire in the `not-found` E2E,
  since `src/server.ts` is excluded from unit coverage.
- **`PROFILE_DATA_DIR` is treated as the untrusted input it is (#376)** — it is an *environment
  variable*, not the "module constant" an earlier suppression claimed. Each profile path is now
  `realpath`-resolved and refused if it escapes its root, covered by a symlink-escape test;
  `app/api/years.py` is back at **100%**.
- **Merge gate now filters verdicts by trusted author association (#316)** — on this PUBLIC repo any
  passer-by could post an approval-shaped comment; `pre-merge-gate.sh` now admits a verdict only from
  an `OWNER`/`MEMBER`/`COLLABORATOR` entry (missing/unknown association = untrusted, fail-closed).
  "Newest wins" still holds within the trusted set. Six new self-test cases + a mutation
  ("trusted-author filter removed") prove it load-bearing.
- **`guard-destructive` no longer treats the SPELLING of a shell as a security boundary (#253)** —
  four pipe-into-shell forms executed a destruction payload **completely unguarded**, measured on
  `main` with a real `docker volume rm` payload: `| \bash`, `| /usr/bin/env bash`,
  `| /usr/bin/sudo bash` and `| /usr/bin/timeout 60 bash` all returned `allow`.
  - **Root cause:** normalisation ran *once, after* the wrapper-peel loop had already given up, so
    an absolute-path wrapper was never peeled at all — `/usr/bin/env bash` was reduced to
    `env bash` with nothing left to peel it — and a leading backslash was never stripped here,
    though `inspect_segment` has stripped one since #204. Peeling is iterative, so normalisation
    has to be too: both steps now run **inside** the loop, which re-runs while either changes the
    segment. All seven spellings now `deny`; a benign `echo "hello" | /usr/bin/env bash` still
    `allow`s, so the fix buys no false denials.
  - **Payload-pass fork cost: a modest, measured reduction — and a corrected premise.** A builtin
    `case` prefilter now skips the `quoted_payloads` fork for segments with no quote character, and
    the `mask_quotes` fork for segments with no quote, backslash **or** `#`. The two predicates are
    deliberately different: an earlier draft used the narrow one for both, on the assumption that
    `mask_quotes` is the identity without a quote. **It is not** — it also de-escapes `\X` and
    blanks an unquoted `#` comment — and that assumption **opened a bypass**, caught in review:
    `echo docker\ volume\ rm\ <vol> | bash` and `echo rm\ -rf\ ./data | bash` both went from
    `deny` to **ALLOW**. Both deny again, pinned by two regression cases. The whitespace-squeeze
    `sed` runs only
    when irregular whitespace is actually present. Measured on a 40-segment pipeline ending in a
    shell: **1219 → 1178 forks (-3.4%)**. That is far less than #253 anticipated, because the
    issue's "~3 forks per segment" was wrong: the payload pass costs **~19 forks per segment**
    (768 forks for 40 segments), and the bulk of them are inside the recursive
    `inspect_inner_script` path, not the two calls prefiltered here. The remaining cost is
    therefore still bounded by the #235 deadline rather than eliminated.
  - **Hook self-tests now run in CI, not only in the pre-push gate.** This change is the argument
    for it: the gate runs on the author's machine, so a hook PR otherwise arrives with a green tick
    that executed zero hook cases — exactly the state in which the bypass above reached review.
    `guard-destructive`, `pre-merge-gate`, `guard-stack-resources` and `pre-push-tests` self-tests
    are hermetic (stubbed `gh`, fake `npm`, no network), so they belong beside the script lints.

## [1.14.0] - 2026-09-09

### Added
- **Tailored application links — `/for/:slug` (#250)** — the owner mints an unlisted URL per
  application instead of attaching a generic PDF, and the application stops being write-only:
  - **`TailoredLink`** (migration `tailored0010`) belongs to an opportunity (#247), pins a **CV
    variant**, and carries the note, the highlighted skills/roles, an optional expiry and the
    visit/download counters. Minted, revoked and copied from the pipeline detail panel — no
    rebuild, no redeploy.
  - **The slug is the access control**: no token, no login. A generated slug carries a random
    8-character suffix, and unknown / disabled / expired slugs all return the SAME 404 — a
    distinguishable answer would confirm that a guessed slug exists. A duplicate custom slug is a
    409, enforced by a DB `UNIQUE`, never a silent overwrite of another application's page.
  - **The public page is the portfolio, re-ordered — never a subset**: the highlighted skills and
    the matching roles move first, nothing is hidden, and an empty tailoring returns the original
    object, so `/` is provably untouched when the feature is unused.
  - **Kept out of every index**: `robots: noindex, nofollow` in the SERVER-rendered `<head>`,
    `Disallow: /for/` in `robots.txt`, and never a `<loc>` in `sitemap.xml`. `SeoService` now also
    **clears a stale `robots` tag** on the next normal page — a meta tag lives in the document, not
    in the route, so a client-side navigation away from a 404 used to carry `noindex` onto an
    indexable page.
  - **Visits are counted from the browser only** and land on the opportunity timeline
    (`Tailored link /for/… opened (visit #2)`); the increment is a single atomic `UPDATE … +1
    RETURNING`, so two opens in the same second are two visits. Counting during SSR would have
    doubled every real visit and turned a crawler prefetch into "the recruiter opened it".
  - **An expiry date means "through the end of that day."** The admin's `<input type="date">`
    submits a bare `2026-12-01`, which read as a timestamp is *midnight* — so a link "expiring
    2026-12-01" was already dead for the whole of 2026-12-01, and one minted with today's date
    404'd the instant it was sent, indistinguishable from a slug that never existed. A date-only
    value now resolves to the last microsecond of that day (UTC) on BOTH the create and the patch
    path, while a value carrying an explicit time is still honoured literally. The admin panel
    renders the expiry in UTC for the same reason: east of UTC the local calendar day of that
    instant is the next one, and the panel must show the day that was typed.
  - **The public writes are rate-limited per client IP.** `POST /for/{slug}/visit` and
    `GET /for/{slug}/cv` each append a row to the owner's timeline and are unauthenticated by
    design (the slug IS the access control, and the URL is meant to be forwarded), so an unlimited
    endpoint let any recipient grow the database without bound and inflate the very visit signal
    the owner acts on. 20 requests / 60 s by default
    (`TAILORED_VISIT_RATE_LIMIT_REQUESTS`/`_WINDOW_SECONDS`, both compose files), sitting between
    the contact form's 5 and the profile read's 100 so a corporate NAT full of real recruiters
    still fits; over budget is a **429 that writes nothing**. The READ path is deliberately
    unlimited — SSR fetches it server-to-server, so a per-IP budget there would key every rendered
    visit to one bucket and throttle the site instead of an abuser.
  - **Deleting a link asks first.** Delete is irreversible and the URL is already in a recruiter's
    inbox, while the recoverable `Disable` sits in the same row — same confirm-first convention as
    every other destructive admin action.
  - Exercised on every layer rule 12 asks for, each one measured: 42 backend tests
    (`tests/test_tailored_links.py`) inside a suite that holds at 100%; all three Vitest projects at
    100% on all four metrics; migration `tailored0010` applied, downgraded and re-applied against a
    real PostgreSQL 16; the route **curled on a composed Docker stack** — `200` with
    `content="noindex, nofollow"` and the note in the server-rendered bytes for a live slug, a real
    `404` for an unknown one, `Disallow: /for/` in `robots.txt` and no `/for/` `<loc>` in
    `sitemap.xml`; and the whole `public-e2e` project green with a spec that mints a link, asserts
    the note in the **server-rendered HTML**, watches the browser visit reach the opportunity
    timeline, and proves a revoked link 404s.
- **AI-agent discoverability: `llms.txt`, a JSON Resume endpoint and an explicit AI-crawler
  policy (#252)** — recruiter research increasingly runs through AI assistants, which rank what
  they can *read*. #71 won the search result; this makes the site legible to the answer engine.
  Everything below derives from runtime config (#65) and the live profile — no per-owner edits,
  no rebuild:
  - **`GET /api/app/profile/resume.json`** — the whole candidate in ONE request as
    [JSON Resume](https://jsonresume.org) v1.0.0: basics (incl. location, social profiles),
    work, education, skills, languages, certificates, projects, references, plus the signals an
    agent needs to act — `meta.availability` (#271) and `meta.contactUrl`. The mapping is a
    pure, fully-tested module (`backend/app/services/json_resume.py`) that translates the
    LinkedIn-flavoured scraper vocabulary into the standard one: `"Mar 2022"`/`"Mai 2019"` →
    `2022-03`/`2019-05`, `"Present"`/`"Heute"` → an **absent** `endDate` (the schema's
    convention for ongoing), `"2014 - 2016"` → start/end years. Every optional field is
    **omitted rather than emitted empty**, because `""` in a `format: uri`/`format: email`
    field is invalid while an absent key simply claims nothing. `certificates[].date` is the one
    field the schema declares `format: date`, so a year-only credential date ("2024") omits it
    rather than fabricating a day — the year stays on the HTML CV, which has no schema to
    satisfy. Served through the SAME public allowlist as the HTML profile
    (`public_profile_view`) — pinned by asserting the dict the mapper RECEIVES, since no input
    can make the two paths differ observably today — and validated in CI against the
    **vendored** v1.0.0 schema (`backend/tests/fixtures/jsonresume_schema_v1.json`) with
    **format assertion armed** (`jsonschema.FormatChecker()` + `rfc3986-validator`, so `uri`,
    `email` and `date` are really checked), including both shipped demo personas.
    With no profile uploaded yet it falls back to the frontend's bundled demo asset, the same
    source the public site renders, so the machine-readable document can never contradict the
    HTML.
  - **`GET /llms.txt`**, rendered per request by the SSR server
    (`projects/public/src/app/seo/llms-txt.ts`) in the [llmstxt.org](https://llmstxt.org)
    format: H1 + summary + availability sentence, then curated link lists — the structured
    profile first, then home/CV/contact, the newest posts (capped at 25, so the entry point
    stays small enough to fit in context — and the backend read is bounded to that same 25
    rather than paging the whole blog to discard it), and the sitemap/robots/AI-assistant links.
  - **An explicit, switchable AI-crawler policy in `robots.txt`.** The AI user-agents are now
    named individually (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web,
    anthropic-ai, Google-Extended, PerplexityBot, Applebot-Extended, meta-externalagent, CCBot,
    YouBot). `AI_CRAWLER_POLICY=allow` (default — being read by recruiter-side AI is the point)
    or `deny`, which gives **only** those agents `Disallow: /` and leaves classic search
    untouched. An unrecognized value normalizes to `allow` on both ends, so a typo can never
    silently deindex a portfolio. `/for/` (#250's tailored recruiter links) and `/admin` are
    excluded for every crawler — as path prefixes, and shipped before the feature rather than
    after the first leak. Under `deny`, robots.txt also stops advertising `/llms.txt`; the file
    keeps being served, because it is an on-demand map an assistant reads while helping a
    person, not a crawl permission (llmstxt.org draws the same distinction).
  - **The HTML head advertises both**: `<link rel="alternate" type="application/json">` to the
    JSON Resume and `<link rel="describedby">` to `/llms.txt`, written into the **injected**
    document so they are in the server-rendered HTML an agent reads.
  - README gained a "How AI assistants read this site" section; `AI_CRAWLER_POLICY` is
    documented in `.env.example` and reaches the backend in both compose files.
- **Engagement analytics: a private admin dashboard (#249)** — until now the only signal that a
  recruiter engaged was `cv_requests.download_count` buried in a DB row:
  - **`engagement_events`** (migration `engage0010`): a lean, first-party event table written from
    the flows that already exist — CV request, **every** CV download, contact submission. A new
    table rather than an aggregate because `download_count`/`downloaded_at` collapse repeated
    downloads into a counter plus the LAST timestamp, so a per-week download trend cannot be
    derived from them. **No new personal data**: an event carries a kind, a pointer to the record
    that already holds the identity (`cv_requests.id` / `interactions.id`) and a timestamp — no IP,
    no user agent, no name; the activity feed resolves names from the source record at read time.
  - **Recording is best-effort by contract, structurally**: it runs after the flow's own commit,
    writes through its OWN short-lived session and swallows its failures, so analytics can never
    cost the owner a CV request or an inbox message. The own session is load-bearing rather than
    tidy: sharing the request's session means a failed event write has to `rollback()`, which is
    session-WIDE — it expires the caller's loaded objects, and the caller's next attribute read
    becomes a lazy reload, i.e. sync IO in an async context (`MissingGreenlet`) and a 500 on a
    request that had already succeeded. Pinned by tests that break the event write and assert the
    contact form still returns 201 and the CV request still returns 200. The emit is also
    **scheduled rather than awaited** (`BackgroundTasks`), so the second connection it needs never
    sits on the visitor's critical path: `/cv/download` measured 6.5 ms mean inline vs 4.3 ms
    scheduled, with 210 requests still producing exactly 210 events.
  - **Admin dashboard** (`/analytics`, *Engagement*): all-time totals, a Monday-anchored per-week
    trend zero-filled so a quiet fortnight is a flat chart rather than a hole, and a
    recent-activity feed. Dependency-free CSS chart; zoneless-safe (every rendered value arrives
    through the async pipe).
  - **Weekly digest email** via the existing SMTP configuration — counts only, so the summary
    carries no identity off the server — and skipped gracefully (`sent: false`) when SMTP is
    unconfigured. One label map names an event the same way in the email and on the dashboard.
  - **Retention knob** `ENGAGEMENT_RETENTION_DAYS` (default 365; `0` keeps nothing, negative
    disables purging) applied from the dashboard. Purging deletes events only — the CV requests and
    inbox rows they point at survive.
  - **Off means off**: `ENGAGEMENT_ANALYTICS_ENABLED=false` writes no event and 404s every
    `/admin/analytics/*` route, so the dashboard has no route to reach. Both knobs are forwarded by
    both compose files (`scripts/check_compose_env.sh` green).
  - Every route sits behind `get_current_admin_user` at the router level — recruiter activity is
    owner-only, pinned by a 401 test on all three endpoints.
- **Marketing cover artwork, generated from the site's own visual identity (#311)** — the repository
  is the product's storefront, and until now a shared repo link rendered GitHub's generic fallback
  card while the README opened on administrivia:
  - **One renderer, three files**: `scripts/make-social-image.sh` (→
    `frontend/scripts/make-social-image.mjs`) composes the card at both card sizes and downscales
    the result for a legibility thumbnail — `docs/assets/social-preview.png` (1280×640, for GitHub's
    social-preview setting and the README banner), `docs/assets/social-preview-thumbnail.png`
    (320×160), and `frontend/projects/public/src/assets/og-image.png` (1200×630), which **replaces**
    the identity-neutral placeholder #71 shipped. It supersedes `frontend/scripts/generate-og-image.mjs`.
  - **README hero banner**, above the `# Hirefolio` heading, repo-relative and linked to the live
    site, so the repo's first impression is the product rather than a rename notice.
  - **Product-branded on purpose, and re-brandable**: no owner name and no headshot — the site's
    hero renders `profile.name`/`profile.png` from runtime config (#65/#66), so a screenshot of the
    running site would propagate a person into every fork. The artwork is drawn in the site's own
    language instead (`#33ff00` phosphor on `#050505`, VT323, matrix grid, scanlines, terminal
    prompt), and every string is a `BRAND_*` environment knob; rows that would overflow the terminal
    frame auto-shrink (down to 60% of the design size, measured against the content box so the safe
    area is respected), and a value that cannot fit even there fails the run with an error naming the
    `BRAND_*` field instead of hanging or overflowing.
  - VT323 is fetched once and **embedded as a data URI** (cached, gitignored) rather than fetched by
    the browser, so the render does not depend on Chromium's network stack; offline with a cold
    cache the script still exits 0 and warns loudly that it fell back to Courier. The bytes are
    **validated and SHA-256-pinned** before they are cached or embedded, so a non-2xx body (error
    page, captive portal) can neither poison the cache nor let a run log "VT323 embedded" while
    silently rendering Courier.
  - The renderer emits `IHDR`/`IDAT`/`IEND` only, enforced by an **allowlist** — no EXIF or text
    chunks, which matters because `scripts/check_no_pii.sh` is text-only and cannot see inside a
    PNG. Provenance, the design constraints and the one manual step GitHub exposes no API for
    (Settings → General → Social preview) are documented in `docs/assets/README.md` and the
    README's fork-and-go section.
  - **The tooling has its own self-test** (`frontend/scripts/make-social-image.test.mjs`, wired into
    `npm run lint` beside `check-cd-safety.test.mjs`): browserless and offline, it pins the PNG
    assertions, the bounded fit loop, and the font validation. Each case was mutation-checked —
    reverting the loop bound makes it report "the loop is unbounded again" in 5s instead of hanging
    the gate.

- **Recruiter-discovery SEO & schema.org structured data (#71)** — the portfolio is now
  discoverable outside the HR platforms, and everything it publishes about its owner comes from
  runtime config (#65), never a hardcoded domain or name:
  - **Enriched `Person` JSON-LD**, server-rendered on the home page: `hasOccupation` (with
    `skills`), `knowsAbout`, `alumniOf`, `worksFor`, `address`, `sameAs`, `jobTitle`, `url`. The
    mapping lives in a pure, fully-tested module (`projects/public/src/app/seo/person-schema.ts`);
    every optional property is **omitted** rather than emitted empty, because
    `"worksFor": {}` fails schema.org validation while an absent property claims nothing.
    "Current employer" is decided by the absence of a four-digit year in `endDate`, so it works
    for `Present` and `Heute` alike instead of matching an English word list.
  - **Open-to-work signal** tied to the admin-editable availability state (#271): `Person.seeks`
    → `Demand` when the owner is `open`/`listening`, nothing when `not_looking`. Deliberately
    **not** `JobPosting` — that type describes a vacancy offered by a hiring organization, so a
    candidate emitting one would be publishing a fake job ad.
  - **`sitemap.xml` and `robots.txt` are generated per request** by the SSR server from
    `SITE_URL` plus the live published-post list (`projects/public/src/app/seo/sitemap.ts`),
    replacing static files hardcoded to one domain that listed no blog posts. The static copies
    were deleted deliberately: the frontend nginx does `try_files $uri @ssr`, so a bundled file
    would have shadowed the route forever. When the backend is unreachable the files still render
    against the request's own origin — a sitemap needs absolute URLs, so degrading beats 500ing.
    Each SSR→backend read is bounded at 5s (`AbortSignal.timeout`), matching the backend's own
    `PROFILE_DATA_TIMEOUT_SECONDS` for the mirror-image call: a *refused* backend rejects at once,
    but a *hung* one would otherwise hold the request until nginx's 300s. Measured against a
    paused backend: 45s+ and still hanging before, HTTP 200 with the routes-only sitemap in 5.02s
    after.
  - **The canonical link is now in the server-rendered HTML.** It was written only in the browser
    (`isPlatformBrowser` guard around the ambient `document`), so the HTML crawlers actually read
    carried none. `SeoService` now writes into the **injected `DOCUMENT`**, which is the
    per-request server document under SSR — the same mechanism Angular's own `Meta`/`Title`
    services use. Measured on a prod-topology stack: `/`, `/blog`, `/cv`, `/llm` each return a
    unique title, description, canonical and `og:url`.
  - **`/llm` got its own canonical** — without an explicit `url` it inherited the site root,
    telling crawlers the page was a duplicate of `/`.
  - **The advertised Open Graph image now exists** (`projects/public/src/assets/og-image.png`,
    1200×630, generated by `frontend/scripts/make-social-image.mjs`). `og:image`/`twitter:image`
    have always pointed at `${SITE_URL}/assets/og-image.png`, but no such file was ever in the
    repo, so every share of the site advertised a 404. The card is identity-neutral by necessity
    (owner name/headline are runtime config); branded artwork remains #311's job.
  - `og:image`, `og:url` and the canonical link are now **omitted while `SITE_URL` is unknown**
    (before the runtime config arrives, or when the backend is down) instead of being emitted
    relative or empty — a wrong canonical is worse than a missing one.

- **Production deploy process: panel-free SSH flow on a multi-project host (#310)** — the researched
  runbook `docs/wiki/production-deployment.md` (21 `##` sections; held in-repo until the owner
  initializes the repository wiki, then moved verbatim — `docs/wiki/README.md`), plus the compose
  hardening its design requires. hirefolio becomes **one tenant** on a shared box instead of its
  owner:
  - **"What the owner must prepare — cutover checklist"** (owner directive) — 36 checkable items,
    each tagged `[owner]` or `[agent-at-cutover]`, covering the server and its **measured** minimum
    sizing, domain/DNS, TLS ("nothing to buy" on the Let's Encrypt path), every secret to generate,
    provider firewall and the port-25 reality, the GitHub-side actions, first-import content, and a
    cutover-day running order. Sizing is measured on a live warm stack, not estimated: `ollama`
    **4.195 GiB** resident with all three models, whole stack **≈ 5.4 GiB**, images **≈ 15.9 GB**
    for one copy (of which `ollama` 7.29 GB and `open-webui` 6.51 GB), `ollama_data` **3.6 GB** ⇒
    **8 GB RAM / 40 GB disk / 2 vCPU** minimum for hirefolio alone, 16 GB / 60–80 GB on a shared
    host. Includes an owner-facing, plain-language explainer of **`JWT_SECRET_KEY`** (stateless
    admin logins; knowing the key forges an admin token without a password — hence #177's startup
    refusal; generate it *on the host* so it never transits chat; rotation invalidates all sessions
    and is the right answer to suspected leakage; it is not the admin password), and an **SSH
    authentication** section covering ed25519 key pairs, the test-before-you-lock-yourself-out
    order, and **SSH certificates** as the honest scale-up path (expiring credentials, no
    `authorized_keys` sprawl — overkill for one owner and one host today).
  - **Shared edge chosen and argued.** A host-level Caddy edge owns 80/443 for every project;
    hirefolio's own `proxy` was rejected as the edge because it is in `APP_SERVICES`
    (`deploy.yml:934`), so every hirefolio rollout *and rollback* would recreate every tenant's
    traffic path. Includes a measured finding: the edge must forward to the tenant's **443**, not its
    80 — a request carrying the configured `PUBLIC_SERVER_NAME` returns `301` to its own HTTPS URL
    on `:80` (a redirect loop through the edge) and `200` on `:443`.
  - **Fixed container names removed** (`open-webui`, `global_proxy`) from both compose files —
    `container_name` is host-global and collides between projects. The service name remains a network
    alias, verified on a live stack (`getent hosts open-webui` → resolved; nginx, which refuses to
    start on an unresolvable upstream, started). `deploy.yml`'s proxy smoke check now resolves the
    container with `docker compose ps -q proxy` instead of a literal name.
  - **Bounded logging** on every service in both compose files (`json-file`, `max-size=10m`,
    `max-file=3`, overridable) — the default driver is unbounded, so one chatty tenant fills the disk
    for everyone; a daemon-wide `/etc/docker/daemon.json` equivalent is documented.
  - **Memory ceilings** on every prod service, all parameterized, Ollama named as the hog
    (`OLLAMA_MEM_LIMIT=8g`). Ceilings, not reservations: a healthy stack is unaffected.
  - **Operator action on an EXISTING host, once:** both `logging:` and `mem_limit:` bind at
    container *create*, and the rollout recreates only `backend frontend admin-frontend proxy`
    (`--no-deps`) — so `db`, `ollama` and `open-webui` keep their old unbounded configuration
    until a one-time `docker compose -f docker-compose.prod.yml up -d` (no `--no-deps`) on the
    host. That includes `ollama`, the hog the ceiling exists for. Volumes untouched; a fresh
    install needs nothing.
  - **`COMPOSE_PROJECT_NAME` guidance** in `.env.example`, shipped **unset** with a #288-style
    continuity warning — Compose derives the name from the deploy directory basename, so pinning the
    wrong value re-points the stack at new, empty volumes.
  - **Postgres is no longer internet-facing**: `POSTGRES_BIND_HOST` defaults to `127.0.0.1`. Note
    `ufw` does **not** filter Docker-published ports (DNAT in `PREROUTING`, never reaches `INPUT`), so
    a firewall rule was never the fix. **Changed default — what an existing deployment does on
    upgrade:** `.env.example` ships the key commented out, so an existing host has no pin and takes
    the new value. The application is unaffected — `docker-compose.prod.yml` wires the backend to
    `db:${POSTGRES_PORT}` over the compose network, and the `pg_isready` health check runs inside the
    `db` container, so neither traverses the published port. What changes is the host publish: any
    client reaching the box at an address other than loopback loses access — an **off-host** client on
    `<host>:5433`, and equally a **host-local process dialling the machine's LAN or bridge address**.
    Only clients dialling `127.0.0.1`, directly or through an SSH tunnel, keep it. That wider
    reachability was an unintended exposure, not a supported interface (`docs/DEPLOYMENT.md` documents
    no off-host database access, and the backup runbook goes through
    `docker compose exec -T db pg_dump`); if you relied on it, set `POSTGRES_BIND_HOST=0.0.0.0` — eyes
    open — or tunnel over SSH.
  - **`ssh-deploy` skill** (`.claude/skills/ssh-deploy/`) — failure→diagnosis for every step of
    `Roll Out To Prod Host`, the certificate-renewal runbook and the multi-tenant do-not-touch list;
    referenced from the `devops-pipeline` and `release-manager` charters and the CLAUDE.md AI-config
    map. Lessons-learned §44 records the four shared-host defaults that assume a dedicated machine.
  - Residual **1Panel/panel references removed** from `docs/`, `.env.example`, `proxy/` and
    `.claude/` (5 → 0), generalized to "whatever terminates TLS at the edge"; the product's own
    "admin panel" wording is untouched. `docs/DEPLOYMENT.md` now states the canonical split (compose
    runbook here, host lifecycle in the wiki) and warns that the `DEPLOY_*` secrets must not be added
    before 443 serves a real certificate — the health gate polls 443 while the stack self-signs.

  Compose defaults are byte-identical to the previous published bindings (`80:80`, `10443:443`), so
  CI, the Docker E2E and the WireMock integration tier are unchanged; the shared-edge remap is a host
  `.env` setting applied at cutover.

  **Product-oriented docs.** The article, the `ssh-deploy` skill and the `docs/DEPLOYMENT.md`
  sections this touches speak as **Hirefolio**, not as one installation: hostnames are
  `<your-domain>` / `admin.<your-domain>` (or `example.com` in config samples), the deploy directory
  is `/opt/hirefolio`, and the maintainer's domain appears once, as the canonical deployment
  instance. `DEPLOY_DIR`'s default follows: **`/opt/mavrov.de` → `/opt/hirefolio`**. That default is
  reached only when the `DEPLOY_DIR` secret is unset, and the rollout has never run on any host (the
  three `DEPLOY_*` secrets are absent), so no existing deployment is repointed — a host that lives
  elsewhere sets the secret, which is what it is for. Repo-wide de-branding of files outside this
  PR's scope is tracked separately.
- **v1.13.0 release retrospective (#265)** — `docs/retrospectives/v1.13.0.md` plus the trend row,
  from 16 merged PRs and 50 reviewer verdicts read in full. Two new repo-contract lints, each with a
  self-test that runs beside it in the pre-push gate; the first also runs in CI, the second is
  gate-only because CI already runs the three Vitest projects as separate jobs:
  - `scripts/check_compose_env.sh` — every `Settings` key the documentation promises must appear in
    the backend `environment:` allowlist of **both** compose files. Three blocker-level review
    findings in one release were this exact bug (#296 SMTP, #297 Telegram/webhook, #298
    `TRANSLATION_ENABLED`/`OWNER_LANGUAGE`), with #256 and #228 as priors; the checker reproduces
    all three at their real round-1 commits. It also found two live instances on the v1.13.0 tag:
    `IMPORT_MAX_IMAGE_MB` was forwarded in prod but not dev, so the dev stack ignored the value a
    root `.env` set for it — measured `docker compose config` before/after: `"10"` (code default)
    → `"8"` (the configured value). **Behaviour note for anyone whose `.env` sets it: the dev
    stack now honours it.** Also `LINKEDIN_COOKIES_DIR`
    was advertised as settable while being a volume-mount target (now documented as not settable).
    12 self-test cases, failing-first.
  - `scripts/run_frontend_suites.sh` (pre-push gate only) — runs the three Vitest projects
    independently instead of `npm test`'s `&&` chain, and retries a project **once** only when its output carries the
    Vitest worker-teardown signature *and* reports zero failed tests. That race hard-failed the
    whole pre-push gate twice this cycle with 337/337 tests passing — once while pushing the release
    tag — and the chain meant `admin` never ran either time. A real failure is never retried;
    14 self-test cases. (It is **not** a 4.x-only problem: the Vitest 5 bump later in this release
    reproduced it on 5.0.0, so the harness stays — see the Changed entry below.)

### Changed
- **De-branded the docs: product voice, not the maintainer's instance (#313)** — owner directive
  2026-09-07 ("stop orienting all docs to mavrov and mavrov.de, it is an open project"). Completes
  the arc #66 (content) → #288 (database identifiers) → this (documentation). Measured on the
  issue's own acceptance grep — README.md, `docs/` minus `retrospectives/`+`agent-runs/`, `.claude/`,
  `.env.example`: **37 hits → 9**, and every survivor is one of the three sanctioned kinds.
  - **Guidance surfaces speak the product's voice.** All seven agent charters and the four skills /
    commands that named the maintainer's domain now say **Hirefolio** (`backend-dev`, `frontend-dev`,
    `devops-pipeline`, `pr-reviewer`, `release-manager`, `security-triage`, `issue-author`;
    `lessons-learned`, `issue-workflow`, `e2e-validation`, `/linkedin-sync`, `/deploy-status`,
    `agents/PLAYBOOK.md`, the pre-push hook header), joined in review round 2 by six surfaces the
    acceptance grep never covered: `README_TESTING.md`, `.github/copilot-instructions.md`,
    `.github/prompts/release-check.prompt.md`, `.github/dependabot.yml`, `importer/README.md`, and
    `SECURITY.md` — whose vulnerability-report link still pointed at the **pre-rename**
    `mavrovde/mavrov.de` advisory path and worked only through GitHub's redirect.
    `/deploy-status` no longer curls a hardcoded host: it resolves `SITE_URL` from the environment or
    an uncommented `SITE_URL=` in `.env` — never `.env.example`, whose placeholder would send it to
    probe `example.com` — and **asks** rather than guessing.
  - **`.env.example`** hostname examples become `example.com`-style placeholders matching the
    existing Jane-Doe convention — a forker sees no maintainer domain to edit out — with an explicit
    warning that these two knobs must be set, because the compose fallback is deliberately unchanged.
  - **Historical records kept verbatim.** Incident narratives in `lessons-learned` (§13's proxy-route
    404, §20's repo rename) are *annotated* with a trailing `<!-- de-brand:historical: … -->`
    comment, never rewritten; `CHANGELOG.md`, `docs/retrospectives/` and `docs/agent-runs/` are out
    of scope by design.
  - **The stance is now enforced, not asked.** `scripts/check_no_pii.sh` grew a second contract that
    **reverses its own former exemption** (its header excluded `mavrov.de` as "a legitimate infra
    default"): the domain is still fine in runtime fallbacks and history, but on a current-guidance
    surface the line must carry one of three **namespaced, case-sensitive** annotations —
    `<!-- de-brand:canonical: … -->` (the one sanctioned instance aside),
    `<!-- de-brand:historical: … -->`, or a literal `ghcr.io/mavrovde/mavrov.de` legacy image path —
    matched against file **content only**. Its **scope is inverted**: everything tracked, minus a
    named exclusion list that *is* the issue's deferred list made executable (history, the runtime
    fallbacks that would repoint a live deployment, `CLAUDE.md`, application code). An include list
    failed open twice in review — a file nobody listed was exempt forever, and a file created next
    year was exempt before it existed; the exclusion list fails closed.
    `scripts/check_no_pii.test.sh` pins both contracts with **60 cases**: the failing-first one, 21
    in-scope surfaces individually, 13 out-of-scope surfaces that must *not* trip, six paths that
    appear nowhere in the checker and must be **guarded from birth**, and — the part round 1 was
    missing — the **negative direction**: prose that merely contains "canonical"/"historical", a
    marker in the wrong case, and a marker living in a *directory name*. It runs in the pre-push
    docs leg and in CI's Version Consistency job. Every contract is mutation-proved, one variable at
    a time (all measured on the 60-case suite): bare-word markers **3** red, matching the
    `path:line:` prefix **1**, neutering check B's `rc=1` **36**, restoring the include-list scope
    **14**, dropping a history exclusion **1**, widening `agents/*.py` to `agents/*` **2**, widening
    the two named workflow exclusions to `.github/workflows/*` **1**.
  - **Three lessons banked, all found by a gate or a review rather than by reasoning.** **§46** —
    the gate caught its own author on the first push: the self-test's fixture *was* the identifier
    check A hunts, so the fixture is now assembled at runtime rather than the file exempted (never
    widen a guard's exclusion list to accommodate the guard's own tests). **§47** — an exemption
    marker is an API, not a word: bare `canonical|historical` matches 33 innocent in-scope lines
    (measured), exempted every file under a `canonical`-named *path*, and even bent two doc
    sentences into inserting the word "historical" for the matcher's benefit; for any allowlist,
    **the load-bearing test is the negative one**. **§47b** — an include list of "surfaces we guard"
    fails open; invert it, name exclusions file-by-file rather than by directory, and test the
    fail-closed property directly.
  - **No behaviour change.** `DEPLOY_DIR` was already `/opt/hirefolio` (#310); the compose /
    `proxy/entrypoint.sh` `PUBLIC_SERVER_NAME`/`ADMIN_SERVER_NAME` fallbacks are untouched on
    purpose, so no existing deployment is repointed.
- **Dependency modernization — frontend test runner on Vitest 5** (#309, supersedes Dependabot
  #306/#307/#308): `vitest`, `@vitest/coverage-v8` and `@vitest/browser-playwright` all move
  `4.1.11 → 5.0.0` in one lockfile pass. `@analogjs/vite-plugin-angular` needed no bump — it
  declares **no `vitest` peer at all** (only `vite` and `@angular/build`), and the installed
  `vite 8.1.5` satisfies Vitest 5's `vite >= 6.4.0`. All three projects stay at **100%
  statements/branches/functions/lines with unchanged thresholds** (837 tests, 103 files).
  Two behaviours changed and are recorded rather than papered over:
  - Vitest 5 matches `coverage.include`/`exclude` **relative to the project root without
    picomatch `contains`**, so `shared`'s `exclude: ['testing/**']` no longer accidentally
    swallows `src/lib/testing/**`. That project now measures **20 more statements, 4 more
    branches, 6 more functions, 17 more lines** (194/105/47/175 → 214/109/53/192) — all already
    covered, hence still 100%. `public` and `admin` are byte-identical. (lessons §45)
  - The worker-teardown race that `scripts/run_frontend_suites.sh` tolerates is **not fixed by
    the major**: measured 1 occurrence in 25 consecutive `npm run test:public` runs on 5.0.0,
    same signature. The harness stays; its comment, `env-gotchas` and `/verify` now say so.
  `clearMocks` now defaults to `true`; re-running all three suites with `clearMocks: false`
  restored gives an identical 837/837, so nothing here depends on the new default. Playwright
  E2E is untouched (separate runner, `@playwright/test` unchanged in the lock).
  Two changes ride along, both from the PR review:
  - **The 100% coverage standard is now an ENFORCED floor, not a convention.** All three configs
    gain `coverage.thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 }`.
    Until now no `thresholds` block existed anywhere: a coverage drop printed a smaller number and
    the run still exited 0 — only the CI job *names* claimed "100% coverage". Proven to gate:
    dropping one spec per project fails each run non-zero **with every remaining test passing**
    (`public` denies at 99.69% branches), and the same runs with the thresholds neutralised exit 0.
  - **`frontend/.npmrc` sets `legacy-peer-deps=true`.** `@angular/build@22.1.7` still declares
    `peerOptional vitest ^4.0.8` for its `@angular/build:unit-test` builder — which this repo
    configures but never invokes — so on Vitest 5 a plain `npm install` exits 1, breaking the
    onboarding command documented in `README.md` / `README_TESTING.md`. Every install path here
    already passed `--legacy-peer-deps`; this makes it the project default. Trade-off recorded in
    the file and in lessons §45: it silences genuine peer conflicts too, so the one-pass
    lockfile regeneration + programmatic lock review remain the real guard.
- **Backend dependency bump (#321)** — `alembic` `1.19.1 → 1.19.2` in `backend/requirements.txt`
  (Dependabot `backend-minor` group, upstream semver-patch). Within the current major, per the
  dependency policy; `requirements-dev.txt` does not pin `alembic`, so there is no second carrier
  to update.
- `agents/PLAYBOOK.md` gains five discipline rules measured from this release (verify by observable
  not by construction; your verification's scope is a claim too; a new setting is three edits;
  `git push` rides alone; a verdict states itself in line 1); `release-manager` must trace a changed
  default before claiming SemVer compatibility (#300 round 1); `issue-author` must match a
  criterion's embedded command to the criterion's intent (#288's AC2 vs #299's two blockers);
  `backend-dev` gains await-boundary race diagnosis, the integration tier's shared 5/60s contact
  budget, and the background-task session redirect. Lessons §40–§43 and two `env-gotchas` entries
  (stale Docker host-port bindings, the Vitest teardown signature) added; the retrospective counting
  convention is now heading-anchored with its bias documented.

### Fixed
- **Merge gate could accept an author's fix report as a review verdict (rule 13).**
  `pre-merge-gate.sh` selected the newest body containing `APPROVE`/`REQUEST CHANGES` anywhere.
  On #291 two such bodies are the author's own fix reports whose first marker is `APPROVED`; since
  reviewer and author post under one GitHub identity, either would have counted as the newest
  verdict and allowed a merge while the standing verdict was REQUEST CHANGES. A verdict must now
  state its marker in the **first non-empty line**. It also closes a SECOND false-allow, found by
  this change's reviewer rather than its author: #293's `## ⛔ REJECTED` body carries no marker in
  its heading and exactly one anywhere — the prose "expect to approve immediately" — which the old
  case-insensitive body-wide match read as the verdict. Self-test **77 → 85 cases**, of which
  **4 fail against the previous hook**, plus a new mutation in the contract (now 18 killed).
  Known residual, documented rather than pinned (lessons §43): a fix report whose *first line*
  itself carries a marker still allows — no lexical rule separates it from a real heading, so the
  charter convention is the guard.
- **`pr-reviewer` charter told reviewers to write `⛔ REJECTED`**, a heading containing neither
  marker. Three costs, all measured: the merge gate could not have read it; the retrospective's
  verdict count silently lost #293's two real REQUEST-CHANGES rounds; and #293 therefore read as the
  release's only round-1 approval when it took three rounds (the true figure is 0 of 16). Canonical
  headings are now `## ✅ APPROVE — round N` / `## ⛔ REQUEST CHANGES — round N`.
- **`backend-dev` / `frontend-dev` charters prescribed a chained push**
  (`… && git commit … && git push … && gh pr create`). The pre-push hook is a PreToolUse hook: it
  judges the whole command before any of it runs, so the chain fails on the un-fixed tree and on
  deny nothing in it runs — three denied pushes in one evening, one cascading into destroyed work.
  Both recipes are now unchained.

## [1.13.0] - 2026-09-07

### Added
- **Messenger notification channels (#263)**: owner notifications become a **pluggable channel
  registry** — every inbox interaction fans out to all configured channels, email now one among
  several. **Telegram** ships first (free Bot API, two `HIREFOLIO_*` env vars, 2-minute
  @BotFather setup) plus a **provider-agnostic webhook** channel (one implementation covers
  Slack/Mattermost/ntfy). Contracts pinned test-by-test: empty config = the channel does not
  exist and **zero requests are attempted**; half a Telegram config is no config; one dead
  channel never blocks another (Telegram 500 → webhook still fires) nor intake; a channel that
  *raises* is isolated by the registry's own belt; and the Telegram failure log carries the
  exception TYPE only — **the token is part of the URL and a test asserts it never reaches the
  logs**. WhatsApp is a documented decision, not a stub (Meta verification, template approval,
  per-conversation pricing — recorded in README with the adapter seam). Rule 10 by construction:
  mocked HTTP boundary, CI never sees a token. 16 channel tests + the #69 call-site tests migrated to the registry seam.
- **Transparent translation of recruiter messages (#248)**: every inbox interaction is
  language-detected and translated into the owner's language by the AI stack the system already
  runs — **local Ollama by default (private, free), Gemini when a key is configured**, the one
  fallback pattern. TRANSPARENT is a contract, pinned test-by-test: the stored **original is
  never mutated** (translation lives in separate, re-runnable columns; migration `trans0009`);
  the admin inbox shows a detected-language badge and the translation **clearly labeled
  machine-generated**, with the original one click away; translation runs as a background task
  in its OWN session — intake never blocks or fails on it (LLM explosion ⇒ 201 + status=failed);
  `POST /admin/interactions/{id}/translate` re-runs on demand; `TRANSLATION_ENABLED=false`
  disables cleanly (no tasks scheduled, task-level belt, re-run 409s, zero UI remnants). Found
  and fixed on the way: background tasks bypass the test suite's `get_db` override, so without a
  session redirect they write to the DEV database — the conftest now redirects the module-level
  factory for every test (lessons §4's failure mode, one layer deeper). Backend suite
  984 → 1001 (100.00%), admin unit 398 → 406 (100% all four), and the inbox
  browser E2E drives label → toggle-to-original → re-translate end-to-end. Review round 1
  hardened all four of its blockers at the root: the re-run endpoint now requires admin auth
  (anonymous 401 pinned at unit AND composed layers); the whole test suite is hermetic at the
  LLM boundary (autouse `_generate` mock + Gemini-key scrub — no test in the default unit
  suite reaches a real LLM through the TRANSLATION path, and no test anywhere reaches a paid
  API; the pre-existing live-Ollama test `tests/integration/test_multi_chat_real.py`, which
  the default run does collect, is unchanged by this PR); failed/pending translations
  are visible and recoverable
  in the UI (the backend's exact failure shape covered at unit + browser layers); and
  `TRANSLATION_ENABLED`/`OWNER_LANGUAGE` are forwarded by both compose files so the knobs
  actually reach the container. CV-request messages get the same background translation, the
  WireMock tier gains the composed intake→task→LLM→row test, visitor text is delimited as
  data in the prompt, and the owner language is normalized (`EN`/`en-US` safe).
- **Bundled email capability (#262)**: the dev stack now ships **Mailpit** — every notification
  lands in a web inbox at `localhost:8025` with ZERO configuration and nothing ever leaves the
  machine (rule 10 by construction). The integration tier gains the repo's **first true
  end-to-end email assertion**: contact form → background task → real SMTP hop over the compose
  network → message asserted through Mailpit's API (tier 20 → 21 tests). `EmailService`'s
  quadruplicated SMTP block collapsed into ONE `_send` transport where **STARTTLS and login are
  independent and each optional** — sending is gated on `SMTP_HOST` alone, so the no-credential
  relay shape works while external providers keep auth+TLS by default (new `SMTP_STARTTLS`,
  `SMTP_FROM` settings; 4 transport-mode tests). Prod compose gains an **opt-in** `mail` profile
  (send-only postfix on the private network, absent from a default `up` — verified via
  `config --services`); `docs/DEPLOYMENT.md` documents self-hosted deliverability honestly —
  SPF/DKIM/rDNS and the port-25 egress reality — and recommends an external provider.
- **Hire-me CTA + availability indicator (#271 — AC5 of #69, split by review)**: the public hero
  now renders the owner's **job-search state** ("open to offers / listening / not looking",
  EN + DE) beside a prominent **Hire me** CTA that scrolls to the contact form. The state lives in
  a new runtime `site_settings` KV table (migration `avail0008`) — **admin-editable with no
  redeploy** via `PUT /admin/site-settings/availability` (vocabulary validated server-side) and a
  one-click toggle on the admin dashboard (optimistic with rollback, so the control never lies
  about persisted state). `/config/site` serves it publicly; the frontend service **normalizes an
  absent field from an older backend to the default** — deploy-window skew made the whole
  availability stream error and the indicator silently vanish (measured against the running v1.12
  container) — and a test pins the old-shape wire response. A vocabulary-sync test fails the
  backend suite if a new state ships without its EN/DE translations. 6 backend tests
  (suite 955 → 962 at this head, 100.00%), public 337 @ 100% / admin 398 @ 100% on all four metrics, and a
  3-test Playwright spec: indicator + CTA render translated, the CTA reaches the contact form,
  and **flipping the state through the real admin API changes the public hero** (route-mocking is
  impossible here — /config/site is fetched server-side and transfer-cached; measured).
- **CV variants on opportunities (#247 criterion 4 — the pipeline's last phase)**: the admin
  pipeline detail panel records **which CV variant went to which company, and when**. Backend:
  `POST /admin/opportunities/{id}/cv-sent` sets a `SET NULL` FK + timestamp (migration
  `cvvar0007`, self-adopt guard comparing column sets) and appends the durable
  `CV sent: version (filename)` note to the timeline — which survives even if the CV row is later
  deleted. **The invariant that matters is pinned by a dedicated test: recording a send NEVER
  touches `is_active`** — what the public site serves and what went to one company are independent
  facts. `POST /admin/cv/upload` gains **`activate`** (default true = the historical
  make-it-the-default behavior; `false` uploads a variant WITHOUT touching what the public site
  serves — before this flag, uploading a tailored variant unavoidably repointed the public CV,
  reproduced in review). Admin UI: a variant picker in the detail panel (loaded lazily, public default flagged),
  the current sent-variant with its timestamp, a since-deleted fallback label, and in-flight/
  error states — every callback repainting explicitly (zoneless). 5 backend tests
  (suite 946 → 951, 100.00%), 7 admin unit specs (suite 381 → 388, 100% on all four metrics),
  and a browser E2E driving the full record flow with the POST body asserted on the wire.
- **Interview reminder emails (#247 criterion 3, reminder clause — closes the deferral from #289)**:
  scheduling (or genuinely RE-scheduling) an interview now emails the owner via the existing SMTP
  service with the event's `.ics` attached — the same VEVENT the export route serves, from one
  shared builder, stable UID included, so importing both updates rather than duplicates. Sent in a
  FastAPI background task after commit: a mail failure can never fail the scheduling (pinned by a
  test whose fake service raises), and the service skips itself gracefully when SMTP is
  unconfigured — the criterion's own words, pinned with `smtplib` asserted NOT called. An
  outcome-only PATCH and a same-instant "reschedule" send nothing (mutation-checked: forcing the
  reschedule guard to always-fire fails the suite). This ships the reminder at booking time with
  the invite carrying the calendar alarm; a scheduler-driven "N hours before" push would need a
  process this repo deliberately does not run. 6 new tests (suite 940 → 946, coverage 100.00%).
- **Interview calendar — admin UI (#247 phase 2 / #70)**: a `Calendar` screen in the admin panel
  showing every scheduled round across all opportunities, **grouped by local day** with the company,
  role, stage, kind, interviewer and location on each row. The window is switchable (7 / 14 / 30 / 90
  days), a round that has **started but not finished** is flagged *in progress*, each row records an
  outcome in place, and each offers its `.ics` download. Grouping uses a real `Date` rather than the
  ISO string's UTC prefix: a 23:30 UTC round belongs to the next day anywhere east of UTC, and
  slicing the string would file it under the wrong heading for exactly the users who care.
  `InterviewsService` mirrors the backend schemas with explicit interfaces (no `any`), and the
  screen carries a **zoneless repaint pin** alongside its normal spec — the zone.js-bundling spec
  cannot see a missing `detectChanges()`, which is how five frozen-UI bugs reached this app (#276)
  and a sixth survived the lint (#290). The `.ics` control is a **button driving an authenticated blob download** — a plain `<a href>`
  carries no Bearer token and the admin-gated endpoint answers 401, which is exactly what the first
  version shipped (caught in review round 1, together with an outcome vocabulary the backend never
  had: both specs had hard-coded the fiction, so 371 green tests never sent one real PATCH). Day
  grouping is timezone-explicit (`Intl.DateTimeFormat` with an injectable IANA zone), a rejected
  outcome PATCH snaps the select back to the model, and a 4-test Playwright spec runs the screen in
  a real browser — including asserting the `Authorization` header on the download. 19 new admin
  tests (suite 362 → 381 against the rebased base, coverage 100%).
- **Interview calendar — backend (#247 phase 2 / #70)**: an `Interview` record on every
  opportunity (`interviews` table, migration `interview0006`, `ON DELETE CASCADE`) with
  admin-only endpoints to schedule (`POST /admin/opportunities/{id}/interviews`), list, fetch,
  reschedule/record an outcome (`PATCH /admin/interviews/{id}`) and remove a mis-created slot
  (`DELETE`, which writes the removal to the opportunity's notes timeline first, so no history is
  lost). Two surfaces make it useful on day one: **`GET /admin/interviews/upcoming?days=14`** —
  every scheduled round across all opportunities inside the window, soonest first, cancelled
  excluded, each row carrying its company/role/stage — and **`GET /admin/interviews/{id}.ics`**, a
  minimal RFC 5545 VEVENT (UTC `DTSTART`/`DTEND`, escaped TEXT values, 75-**octet** line folding
  that never splits a multi-byte character, `STATUS:CANCELLED`, stable `UID`) that imports into
  any calendar app. Timestamps are stored in UTC and any ISO-8601 offset is normalized on input;
  scheduling advances the opportunity to `interviewing` **forward only** (a card at `offer` or
  `closed_*` keeps its stage — the promote handler's never-regress rule), and every
  schedule/reschedule/outcome/removal lands on the notes timeline. An instant near
  `datetime.max` is rejected with 422 rather than accepted: `astimezone` and the `DTEND`
  arithmetic raise **`OverflowError`, not `ValueError`**, so one shape 500'd on input and — worse
  — another was accepted with 201 and then raised on *every* `.ics` export, forever. The parser
  now bounds `scheduled_at` so DTEND stays representable at the **maximum** duration the schema
  allows, because a later PATCH can raise the duration. `upcoming` keeps an interview that has
  **started but not ended** (per-row end time, not a blanket lookback), an opportunity whose stage
  is not in the known set is left untouched instead of raising, and the `UID` is escaped like
  every other TEXT value. 57 backend tests
  (suite 883 → 940 passing, coverage 100.00%), mutation-checked 8/8 — including the one that
  found `astimezone(UTC)` pinned by nothing, because `timestamptz` normalizes on the way back out
  (lessons §16 addendum) — plus 3 integration-tier tests that run the composed
  create → upcoming → .ics path over real HTTP. The
  `.ics` renderer lives in `app/services/ics.py`, deliberately free of DB imports, because #70's
  recruiter self-booking flow shares it. Admin UI ships in #292.
- **E2E coverage for every v1.12.0 user-facing surface** — the release shipped three screens whose
  only browser validation was "the suite didn't break". 18 tests, suite **97 → 115**: the public
  **contact form** (`e2e/public/contact-form.spec.ts` — server-rendered then hydrated, trimmed
  validators gating submit, the success contract, the API-failure path that keeps the visitor's
  text, a 390px phone viewport that fails on real horizontal overflow, and an accessibility pass),
  the admin **Inbox** (`e2e/admin/inbox.spec.ts` — empty state, list + expand-to-read, status
  filter round trip, inline status PATCH, promote hand-off, two-way pagination, and a load-failure
  state that must not read as an empty inbox), and the admin **Pipeline board**
  (`e2e/admin/pipeline.spec.ts` — all seven stage columns, card placement, detail panel, a stage
  move that asserts the card RELOCATING, a note added and repainted, quick-create rejecting
  whitespace-only fields, and a load failure that keeps the board frame visible).
  Every test was executed against a real prod-topology stack before commit, and the four review
  rounds mutation-checked the pins rather than trusting them: the zoneless repaint is pinned by
  the ERROR path (the success path passes with `markForCheck()` deleted, because `reset()`
  notifies the scheduler on its own), the relocation assertion fails when only the client-side
  move is removed, the viewport assertion fails on an injected 534px overflow, and the alert-copy
  assertions fail when the component's message changes. Review also caught two defects in the
  specs themselves: a Playwright glob `*` does not cross `/` (so a mocked PATCH escaped to the
  live backend and asserted nothing), and a fill racing hydration let Angular's `writeValue` wipe
  the typed values — both fixed, the latter with the `networkidle` barrier the other public specs
  already use.
- **Release retrospectives are now part of the release process** (owner directive) — a release is
  finished when what it taught is written down, not when the tag is pushed. New `release-retro`
  **skill** (the method: five questions, finding→action classification, and the rule that a retro
  producing no config change must say why), new **`/retro` command** (the runbook, including
  checking the PREVIOUS retro's prediction), `release-manager` gains step 12 and **may not report a
  release complete until the retro PR is open**, and `ai-integration` owns it as a scheduled duty.
  Every retrospective is archived as `docs/retrospectives/vX.Y.Z.md` with a **trend table** in that
  directory's README, so the numbers can be compared release over release rather than read once in
  an issue comment — with documented counting conventions, because v1.12.0 found the Project
  `Review rounds` field disagreeing with the actual thread and one issue filed under the wrong
  release (understating the release by ~11%).
- **The pre-push gate no longer contends for the shared test database** — it runs against its own
  `test_mavrov_prepush` with `-n auto`, which is also how CI invokes the suite. It previously ran
  SERIALLY on the shared `test_mavrov` and merely *detected* concurrent runs with `pgrep`, which
  samples only at start: an agent beginning a suite a second later still clobbered the gate, and
  two suites doing `drop_all`/`create_all` on one database produce dozens of spurious ERRORs that
  read exactly like real failures. It blocked four pushes in one session and each failure invited a
  blind retry rather than a diagnosis. Isolation beats arbitration (lessons §31).
- **Merge gate hook** (`.claude/hooks/pre-merge-gate.sh`, 77-case self-test plus a 17-mutation contract with an identity control, both run inside the pre-push gate) — refuses
  `gh pr merge` when the latest posted verdict is not an APPROVE (rule 13 was restated across **eleven files**
  as prose with zero mechanical enforcement), and when the PR body says `Closes #NN` against
  an issue with unticked acceptance criteria (a blocker in **four** v1.12.0 PRs, caught every time
  only because a review read the issue by hand). Command-position aware via the shared parsing
  model, fails closed on a deadline or an unreadable verdict, bypass with `PR_MERGE_GATE=0`.

### Changed
- **Dependency refresh (owner-directed into this release; Dependabot #301–#305 superseded)**:
  backend `ruff` 0.16.5→0.16.6, `google-genai` 2.20.0→2.22.0, `pydantic` floor →2.13.5; frontend
  Angular group 22.1.2/22.1.4→22.1.5 (CLI/build 22.1.7) + `zone.js` 0.16.3 + `@types/node` 26.4.1
  (lockfile regenerated in one pass per the exact-peer lesson — the regeneration also floated
  dev-deps `@playwright/test` 1.62.1→1.63.0 and `stylelint` 17.14.1→17.15.0 within their ranges);
  CI `actions/setup-python` v6→v7.
  All within current majors (rule 6). The vitest 4→5 trio (#306–#308) is a breaking major of the
  test runner and ships as its own deliberate effort after this release.
- **BREAKING for existing deployments — default database name is the product, not the maintainer (#288)**: every default that said
  `mavrov` now says `hirefolio` — compose (`${POSTGRES_DB:-hirefolio}`), the backend
  `database_url` default, CI's test/migration databases (`test_hirefolio`,
  `hirefolio_migrations`), the local test convention (`test_hirefolio`, `_gwN`, `_prepush` —
  pre-push hook, conftest guard message, docs and agent charters all follow), the admin SQL
  backup filename (`backup_hirefolio_*.sql`) and the agent worktree prefix. Completes the
  identifier half of #66: a forker no longer inherits anyone's name in their infrastructure.
  **Upgrade note (existing deployments only)**: Postgres reads `POSTGRES_DB` at volume init, so
  existing volumes keep their `mavrov` database — pin `POSTGRES_DB=mavrov` in that host's
  `.env` (documented in `.env.example` and `docs/DEPLOYMENT.md`); fresh installs need nothing.
- **The v1.12.0 retrospective's findings applied to the toolkit** — measured over 24 review
  verdicts: `issue-author` learns four rules for writing an acceptance criterion that can actually
  be met (one AC last release was unachievable as written; six of eight feature PRs shipped with a
  silently-unmet criterion); both dev charters replace an unconditional "the PR body must
  `Closes #NN`" with a deliberate Closes/Refs decision; `backend-dev` gains the E2E/integration
  instruction it never had (all 10 merged PRs closed with that evidence missing) plus the rule to
  mutation-check the fix that closed the *previous* round's blocker (itself a blocker five times);
  `pr-reviewer`'s charter said "engineering rules 1–8" while the repo has 13 — omitting rule 12 and
  rule 13, its own mandate; `/prep-pr` gains re-measure-every-number (all 10 merged PRs carried a claim
  that did not reproduce, nine at blocker level) and layer-evidence steps; **lessons §30** records
  the assert-the-guarantee-where-it-can-be-enforced class and the shared-session fixture that hides
  races. Two duplicated rule restatements deleted from the playbook and a drifted second copy of
  the config map deleted from lessons-learned — duplication is how the renumber drift happened.
- **Two engineering rules added, one renumbered** (owner directives 2026-09-06) — **rule 11: fix
  review findings IN the PR** rather than converting them into issues (a follow-up issue is for
  genuinely out-of-scope work only; backlog growth is not progress), and **rule 12: a merged PR
  means validated on every applicable layer** — backend unit, frontend unit, E2E in a real
  browser for user-facing surfaces, the WireMock integration tier for composed API/AI paths, and
  mocks for what nothing else reaches; if a layer doesn't apply, the PR must name it and say why.
  The independent-review gate moves from rule 11 to **rule 13** (every stale reference renumbered across CLAUDE.md,
  the affected charters, the skills and the shared playbook — verified by grep after a review
  caught one survivor in `env-gotchas`).
- **Pull requests must carry labels too** — the "no orphan issues" invariant (type + area +
  priority) now explicitly covers PRs, with the `gh pr create --label` recipe in the
  `issue-workflow` skill; several v1.12.0-era PRs shipped unlabelled because the rule only named
  issues.
- **Effort reports now record the MODEL per step** and Project 3 gains a `Model` field
  (`fable-5`/`opus-5`/`sonnet-5`/`haiku-4.5`/`mixed`), so cost, review rounds and defects caught
  can be compared per model rather than only per agent.

### Fixed
- **The zoneless change-detection lint now guards the ADMIN app too — and it immediately found
  five frozen-UI bugs** (#276). `frontend/scripts/check-cd-safety.mjs` scoped itself to
  `projects/public` on the written premise that "the admin app is zone-based CSR". That premise
  was false: `angular.json` gives the admin project no `polyfills` entry (no zone.js is bundled —
  `grep -rl __zone_symbol__ dist/admin/` returns nothing) and its `app.config.ts` provides no
  `provideZoneChangeDetection()`, so `@angular/core`'s `ZONELESS_ENABLED` default (`() => true`)
  applies. The lint now scans both roots (`CD_SAFETY_SCAN_ROOT` accepts several roots), the scope
  comment states the real, falsifiable reason, and the self-test pins the default scope
  (`--print-scope`) plus a violation planted only under an admin root. The five real defects it
  exposed, all fixed: the **LinkedIn sync status bar** never cleared after its 5 s timer; the
  **post editor** stayed stuck on "[ Saving… ]" with the error banner invisible when a save
  failed; the **profile** success banner never disappeared; the **admin sidebar username** never
  tracked login/logout (now rendered with `currentUser$ | async`); and the profile key-status
  badge gained an explicit `markForCheck()` so it no longer depends silently on an async pipe
  elsewhere in the template. Each fix carries a `*.zoneless.spec.ts` regression pin that opts its
  TestBed into `provideZonelessChangeDetection()` — a technique that lets unit tests see this
  class at all, now documented in the `ssr-cd-safety` skill along with the admin app's real
  zoneless status. **A sixth bug of the same class, which the lint cannot see**, was found by the
  review and fixed here too: `checkLoginStatus()` in `admin-linkedin.component.ts` assigns after an
  `await`, and the checker does not follow `await` (the documented #234 gap), so a connected
  operator kept reading "🔴 Not Connected" with the login form still up. Three layers were blind —
  the lint by that gap, the unit specs because they bundle zone.js, and the e2e spec because it
  always mocked the initial status as logged-out. **The widened lint is a floor, not a guarantee:**
  it covers `subscribe`/`.then()`/`setTimeout`/`setInterval` assignments, not `async`/`await` ones.
- **Integration/E2E verification stacks no longer evict the developer's test database** — the
  `docker-compose.inttest.yml` overlay publishes Postgres on **5533** instead of 5433. Prod
  compose published the same port the local pytest DB uses, so every verification stack silently
  took it and the next `pytest` (or pre-push gate) died with `password authentication failed for
  user "postgres"` — a symptom that looks nothing like a port conflict and cost real time three
  times in one session. Nothing inside the stack uses the host port; `POSTGRES_HOST_PORT`
  overrides the new default.
- **Promoting an inbox interaction is idempotent UNDER CONCURRENCY, keeps its origin, and shows it**
  (#279/#278/#277) — three #274 review findings fixed together because they live in one handler.
  **Idempotency:** a repeated promote (double-click, retry) returns the FIRST card instead of
  minting a second permanent one — phase 1 ships no DELETE, so a duplicate was forever; the
  guarantee is a DB-level UNIQUE on a new `opportunities.promoted_from_interaction_id`
  (migration `promote0005`, self-adopting, with a backfill from each card's promotion note so
  cards created before it keep their idempotency). An application-level check alone was NOT
  enough and a review proved it: `get_db` yields a fresh session per request, so two concurrent
  promotes both passed the check and created two permanent cards. The loser of a race now rolls
  back and returns the winner's card. The key lives on the opportunity rather than being derived
  from a note, because notes are admin-writable — a derived key could be forged to make promote
  return an unrelated card (both properties are pinned by tests, the race one through two
  sessions and a barrier). Documented consequence, pinned by a test: overrides passed to a repeat promote are
  ignored — changing a card is an edit, not a re-promote. **Origin:** the card's `source` now
  derives from the interaction through an explicit map (contact_form → recruiter_outreach,
  cv_request/booking → discovery, unknown → the default) instead of a hardcoded literal that
  mislabelled every CV request and corrupted the one dimension the pipeline exists to measure
  (#249); the unknown-source fallback is tested so a future channel (#263 messengers, #264 voice)
  cannot 500 the promote path before its mapping lands. **Refresh:**
  `db.refresh(attribute_names=["notes"])` replaces the post-commit re-select that returns the
  same identity-mapped instance with a stale collection (lessons §22) — it only appeared to work
  because `notes` had never been loaded.
  The admin **Inbox button now latches while its request is in flight** and — because the admin
  app is zoneless — explicitly repaints, so the operator sees "Promoting…" instead of a button
  that still looks idle; and the **pipeline card displays its source**, making the funnel
  dimension visible rather than merely stored.
  Validated on three layers per rule 12: backend unit (883 passed, 100%), the WireMock
  integration tier (idempotency and cv_request-origin over real HTTP through the proxy), and a
  new browser journey spec — inbox → promote → pipeline with the original message surviving as
  the first timeline note, plus double-click-yields-one-card and cv_request-keeps-its-origin.

### Security
- **Internal AI-tooling session identifiers must never reach public surfaces** (owner directive)
  — CLAUDE.md's issue-flow rule 8 (no secrets in public issues/PRs) and `agents/PLAYBOOK.md` now
  forbid writing `Claude-Session:` trailers or
  `claude.ai/code/session_…` URLs into commits, PR bodies, issues or the changelog on this PUBLIC
  repo (`Co-authored-by:` attribution stays). All 17 affected PR bodies were scrubbed; the
  repo-wide search now returns zero editable occurrences.

### Documentation
- **Docs re-synced with what v1.12.0 actually ships** — README's feature list now names the
  job-search half of the product (recruiter inbox, opportunity pipeline with promote-from-inbox)
  and the make-it-yours half (runtime configuration, guided setup, demo-persona default with the
  operator's must-set identity), instead of describing a portfolio-only site. The Testing section
  documents the real **four-layer** pyramid — backend unit, frontend unit, black-box integration
  (WireMock), E2E — with the rule that a merged PR is validated on every layer that applies, and
  states plainly that coverage percentage is not quality. The E2E inventory lists the suites that
  exist (115 tests) rather than a bare command, the WireMock tier gets its own section with the
  port caveat, and the tooling self-test list is corrected: `setup.test.sh`,
  `pre-push-tests.test.sh` and `check_no_pii.sh` were missing — **every documented command in
  that block was executed to confirm it runs** (19 and 11 cases, both hook self-tests, the proxy generator and the PII guard: all pass). `docs/DEPLOYMENT.md` drops the stale `1.9.0` examples and gains a post-deploy
  verification block for the new surfaces: confirm the identity is yours and not the demo
  persona, POST a probe to the contact form, and find it in the admin Inbox.

## [1.12.0] - 2026-09-06

### Fixed
- **Public E2E: language-switcher locators are exact-match** — `getByRole` name matching is
  case-insensitive substring, so the #69 German submit button "senden" (contains "en"/"de")
  collided with the EN/DE switcher buttons in strict mode and failed the post-merge Docker E2E
  (run 34009222801). `exact: true` pins the switcher; regression class: any German copy
  containing "en"/"de" — i.e. most of it.
- **The pre-push backend gate now enforces `--cov-fail-under=100` exactly like CI** (#69 review) —
  previously it printed the coverage number and passed regardless, so a push could be locally
  green while CI's Backend Tests failed the coverage gate ("verify that gates actually gate").
- **Destruction guard: many-segment cost reduced 4–10× on every measured shape** (#235) —
  `pipes_into_shell()` forked ~3 processes per separator-split segment with no budget check, so
  bulk alone defeated the guard regardless of parsing correctness: against the 15 s hook timeout
  (and a hook that times out does not deny), 5,000 `;`-segments took **36.8 s** and 11,000 pipes
  (22 KB) **80.4 s** — an unanalysed allow in production, identical on `main` since the function
  was added. Now: fork-free fast paths (pure-bash ltrim, blank-segment skip, whitespace collapse
  only when the segment actually contains whitespace needing it, `case`-based xargs test,
  `peel_wrapper` returning via the `PEEL_RESULT` global instead of a per-segment
  command-substitution subshell — ported into the shared `hook-parse-lib.sh` and all three call
  sites, both in the guard and one in the pre-push hook) plus a costless
  per-segment `$SECONDS` budget. **Measured, same shapes: 7.9 s and 7.9 s**; a bulk command with
  a real destruction payload 41.0 s → 7.8 s, its double-spaced variant 31.5 s → 7.9 s; an ordinary
  100-command line still allows (2.9 s → 2.2 s). The budget now fails closed through the **cheap**
  path: past the deadline `pipes_into_shell` returns 1 and the unconditional main pass denies via
  `inspect_segment`'s own deadline check, instead of routing thousands of segments into the payload
  pass — which forks ~3× per segment and could only reach the same denial (17.6 s → 7.9 s on the
  double-space shape); that pass also gained the deadline `break` the other pre-inspection loops
  already had — without it a 10 KB bulk command carrying a piped-shell payload answers at 17.9 s
  instead of 7.1 s, i.e. past the timeout. Suite 269 → **279 cases** with a new `check_within`
  helper that asserts decision **and** wall clock together — the previous helpers each asserted
  only one half, which is how a destroy-tail pin passed against the unfixed hook at 36 s (a deny
  production would never see). All five cost pins fail against the pre-fix hook (34 s / 75 s /
  34 s / 20 s / 50 s), and the piped-shell-payload pin also fails against a mutant of THIS change
  with only the payload-pass `break` deleted (17.9 s), so the `break` is pinned failing-first
  rather than merely asserted. Two decisions change anywhere, both now covered by cases:
  `… | /bash` allow → **deny** (the basename strip no longer needs a second `/`) — fail-closed and
  intended; and `… | bash` followed by a lone `\r`/`\v`/`\f`, which the narrower collapse trigger
  briefly turned deny → allow — restored to `deny` by matching the replaced `sed`'s full
  `[[:space:]]` trigger set (unexploitable, since bash does not word-split on those, but a silent
  decision change all the same). Four
  pre-existing `pipes_into_shell` bypasses found while measuring this (`| \bash`,
  `| /usr/bin/env bash`, `| /usr/bin/sudo bash`, `| /usr/bin/timeout 60 bash` — all identical on
  `main`) and the payload pass's remaining per-segment forks are **not** fixed here; they are
  tracked in **#253**.

### Added
- **Live-freshness gate: "green pipeline" can no longer impersonate "live site"** (#169) — a new
  scheduled `Live Freshness` workflow (daily + on-demand, no secrets needed) probes the live site
  and FAILS RED whenever live ≠ released, via the shared `scripts/check_live_freshness.sh`
  (its second caller is the deploy pipeline's health gate; wiring `/deploy-status` to it is #280): `backend_version` from `/api/app/stats/public` must equal
  the repo `VERSION`, and public `/admin/login` must 404; verdicts are distinct — 0 fresh /
  1 stale / 2 unreachable (an outage is not a pre-split frontend), and staleness evidence
  beats an outage headline in mixed states (a 200 proves a pre-workspace-split
  frontend image, the exact shape of the five-month v1.2.27 staleness). This is the independent
  alarm for the #112 published≠live gap: the deploy pipeline's own gate only runs when the
  secrets-gated rollout actually rolls the host, so a skipped rollout previously left NO signal.
  The deploy-time gate itself also gained a version probe (live `backend_version` == released
  `VERSION`, with warm-up retries) on top of its existing digest + health + route-shape checks.
  `CLAUDE.md` no longer describes a host rollout the pipeline doesn't perform.

- **Site configuration layer: identity is env config, not code** (#65) — a forker rebrands a
  PREBUILT image without rebuilding anything: the backend gains `SITE_NAME`/`SITE_URL`/
  `OWNER_NAME`/`OWNER_HEADLINE`/`OWNER_DESCRIPTION`/`SOCIAL_LINKS`/`HIREFOLIO_ANALYTICS_ID`
  settings and a public `GET /api/app/config/site` endpoint; the public app fetches it at runtime
  (new `SiteConfigService`, shareReplay, neutral fallback when the backend is down) and threads it
  through `SeoService` (title/description/canonical/OG/JSON-LD author+sameAs), the footer ©, the
  home-page `Person` JSON-LD, and Google Analytics (id now runtime-config, allow-list sanitized
  before touching the inline script; empty = analytics off, no id baked into the bundle anymore).
  The API's CORS allowlist now actually honours the `cors_origins` setting (it existed but the
  middleware hardcoded the list), API title/root message derive from `SITE_NAME`, and the
  CV-request email copy uses `OWNER_NAME`. The payload deliberately does NOT include the admin
  email — it doubles as the admin login username (review finding). SEO strings compose off the
  config stream so SSR meta never bakes the placeholder in, and a not-found page keeps its
  not-found title (#109) across the config arrival. Identity defaults preserve the canonical
  deployment's values; the anonymized demo defaults land with #66, and `sitemap.xml`/`robots.txt`
  generation is #71's generator. **⚠ Operator action:** analytics now defaults to **OFF**
  (opt-in for a general-portfolio template — and a non-empty default was unreachable through
  compose anyway): set `HIREFOLIO_ANALYTICS_ID=<your G-… id>` in the host `.env` **to keep GA**;
  the id no longer lives in the Angular environments or anywhere in source.

- **Onboarding: clone → one command → running site** (#61) — new `./setup.sh` wizard (idempotent;
  `--defaults` for non-interactive): creates `.env` from the sample, generates strong secrets
  (JWT signing key, admin password — never overwrites existing values, never committed), prompts
  for the owner identity consumed by the #65 runtime site config, starts the stack and waits for
  the backend health gate. An **MIT `LICENSE`** lands at the repo root (the repo previously said
  "private and proprietary" while being publicly forkable — legally unusable as a template);
  `backend/.env.example` now documents EVERY key `app/config.py` consumes (was 3 lines) with safe
  placeholders; the README quickstart leads with the one-command path plus a config-only
  "make it yours" checklist, and the contact section no longer hardcodes the maintainer's
  personal details. Review hardening (#256): the dev compose now forwards `ADMIN_PASSWORD` (the
  generated password previously never reached the container — the backend refused to seed while
  the wizard printed unusable credentials); the `.env` helpers mend a missing trailing newline
  before appending and treat whitespace/CR-only values as unset (no 1-byte secrets); both guards
  are pinned failing-first by a new `setup.test.sh` (11 cases) wired into the pre-push docs leg
  AND the CI Version Consistency job;
  the root `.env.example` gains the #65 identity block; `setup.sh` is explicitly scoped as the
  LOCAL quickstart (servers use `docs/DEPLOYMENT.md`).
- **A serious integration & performance test tier — WireMock + JMeter** (#260) — the testing
  pyramid gains its missing middle: `./run_integration_tests.sh` boots the stack with a
  `docker-compose.inttest.yml` overlay where the `ollama` service **is WireMock** (same
  hostname/port — the real model server never boots), then runs black-box tests in
  `backend/tests_integration/` over real HTTP: composed-system health, proxy routing, the
  pgvector post round-trip (create → list → slug → semantic search, embeddings served by the
  stub), and the AI boundary with **fault injection** (`__wiremock_slow__`/`__wiremock_error__`
  markers hit delay/500 mappings — fault injection is PROVEN to traverse the real boundary
  (the 8 s delay is observed end-to-end), the groundwork for asserting #207's timeout/fallback
  budgets at this tier —
  credential-free — rule 10 by construction). `backend/perf/smoke.jmx` + `run_jmeter.sh` add
  Dockerized JMeter load smoke with **executable latency budgets** (Duration Assertions; the
  runner exits non-zero on violation). `README_TESTING.md` documents the tier contract and names
  the old in-process `tests/integration/` for what it is (workflow unit tests). The tier is
  **wired into the pipeline**: a new `Integration Tests (WireMock Stack)` job runs on every push
  to `main` in parallel with the browser E2E — same built images, but with no model pulls
  (WireMock stands in for the model server) — and all four publish jobs now gate on it, so a red integration tier blocks
  publishing exactly like a red E2E. Unit suites and their coverage gates are untouched.
  Lessons-learned §22–26 record the session's ORM/migration/compose/test-pinning footguns, and
  `backend/conftest.py` now REFUSES any non-`test_*` database (lesson §4, enforced in code after
  it recurred in practice).

- **Job-search pipeline: run the search from your own admin panel** (#247, phase 1) — new
  `Opportunity` + `OpportunityNote` models and `pipeline0004` migration (with the pre-Alembic
  self-adopt guard): one company/role thread per opportunity, moved through explicit stages
  (lead → contacted → screening → interviewing → offer → closed won/lost) with every stage move
  recorded on a notes **timeline**; free-form remarks attach to the thread. The admin panel gains a
  **Pipeline board** (cards by stage, quick-create, detail panel with timeline + stage control +
  next-action), and the Inbox gains **↗ Promote to pipeline** — one click turns a recruiter
  interaction into an opportunity, carrying the message as the first note and the recruiter's
  contact onto the record (the interaction advances new → in_progress, never regressed). 17 backend
  + 17 frontend tests; backend 100%, all three frontend projects 100%. Interviews/calendar and CV
  variants are #247's later phases.
- **Recruiter communication hub: a unified inbox — no recruiter contact is ever missed** (#69) —
  the first piece of the Job-search CRM milestone. New `Interaction` model + `inbox0003` migration:
  every inbound touch is ONE indexable record with `source`, a status workflow
  (new → contacted → in_progress → closed), and a JSON payload for source-specific extras. The
  public site gains a real **contact form** (terminal-styled, EN/DE, validated) posting to
  `POST /interactions/contact`; **CV requests are now indexed into the same inbox**
  (`source=cv_request`, linked to the domain record); the owner gets an email per interaction via a
  new generic `EmailService.send_interaction_notification` (background task, skips gracefully
  without SMTP, can never block intake). The admin panel gains an **Inbox** view — filter by
  status/source, expandable messages, inline status control, pagination. Review hardening (round
  1): the public endpoint is **rate-limited per client IP** (`CONTACT_RATE_LIMIT_*`, tight
  write-budget defaults — it costs a DB row + an owner email per request), outbound SMTP gained a
  `SMTP_TIMEOUT_SECONDS` bound (a hung peer no longer pins a worker thread), and input is
  normalized server-side (whitespace-only rejected, line breaks in header-bound fields folded so
  a newline in `name` can't kill the owner's notification, lengths mirror the form's validators);
  the form states its privacy contract (EN/DE). 30 backend + 24 frontend tests around the
  feature; all three projects stay at 100% coverage.

### Changed
- **The repo ships an anonymized demo persona — no more real résumé, photo, CV, or third-party
  recommendations in source control** (#66) — `profile_data_en.json`/`_de.json` are now the
  fictional "Jane Doe" (schema-identical, so every consumer keeps working), the ~15 real
  third-party recommendations with their LinkedIn URLs (third-party PII) are replaced by two
  clearly-fictional demo entries, `backend/app/static/cv.pdf` is a generated demo CV,
  `assets/images/profile.png` is a neutral initials avatar (7 KB vs the 718 KB personal photo),
  and the i18n consent copy names "the site owner" instead of a person. Real content is strictly
  bring-your-own via the existing admin uploads (Profile Data + CV Manager). Review round 2
  finished what the fixtures alone couldn't: the #65 CONFIG DEFAULTS are now the demo persona too
  (a fresh stack no longer renders the real owner's title/JSON-LD over a Jane Doe hero — the
  canonical deployment sets its identity in the host `.env` like any forker), the terminal-style
  `author:`/`-rw-r--r--` usernames derive from the runtime identity, the scrapers REQUIRE
  `PROFILE_URL` instead of defaulting to a personal profile, spec/E2E fixtures are neutralized,
  and a new **PII guard** (`scripts/check_no_pii.sh`) runs in the pre-push gate AND the CI
  Version Consistency job — reintroducing an identifier now fails the pipeline.
  **⚠ Operator action (any real deployment, BEFORE this release reaches the host):** the identity
  DEFAULTS flipped to the demo persona — set `SITE_URL`, `SITE_NAME`, `OWNER_NAME`,
  `OWNER_HEADLINE`, `OWNER_DESCRIPTION`, `SOCIAL_LINKS` in the host `.env` (alongside the #65
  `HIREFOLIO_ANALYTICS_ID`). An unset `SITE_URL` now means the SSR HTML advertises
  `og:url`/`og:image`/canonical/JSON-LD `url` pointing at `https://example.com` — actively wrong
  SEO signals from a real domain (the static `sitemap.xml`/`robots.txt` still carry the canonical
  domain until #71's generator). Also: the public profile falls back to these committed
  assets when no profile was uploaded via the admin panel — before rolling this release onto a
  host that relies on the fallback, upload the real Profile Data JSON and CV in the admin UI,
  or visitors will see the demo persona.

## [1.11.1] - 2026-09-05

### Added
- **Plugin curation is documented, not tribal** (#122) — CLAUDE.md now records a keep-rationale
  for each of the five kept plugins (context7, pyright-lsp, typescript-lsp, security-guidance,
  frontend-design — the last flagged conditional on #67), a recorded evaluated-and-not-added
  decision (commit-commands, claude-md-management, code-review) so candidates aren't re-researched,
  a release-time review cadence wired into the `/release` runbook and the `release-manager` agent,
  and a deliberate DEFER on packaging the repo's agents/commands/skills as a `mavrovde-toolkit`
  project plugin — right end-state for the template product, premature while this repo is its only
  consumer; tracked as #244, trigger = the first real fork user (milestone #2). The curation pass
  also **dropped the `playwright` plugin**: it ships only an MCP server identical to the committed
  `.mcp.json` entry, so both being enabled loaded every browser tool twice; the `.mcp.json` server
  stays and browser automation is unchanged.

### Fixed
- **Dead CVE-2024-6345 "patch" removed from the backend image build** (#239) — the Dockerfile ran a
  `sed` over `package_index.py`, but setuptools stopped shipping that module (verified against the
  83/84 wheels), and `find -exec … +` with zero matches exits 0 — the layer always "succeeded"
  while patching nothing: a dead security control giving false assurance. The real control is the
  requirements pin (fixed in 70.0.0; we pin 84). Replaced with a fail-loud guard: the build now
  ERRORS if `package_index.py` ever reappears (i.e. a downgrade below the fixed version) — verified
  in both directions locally (absent → passes; present → fails).

- **Pre-push hook: the self-gate is now command-position aware** (#237) — the hook decided "this is
  a push" by raw substring match on the tool-call text, which was wrong in both directions: quoted
  PROSE mentioning `git push` (e.g. a `gh pr review --body-file` whose review text quoted a push
  command — hit in practice during the #211 review) triggered the full docs+backend+frontend gate,
  while a real push spelled without the literal substring (`git -C <dir> push`) was never gated.
  The gate now fires only when a segment's COMMAND — after quote-aware splitting, compound-keyword
  (`do`/`then`/…) and wrapper peeling, and `bash -c`/`eval`/`ssh` unwrapping — is `git` with a
  `push` subcommand; quoted text is data. The parsing model is the destruction guard's, extracted
  verbatim into a shared `.claude/hooks/hook-parse-lib.sh` sourced by BOTH hooks (lessons-learned
  §21.12: one model of the input — all 269 guard self-test cases pass unchanged). A new
  `pre-push-tests.test.sh` self-test (52 cases, wired into the check round's guardtest leg) pins
  both directions plus cost and polarity: input the analysis cannot finish (size/depth/time bounds)
  GATES — a redundant check round, never a skipped one. Mutation check: reverting to the old
  matcher fails 17 cases (15 prose false-gates, 2 missed real pushes).

## [1.11.0] - 2026-09-05
> **⚠ Operator action required before the next rollout:** #141 renamed the Gemini
> configuration keys with no fallback alias — set `HIREFOLIO_GEMINI_API_KEY` and
> `HIREFOLIO_GEMINI_ENCRYPTION_KEY` in the host `.env` (the old `GEMINI_API_KEY` /
> `GEMINI_ENCRYPTION_KEY` names are ignored; the backend logs which ignored legacy names it
> sees). Without the rename the AI features silently degrade to the local Ollama fallback —
> this does not fail closed. Details in the #141 entry under *Changed*.

### Added
- **`/deploy-status` command** (#120) — one command that reports the TRUE deploy state: latest
  `deploy.yml` run + whether the secrets-gated rollout job ran or silently skipped, repo
  `VERSION`/latest tag, published image tags, and the LIVE prod version from
  `/api/app/stats/public` — ending in an explicit live/behind verdict. Bakes in the
  published ≠ live doctrine (#112): a green pipeline publishes images; only the rollout job (or the
  live version itself) proves the host updated. The `devops-pipeline` charter now also names the
  #147 concurrency queue (deploys serialize, never overlap) and points at `/deploy-status`.
- **The quality gates now run on pull requests, not only after merge** (#208) — `deploy.yml` was
  `on: push: branches: [main]` only, so a PR was checked by CodeQL alone and the first time CI
  evaluated whether a change was correct was on the branch that deploys to production. A failing test
  did not fail *review*; it failed the *deployment*. Lint, types, security, unit tests, migrations
  and version-consistency now run on `pull_request` as well, while every build/publish/deploy job is
  gated on `github.event_name == 'push'` so a PR can never publish an image or reach the prod host.
  No PR-running job reads a repository secret, which keeps fork PRs working and keeps rule 10 intact.
  Found during the independent review of #205, where an environment-dependent "100% coverage" claim
  reached the merge gate because nothing in CI would have caught it.
- **CLAUDE.md AI-config map** (#121) — a one-glance index of every agent, command, skill, hook,
  plugin and MCP server in the repo, so a fresh session orients instantly instead of rediscovering
  the tooling; the milestone-buckets list now includes **AI-assisted development & agents**
  (milestone #7, area `ai-config`). Housekeeping: pruned the stale `.claude/worktrees/agent-*`
  checkout left by a worktree-isolated agent (its #123 fix landed on `main` as 949b0cb via #155;
  verified clean + content-merged before removal) — the path stays gitignored.
- **`ssr-cd-safety` skill + `lint:cd-safety` check** (#118) — the zoneless/SSR silent-failure class
  (#94: properties assigned in subscribe/interval callbacks never repaint; unit tests bundle
  zone.js and cannot see it) is now (a) a committed skill stating the contract — async mutation ⇒
  `async` pipe | signal | `markForCheck()`; SSR URL rewrite lives in an `HttpBackend` delegating to
  `HttpXhrBackend`, never `FetchBackend` — referenced from the `frontend-dev` and `pr-reviewer`
  charters, and (b) a dependency-free checker (`frontend/scripts/check-cd-safety.mjs`, run as
  `npm run lint:cd-safety` and in the pre-push gate) that flags imperative-callback `this.*`
  assignments in `projects/public` with no repaint path, with a required-justification
  `// cd-safety-ok: <reason>` escape. It found one real site on `main` (`blog.component.ts:89`,
  SSR-only — now carrying its justification). The workspace has no ESLint today; adopting
  angular-eslint is registered as a separate deliberate effort rather than smuggled in here.
  Also corrects the stale "no zoneless provider" claim in BOTH charters that carried it
  (`pr-reviewer.md`, and `frontend-dev.md` found by the round-1 review — zoneless is explicit since
  #105). The round-1 review (rule 11) drove four more fixes: the checker now strips comments before
  its repaint decision so PROSE mentioning markForCheck can never satisfy it (suppression rides the
  explicit `cd-safety-ok:` marker only), `.then(` joined the trigger set (an `await` continuation
  remains the documented blind spot for the #234 AST lint), a 9-case fixture self-test
  (`check-cd-safety.test.mjs`) pins the parser both directions, and an `npm run lint` script now
  exists — which makes CI's previously no-op `Frontend Lint` job (`npm run lint --if-present`)
  actually run the self-test + checker on every PR.
- **`/prep-pr` command + `env-gotchas` skill** (#119) — the pre-PR hygiene gate: stale-`main`
  detection (the #103/#104 duplicate-CHANGELOG cause), single-`[Unreleased]`-block check, a
  stale-old-behavior-assertion sweep across the WHOLE spec tree (the #108→#110 deploy-red cause),
  `Closes #NN` linkage, a gates summary, and a secrets sweep. `env-gotchas` writes down the
  platform pitfalls that kept costing cycles — macOS has no `timeout`, BSD `grep -E`/`sed -i ''`,
  zsh-vs-bash differences, `.env`-sourcing noise, the same-identity `gh pr review --approve` block,
  the full-sha `gh release create` requirement, shared test-DB rules, and worktree pre-push-hook
  symlinks — referenced from CLAUDE.md.
- **`/e2e` command + `e2e-validation` skill** (#117) — the known-good full Docker E2E loop, codified:
  prod-topology bring-up, a REAL readiness gate (backend health → SSR → `stats/public` 200, which is
  what prevents the pre-schema `relation "profile_snapshots" does not exist` 500 race), in-container
  seeding, whole-project Playwright runs, and the recurring traps written down — the open-webui
  volume/schema crash-loop (bump the image pin forward, NEVER wipe the volume — rule 9), the
  reproduce-on-clean-main triage rule, and the 10443 HTTPS port. `frontend-dev` and
  `devops-pipeline` charters now point at the skill instead of re-deriving the steps.
- **Agent playbook has a single source of truth** (#115) — the shared team discipline that was
  hand-duplicated across `agents/common/roster.py` (`PROJECT_PLAYBOOK`) and implicitly restated in
  the 7 `.claude/agents/*.md` charters now lives in ONE committed file, `agents/PLAYBOOK.md`
  (extracted byte-identically). `roster.py` loads it at import (failing loud if missing), every
  charter opens with a reference block naming it as authoritative, and a new drift check
  (`agents/tests/test_playbook_sync.py`) fails when the roster stops consuming the file, the file
  loses a load-bearing section, or a charter drops the reference — mutation-checked (removing a
  charter's reference fails exactly that test; appending a probe line to the playbook propagates to
  `PROJECT_PLAYBOOK` with zero other edits). The round-1 review (rule 11) hardened it further, all
  fixed here: the drift check compared CONTENT only, so a byte-identical re-inlined duplicate passed
  undetected — a source-level assertion now fails if `roster.py` carries the playbook text inline;
  ALL seven charters' verbatim rule-9/rule-10 blocks now carry only a
  pointer plus their role delta (round 2 finished the remaining four); and the sync test actually RUNS somewhere — wired into both the
  pre-push hook's backend leg and CI's Backend Tests job (it previously gated nothing — §18,
  verify-that-gates-actually-gate).
- **Operational timeouts and bulk-import caps are configurable from `.env`** (#207) — the LLM request
  ceiling was the literal `300.0` repeated at five call sites, and the Ollama liveness probe used a
  different budget in each of the three places it appears (10 s at startup, 5 s in multi-chat, 2 s in
  the stats endpoint, where it decides the reported AI status). These values are host-dependent by
  nature: a cold model on a small VPS needs a long ceiling, while a fast host would rather fail fast
  than hold a worker. They are now `Settings` fields, each defaulting to the exact literal it
  replaced, so an unchanged `.env` reproduces the previous behaviour. The bulk posts-JSON import
  guards got the same treatment — they were module constants while their `import_max_image_mb`
  neighbour was already configurable, so an operator could raise one cap but not the other.
  Pagination defaults, `max_turns`, and text truncations were deliberately left alone: they are
  per-request parameters or presentation rules, not host-dependent operations, and moving them would
  add configuration surface without giving an operator anything actionable.
  The round-1 review (rule 11) caught two blockers, both fixed: the knobs were readable from a bare
  `.env` but never FORWARDED into the backend container (neither compose file has an `env_file`; the
  ten variables now follow the `IMPORT_MAX_IMAGE_MB` explicit-forwarding pattern in both
  `docker-compose.yml` and `docker-compose.prod.yml`), and the multi-agent conversation pre-flight
  had silently moved from its historical 5 s to the 2 s stats-healthcheck budget — it now has its
  own `ollama_preflight_timeout_seconds` (default 5.0, the literal it replaced), pinned by a test
  that fails if the call site is reverted to the healthcheck field (the previous test recorded the
  timeout but asserted only the stream sentinel — a §16 mutation-survivor).

### Fixed
- **Dev compose now passes `LINKEDIN_IMPORT_TOKEN` into the backend** (#228) — prod compose forwarded
  it; the dev stack never did, so a token set in `.env` per `.env.example` still produced
  `401 Import requires a valid X-Import-Token` from the local importer (the backend saw an empty
  configured token, which `_import_authorized` rightly never accepts). Verified live: with the fix
  the container's token matches `.env` (sha-compare) and `python -m importer` imported 7 posts
  against `http://localhost:8000`; an empty token still 401s token-only requests.
- **Destruction guard: six standing bypass classes addressed — five closed, #219 partially (kept open, residual in #235)** (#212, #213, #217, #218, #219, #220) —
  all pre-existing on `main`, found across the #206/#214 review rounds; every one is the same
  recurring root cause (the guard recognised a textual *framing* while the shell executes an
  *effect*):

  1. **Bulk alone defeated the guard** (#219). The quoting scan is pure bash and ran before the
     wall-clock deadline could see anything, so a ~40 KB command outlived the hook's 15 s timeout —
     and a hook that times out does **not** deny. Two halves: byte-wise scanning (`LC_ALL=C`; bash's
     `${s:i:1}` is O(n) per access under UTF-8, making the loops quadratic — measured 24 KB
     7.9 s → 2.2 s), and an input-size bound (`GUARD_MAX_CMD_LEN`, default 24000, measured not
     guessed) that **denies** above the bound — refusing to analyse must never mean allowing.
     Pinned with wall-clock assertions, since correctness tests cannot see a decision that is right
     but late.
  2. **Wrappers outside the unwrap allowlist ran uninspected** (#217). `nice`, `ionice`, `stdbuf`,
     `setsid`, `timeout`, `chrt`, `taskset`, `busybox` and `doas` each run the command that follows
     them unchanged; `nice <docker volume rm>` passed in both the direct and the piped-into-shell
     shape. One shared `peel_wrapper` model now serves `inspect_segment` and `pipes_into_shell`
     (two functions enforcing one invariant must share one model of the input), consuming options,
     the separate-token values of value-taking flags (`nice -n 10`, `timeout -k 5`, `sudo -u root`)
     and the bare duration/priority/mask operands (`timeout 60`, `chrt 50`, `taskset 0x1`).
     `timeout 60 npm test`, `nice -n10 npm run build`, `ionice -c3 rsync` stay allowed.
  3. **`' -execdir? '` never matched plain `find -exec`** (#218) — in ERE the `?` binds to one
     character, so the pattern read `-execdi` + optional `r`. Now `-(exec|ok)(dir)?`, covering the
     `-ok`/`-okdir` interactive twins too, and gated on the segment's command *being* `find` so the
     widened pattern cannot fire on a commit message that merely quotes a `find -exec …` line.
  4. **ANSI-C quoting and a leading backslash evaded the command-position check** (#213). `$'…'` is
     a third quoting model (its `\'` is an escaped quote *inside* the region, its `\n` expands to a
     real newline before execution); `quote_split`, `mask_quotes` and `quoted_payloads` all learned
     it, and `bash -c $'…'` bodies are unwrapped. A leading `\` on the command word (alias
     suppression — `\docker volume rm` runs docker all the same) is stripped before the anchored
     rules run.
  5. **A "document" the same command then executes is a script** (#212). The #204 heredoc exemption
     held all four of its conditions for `cat > s.sh <<'EOF' … EOF` + `bash s.sh`, so the body was
     skipped while it plainly runs. The write target (last `>`/`>>` redirect operand, or `tee`'s
     operand) is now tracked: when any line outside the body executes it — `bash`/`sh`/`zsh`/`dash`/
     `source`/`.`/`exec`, a `./t` path execution, or a `chmod` touching it — the body stays fully
     inspected. Prose written to `notes.md` and then merely `git add`ed stays exempt.
  6. **Unquoted pipeline payloads and other shell spellings** (#220). `echo <destroy> | bash`
     executes identically to the quoted form but produced no quoted payload, so nothing inspected
     it — a text-tool producer's unquoted remainder (quotes masked out, so prose stays prose) is now
     read as code. The `-c` unwrap also matched only the immediate `bash -c`: `-lc`, `-e -c`,
     `--login -c` and the `bash <<< "…"` here-string all hid the script, and all are now unwrapped.

  Suite 177 → **253 cases**, all green; every fix mutation-checked (reverting each fails exactly its
  own cases: `-execdir?` 3, wrapper list 17, ANSI model 1 + unwrap strip 2, backslash strip 3, size
  bound 2, write-then-execute 6, unquoted payloads 2, shell spellings 6, review-round-1 fixes 10) and
  each bypass shape proven to actually execute with a harmless `touch` payload before being counted.
  Knob: `GUARD_MAX_CMD_LEN` (default 24000; non-numeric overrides fall back rather than disarming
  the bound).

  The independent round-1 review of this PR (rule 11 — the sixth consecutive guard round where
  review caught the fix regressing the guard, lessons-learned §21) found and this revision fixes:
  the first #212 fix forked greps per line per heredoc (O(heredocs×lines), 27 s on a 2.2 KB
  command — past the 15 s hook timeout, i.e. the #219 bypass reintroduced; now one join + one grep
  per target, deadline-checked and DENYING at the budget), the ANSI-C quote marker was the in-band
  character `A` (a literal A inside `$'…'` closed the region early — bypass one way, #204-class
  false denial the other; now the out-of-band control char `\x02` like `NL_SENTINEL`),
  `heredoc_write_target` missed `2>err.log` second redirects / redirects after the heredoc word /
  quoted targets (now ALL redirect operands, quote-dropped, heredoc word removed not truncated),
  `bash <<<'x'` (no space), `-cx` clusters and `-o posix -c` evaded the #220 arms (widened), and
  `env -S` consumed the command as its flag value (env's `-S` value IS the command; no longer
  consumed). All ten review findings are pinned by tests that fail against the pre-review revision.

  Round 2 of the review confirmed all round-1 fixes by re-measurement and found one further blocker
  plus three residuals, all fixed here: the #212 execution scan violated the guard's own
  command-position principle (a bare space admitted `.`/paths in ARGUMENT position, chmod matched
  any mode, and fd-redirect operands became "targets" — five ordinary doc-writing commands like
  `git add . notes.md` and `chmod 644 notes.md` went allow→deny, the #204 class; now
  separator-anchored and execute-mode aware), the heredoc machinery's internal deny ran inside a
  command substitution and FAILED OPEN (its JSON captured, its exit killing only the subshell — now
  it reports "keep inspecting" and the main pass's deadline denies), the terminator search forked a
  sed per line (O(lines²) spawns, 52 s at 3.8 KB of unterminated heredocs — now a pure-bash ltrim
  with an in-loop budget hand-through, 19 s → 7 s on a 90-block shape, wall-clock pinned), and
  `bash -c -- "…"` hid the script behind the option terminator. Suite **263 cases**; the new pins
  fail against the round-2 revision (9 both-direction cases + the cost pin isolating at 19 s vs 7 s).

  Round 3 confirmed all of that by re-measurement (0 differences vs `main` in either direction on a
  119-command corpus) and falsified the last cost claim with two NON-heredoc bulk shapes — ~19 KB of
  env-assignments (22 s) and 12 KB of xargs options (18 s), both under the 24 KB size bound, both
  past the 15 s hook timeout: the token-peel loops forked 2–3 processes per token after the one
  deadline check they passed, and every existing cost pin was heredoc- or nesting-shaped, which is
  why it survived three rounds. Fixed by collapsing each peel loop into ONE sed pass (reviewer-
  validated: identical remainders; measured 22 s → 1.2 s), a fork-free bash-regex valflags match, and
  a costless `$SECONDS` budget check inside the unwrap loop. The single-pass bypass check now honors
  `GUARD_DESTRUCTIVE=0` anywhere in the leading assignment RUN — the same set the loop tested one
  head at a time (pinned). Suite **269 cases**; the two new wall-clock pins fail against the round-3
  revision, and the destructive-tail-behind-bulk direction is pinned deny.
- **The destruction guard no longer lets a benign first token hide a packed command** (#210) — the
  guard inspects the FIRST token of each segment, so two everyday shapes slipped past on `main`:

  1. Separators packed inside a shell wrapper's quoted argument —
     `bash -c "echo hi; <docker volume rm>"`. The outer quote-aware split correctly protects those
     separators *because they are inside quotes*, so the whole script arrived as one `echo`-led
     segment. A wrapper's argument is now re-split as the script it is, not read as one command.
  2. A pipeline whose final stage is a shell reading stdin —
     `printf "%s" "<destroy>" | bash`. Neither segment is dangerous alone: `printf` is a text tool
     and `bash` by itself destroys nothing. But the construct means "execute this text", so quoted
     payloads earlier in such a pipeline are now read as code.

  Same root cause as the #204 rounds, and the same rule applies: what the guard inspects has to be
  what the shell executes. Verified in both directions — running the final suite against `main`'s
  hook gives **24** differences: **21** are `allow → deny` (bypasses closed) and **3** are
  `deny → allow` — false denials `main` had, where a wrapped teardown of a scratch `test_*` database
  was blocked. That is the one destructive operation rule 9 explicitly authorises, and it was being
  denied on this repo's own prescribed test loop: unwrapping strips a wrapper's leading quote but not
  its trailing one, so the inner body ended in a stray quote and rule 4's `([ ]|$)` boundary stopped
  recognising the name as a test database. Rule 5 was hardened for exactly this in #188; rule 4 was
  not. Suite **112 → 177 cases**; a 33-command benign corpus stays fully allowed.

  Mutation-checked (mutant definitions stated so the numbers are reproducible): making
  `pipes_into_shell` return false fails **13** cases, `needs_flat_pass` always true **1**, removing
  the flattened-body fall-through **10**, the script-operand check **4**, an option VALUE read as a
  script operand **2**, ignoring the line-continuation flag **3**, removing the deadline check **2**,
  removing the depth deny **2**, reverting rule 4's boundary **5**, and removing the option-value
  strip **1**. Measured against a generated cross-product (destructive and benign cores × 14 wrapper
  shapes, 266 commands) rather than a curated list — a hand-written corpus keeps agreeing with
  whoever wrote it: **0** real bypasses introduced, **0** real false denials introduced, 72 bypasses
  closed, 3 false denials removed.

  Two of those conditions exist because review caught this change making the guard *worse*, and both
  are worth recording rather than smoothing over. Replacing the flattened-body pass with the new
  inner-script pass looked like a strict improvement but was not — `quote_split` treats `(`, `)` and
  backtick as separators, so a command substitution inside an invocation fragments it and the
  multi-condition rules never see all their conditions at once; six protected paths went
  `deny → allow`. And phrasing the shell test as "any shell that is not `-c`" made it a **negation**,
  which denied `bash <script> && git commit -m "…"` — this repo's own pre-push-then-commit flow —
  because a script-file operand reads a file, not the pipe. The forms that genuinely read the
  pipeline are now matched explicitly.

  **The analysis is now bounded, because cost here is a security property.** The hook has a 15 s
  timeout, and a hook that times out does **not** deny — so an analysis that is too slow is itself a
  bypass. Review found the cost was `2^depth`: the flattened-body pass re-descended the same subtree
  the inner pass had just walked. A depth-9 nest followed by a destruction took **25 s** where `main`
  decides in **153 ms**, i.e. an effective allow on a protected path. Two bounds now: the flattened
  pass runs only when it can help — when the body contains `(`, `)` or a backtick, or the command uses
  a line continuation (bash joins those lines into one invocation while the inner pass splits on the
  newline; a *bare* newline genuinely terminates the command, so splitting there is correct) — and a
  wall-clock deadline stops analysis entirely. Both **deny** when hit; refusing to
  analyse must never mean allowing. Being wall-clock, that bound is load-dependent: under heavy
  load a large command can be denied that would be allowed on an idle machine. The direction is
  deliberate — deny, never allow — but the non-determinism is real and is recorded here rather
  than left to be discovered. Measured after: depth 9 **185 ms**, depth 12 **188 ms** (was
  25 s and 190 s). Pinned by wall-clock regression tests, since correctness tests cannot see this —
  the decision is right, it just arrives too late.

  A related bound is **not** fixed here and is filed as #219: the initial quoting scan is O(n) in
  bash, so a 40 000-character command takes ~21 s on `main` and on this branch alike, exceeding the
  timeout before any inspection starts. Pre-existing, and this change neither causes nor cures it.

  **Cost, and the user-visible contract it creates.** Inspecting a wrapper's inner commands is real
  work: a `bash -c` containing *n* commands costs roughly 22 ms × *n* (1 ≈ 0.07 s, 10 ≈ 0.26 s,
  50 ≈ 1.1 s) against a flat ~0.05 s before, and commands *without* a shell wrapper are unaffected.
  Beyond roughly **350 inner commands** the deadline is reached and the command is **denied** rather
  than allowed — that is the new contract, and it is stated here rather than left to be discovered.

  One shape is bounded rather than flat: a command carrying a **line continuation** must run the
  flattened pass (it is the only thing that catches a fragmented invocation), and inside a nest that
  means running it at every level. Measured: depth 7 ≈ 6.5 s, depth 8 denied at ≈ 7.1 s by the
  deadline, depth 10 denied at ≈ 0.2 s by the depth bound. An ordinary continuation with no nesting
  is ≈ 0.1 s. Bounded, deliberate, and pinned by wall-clock tests.
- **`guard-destructive.sh` no longer treats prose as a command — without weakening the guard**
  (#204) — a quoted argument spanning newlines was split on the raw newline, so a line of *text* that
  merely began with a destructive verb was inspected as an invocation. Writing documentation about
  the very commands this guard exists for was blocked, which trains reflexive `GUARD_DESTRUCTIVE=0`
  use, and a bypass reached for by habit protects nothing.

  The root cause is that a newline inside quotes is **data** when the quoted text is an argument and
  a **separator** when it is code. A quoted newline now becomes a sentinel that is neither a
  separator nor whitespace; the shell-code paths (`bash|sh|zsh|dash -c`, `eval`, `ssh`) restore the
  newlines, split line-first, and inspect every inner command, while everything else flattens the
  sentinel to a space and reads as prose. An unterminated quote falls back to treating newlines as
  separators, because the data boundary was never actually known.

  Additionally, a heredoc fed to a **text tool** (`cat > notes.md <<'EOF'`) is a document, so its
  body is no longer inspected — the issue's first acceptance criterion. That exemption fails closed
  on three independent conditions: the `<<` must be outside quotes and not a here-string, **every**
  command on the opening line must be a text tool (so `echo hi && bash <<'EOF'` keeps its body), and
  the terminator must actually appear (an unterminated heredoc strips nothing rather than swallowing
  the rest of the command).

  Four rounds of independent review each found that an earlier version of this fix **weakened** the
  guard, every time in the same shape: an exemption whose condition was checked too narrowly, so a
  benign leading token hid what followed. First by flattening multi-line scripts; then by attributing
  a heredoc to the *first* command on the line rather than the one that consumes it; then by treating
  a `<<` inside a comment or after an escaped quote as a real redirect, and by exempting **unquoted**
  delimiters whose bodies the shell actually expands (so `$(…)` in one would execute); finally
  because the two functions that jointly grant the exemption disagreed about what a line even was —
  one had been taught about backslash escapes and the other had not, so `git commit -m "the \" char"
  ; bash <<'EOF'` read as "every command here is a text tool" and exempted the shell heredoc behind
  it. That last one was **introduced by the round-3 fix itself**: teaching one half of a two-function
  invariant about escapes opened a hole that had not existed while both halves were consistently
  wrong. All were caught before merge and are pinned by tests.

  The exemption is therefore deliberately narrow. A heredoc body is skipped only when **all four**
  hold: the delimiter is quoted or backslash-escaped (an unexpanded body); the `<<` is a real
  redirect — outside quotes, outside comments, not a here-string; **every** command on the opening
  line is a text tool; and the terminator actually appears. Any doubt on any condition and the body
  stays inspected.

  Self-test suite: **63 → 112 cases**. Measured rather than asserted — running the final suite
  against each earlier version: pre-`#204` `main` **8** differences (**6** false denials removed,
  **2** destructions newly caught that `main` allowed), first attempt **25**, second **24**, third
  **5**, fourth **9**. Each condition is mutation-checked individually against the final suite:
  flattening the newline sentinel to a space fails **10** cases, removing the heredoc exemption
  **4**, making the all-commands-are-text-tools check always true **13**, dropping the
  quoted-delimiter requirement **2**, disabling the quote/comment masking **3**, removing the
  terminator lookahead **1**, and removing `quote_split`'s escape handling **6**. Note that nothing
  in CI runs this suite (see #208) — it runs via `verify_all.sh` and the pre-push hook, so a
  regression here is invisible to the pipeline.

  **Guard cost:** `heredoc_delim` now rejects a line without `<<` before running the masking pass.
  Without it, every line of a large command paid for two O(n) character loops where `main` paid for
  one — a 40 000-character command took **42.5 s** against `main`'s **21.2 s**. That is not merely
  slow: a PreToolUse hook that times out does **not** deny, so doubling the cost halves the input
  size at which the guard still guards. Measured after the fix: **21.3 s** — `main`'s timing restored.

  **Known gap:** writing a script with a text-tool heredoc and executing it in the same command
  (`cat > s.sh <<'EOF' … EOF` then `bash s.sh`) satisfies all four conditions and is allowed, where
  pre-`#204` `main` denied it. That is inherent to exempting document-writing at all; tracked in
  #212 rather than left implicit.
- **The encryption-migration tests no longer collide under `pytest -n auto`** — they shared one
  scratch database, so concurrent xdist workers dropped a database another was mid-migration on
  (reproduced on unmodified `main`: 3 failed + 1 error). The name is now worker-scoped, keeping the
  `test_` prefix so the rule-9 carve-out still applies. Pre-existing; surfaced because new tests
  shifted the worker distribution.

### Changed
- **The admin restore-timeout message reported a hardcoded `300s`** (#207) whatever the real ceiling
  was, so an operator debugging a timeout would have been told the wrong number. It now reports the
  configured value.
- **The Gemini environment variables are project-scoped: `HIREFOLIO_GEMINI_API_KEY` and
  `HIREFOLIO_GEMINI_ENCRYPTION_KEY`** (#141) — the generic `GEMINI_API_KEY` is a name developers
  commonly export globally from a shell profile, and a process environment variable **overrides
  `.env`** in docker compose, so the generic name silently bound a personal live key into the local
  E2E stack. The settings fields now use an explicit `validation_alias`, so the generic name
  **cannot** bind at all — verified directly: with `GEMINI_API_KEY` set in the environment and the
  project variable unset, `settings.gemini_api_key` resolves to `''`. **Operator action:** rename
  these two keys in the host `.env` before the next rollout; a stale `GEMINI_API_KEY` will simply be
  ignored (AI falls back to Ollama) rather than failing loudly. `GEMINI_ENCRYPTION_KEY` is renamed
  for the same namespacing reason — it is a local Fernet key for encrypting the per-user Gemini key
  at rest (#143), not a Gemini credential; the rename is expected to need no data migration, on this
  evidence: the live deployment self-reports `backend_version 1.2.27`, while #143 first shipped in
  `v1.8.3` — so the running code cannot have written `enc:v1:` ciphertext. That is inference from the
  public stats endpoint, **not** an inspection of the host's `.env` or database, which is not
  accessible from here. The failure mode if it is wrong is bounded and reversible: `decrypt()`
  fail-safes to "treat as unset", so AI degrades to the Ollama fallback and nothing is lost —
  restoring the old value under the new name recovers it. `GEMINI_MODEL`/`GEMINI_MODEL_FALLBACK` are namespaced
  too — model choice is a **cost** control, and an ambient value pointing at a premium tier would
  silently raise the price of every suggestion. A **startup warning** now names any legacy variable
  that is still set but ignored, so a stale host `.env` degrades loudly instead of silently falling
  back to Ollama. Covered by seven regression tests that **all fail against the pre-fix config** — the control was
  previously invisible to the suite, which is how a suggested `populate_by_name=True` (to make
  direct construction work) silently re-opened the hole by re-admitting the field name as an
  environment source; the tests caught it immediately and it was reverted.

### Security
- **The E2E stack can no longer inherit a real `GEMINI_API_KEY`** (#141) — CI injected `""` at the
  job level, but a **local** `verify_all.sh` run brings the stack up through compose, which resolves
  the variable from the developer's environment (and `.env`). Process environment *overrides* `.env`,
  so a key exported from a shell profile reached the backend container silently. Verified on a real
  machine: with the previous overlay `docker compose config` resolved a live 53-character key into
  the stack; with the fix it resolves `""`. `docker-compose.e2e.yml` now pins the (renamed)
  Gemini key empty for the backend, so **every** consumer of the E2E overlay is covered — not
  only the invocation that
  remembers to export it — and the backend falls back to the in-stack Ollama exactly as in CI
  (verified: container env empty, stack healthy, the five Gemini-touching admin specs pass in 12.5 s).
  `deploy.yml`'s backend test job also sets it explicitly rather than relying on the runner simply
  not having the variable.

## [1.10.0] - 2026-08-30

### Added
- **CI now enforces the 100% coverage standard** — the backend test job ran
  `pytest --cov=app --cov-report=...` with **no `--cov-fail-under`**, and `pyproject.toml`'s
  `addopts` sets no threshold either, so CI printed the coverage percentage and passed regardless.
  The project's headline standard was therefore never actually gated; a drop below 100% only
  surfaced in a local run. `--cov-fail-under=100` added to the CI invocation (found in the #194
  review).
- **CI now gates version-carrier consistency** (#193, closes #186's last item) — a fast
  `version-consistency` job runs `./bump_version.sh --check` plus the new
  `test-bump-version.sh` self-test, and all four image-build jobs `needs:` it, so drift fails the
  pipeline before anything is published. Previously `--check` ran only in the machine-local
  pre-push hook, so a hook-bypassing push could reintroduce #172-class drift unnoticed.
- **`test-bump-version.sh`** — a 19-case self-test for the load-bearing version tooling, built on
  throwaway fixtures (it never touches the working tree): every carrier's drift is detected *and
  named*, the `version="1.0.0-fallback"` literal is not mistaken for the app version, `VERSION`
  newline hygiene is enforced both ways, `--dry-run` is proven inert, and CHANGELOG rotation is
  verified end-to-end, plus both "the pattern vanished" guards and the write-side anchor.
  Mutation-checked against the pre-fix script: **7 cases fail**, one per defect. It also runs in
  `verify_all.sh` and the pre-push hook, not only CI, so a tooling edit fails locally first.
- **`POST /ai/multi-chat` accepts a bounded `max_turns`** (#187) — previously the twenty-turn
  failsafe was fixed, so any caller (including a contract test) had to wait for twenty sequential
  local-LLM generations. The request schema now takes `max_turns` with `ge=1, le=20`: callers can
  ask for a short conversation, while the upper bound keeps the original failsafe so one request
  cannot pin the model indefinitely. Out-of-range values are rejected with 422 rather than silently
  clamped.
- **Unmocked E2E contract guard for `/ai/multi-chat`** (#187) —
  `frontend/e2e/public/multi-agent-smoke.spec.ts` hits the real endpoint against the E2E stack and
  asserts what a mocked spec structurally cannot: every chunk parses as NDJSON, the stream
  **terminates with `{"done": true}`**, and the agent actually produced content. The spec named
  after this endpoint (`multi-agent.spec.ts`) `page.route`-mocks it — which is precisely how #180
  hid, since a pre-yield crash surfaces as HTTP 200 with a truncated body rather than a 500, so
  `response.ok` stayed true while the public `/llm` page showed "Connection Error"; that spec now
  carries a note pointing at its unmocked counterpart. Rule 10 safe: the stack runs with an empty
  `GEMINI_API_KEY`, so generation falls back to the in-stack Ollama and no paid API is reached.
  It sends the new bounded `max_turns: 1`, so it costs **~5 s** rather than the ~85 s a default
  twenty-turn conversation takes locally (and multiples of that on a CPU-only runner) — the failure
  mode is structural, so one turn proves it exactly as well as twenty. It also asserts the response
  is *not* the service's degraded path, since the backend substitutes canned text when generation
  fails and a bare "some content" check would pass with no model at all.
  **Verified by reproduction:** reintroducing the #180 failure mode makes it fail in ~1 s; restoring
  the fix makes it pass in ~5 s.

### Changed
- **Public `/api/app/` gets the same streaming guarantees as the admin block** (#198) —
  `proxy_buffering off`, `proxy_cache off`, and `proxy_read_timeout 300`. **Measured first, and the issue's
  premise did not reproduce:** per-chunk timings through the public proxy showed nginx already
  forwarding incrementally (365 chunks, first at 1.6 s, spread over 99 s) *without* the directives.
  This ships as an explicit guarantee rather than a bug fix — today's behaviour is incidental on
  chunk sizes versus nginx's default buffers — and removes the public/admin asymmetry. The change
  also raises `proxy_read_timeout` to 300 s, which is the part with real teeth: a cold model took
  **26 s** to its first chunk against nginx's 60 s default.
- **Dropped the unused `crewai` + `langchain-openai` pins, unblocking the caps they forced** (#185,
  closes #53's dependency half). After #184 removed the vestigial agent-framework plumbing, nothing
  in `backend/app/` imported either package — they were dead weight that nonetheless dictated the
  whole backend's resolution. With them gone: **`pydantic` >=2.12.5 → >=2.13.0** (resolves 2.13.5)
  and **`rich` <15.0.0 → >=15.0.0** (resolves 15.0.0), the two caps tracked by the now-closed #52
  (crewai pinned `pydantic<2.13`; its `instructor` dependency pinned `rich<15`). Verified on a clean
  Python 3.13 environment: `pip check` clean, **787 passed, 7 skipped, 100% coverage**.

### Fixed
- **`main` unblocked: the `max_turns` test no longer runs the app lifespan** — the test added in
  #187 used `TestClient(app)`, which starts the FastAPI **lifespan**; the lifespan seeds the admin
  user, so it needs a schema the xdist worker DB does not have. Green in a serial local run, red
  under CI's `pytest -n auto` (`relation "users" does not exist`), which reddened the deploy. It now
  uses the shared async `client` fixture like every other API test. Verified with CI's exact
  invocation this time — `pytest -n auto --cov-fail-under=100` → 788 passed, 100%.
- **A missing Ollama model no longer reads as generated content** (#199) — `/api/chat` answers **404**
  when the configured model is not pulled, and the streaming loop ignored the status, so the canned
  goal-fallback text (`"I believe we must focus on my goal: …"`) reached the client as if it were a
  real turn. A half-provisioned stack therefore looked *healthy* to every gate: well-formed stream,
  `done:true`, plausible prose. Non-200 responses now log the status **and the model name** for the
  operator and emit the degraded chunk instead. Regression test asserts the fallback text is absent
  and the log names the model; it fails against the unfixed service. The **unmocked E2E guard now
  fails against a genuinely model-less stack too** — verified by pointing the backend at a model that
  is not pulled, which previously sailed through every gate.
- **`_generate_agent_name` no longer swallows failures silently** (#191) — every exception became
  `"Agent"` with nothing logged, so a real failure (model down, timeout, malformed reply) was
  indistinguishable from a legitimate default and left the operator no signal (rule 1). The fallback
  is unchanged; the failure is now logged with its traceback, and a test asserts that.
- **Version tooling follow-ups from the #178 review** (#186) — the backend version read *and* write
  are now anchored to `^    version="`, so the seeded `CvDocument(version="1.0.0-fallback")` literal
  can never be matched instead of the FastAPI app version; the two `grep`-derived carriers
  (`package-lock.json`, compose `IMAGE_TAG` defaults) no longer die silently under
  `set -euo pipefail` when a pattern stops matching — they name the file and say the format changed;
  `release.sh`'s three abort paths now share a single `revert_bump()` — the revert was duplicated
  per branch, so the new `.env` `IMAGE_TAG` restore (which `git checkout` cannot do, the file being
  gitignored) initially reached only one of them, and a `--check` failure under `set -e` left the
  bump applied entirely; and the CHANGELOG
  rotation is rewritten in three explicit steps that cannot split a real `### Added` list — the old
  placeholder-anchored regex inserted the release header mid-list, leaving the heading behind in
  `[Unreleased]` and the real bullets bare under the version header.

### Security
- **`guard-destructive.sh` now blocks *any* recursive `rm` at a protected data path** (#188) — it
  previously required `-r` **and** `-f` together, so `rm -R ./data` walked straight through. The
  force flag only suppresses prompts for write-protected files; it is not what makes the delete
  irreversible, so it is no longer part of the condition. The path regex is unchanged, so deletes
  outside the protected set (`frontend/dist`, `node_modules`, scratchpads) are still allowed.
  A **quoted** path (`rm -R "./data"`) also no longer slips through: a trailing quote defeated the
  path regex's boundary, so the guard's own documented `bash -c` coverage was incomplete — the
  boundaries now accept a surrounding quote. Twelve self-test cases added — five deny (`-R`, `-r`, `--recursive` against data/pgdata/volumes/
  ollama/open-webui) and two allow — bringing the suite to 63 — including near-miss allow-cases
  (`./src/app/data-table`, `build/metadata`, `rm -f ./data/file.txt`) that pin the *absence* of
  false positives. Reverting the guard fails exactly the new deny cases, so the coverage is proven
  rather than assumed.

### Docs
- **The release checklist no longer mis-reads the rollout job's signal** (release review of this
  version) — `lessons-learned` §7 said that with `DEPLOY_*` unset the rollout job "skips", and told
  the reader to "check the job's status". Both are wrong in the way that matters: the job runs
  unconditionally and reports **`success`** as a guarded no-op, so its *status* is a false positive
  and a release manager following the old wording would announce a host rollout that never happened.
  It now says to read the job's **log** (or probe the live footer) and records the concrete evidence:
  run 33326238612 was 21/21 green with `Roll Out To Prod Host` = `success`, while live prod still
  served **v1.2.27**.
- **`.env.example` stops carrying a version that silently rots** — the commented
  `# IMAGE_TAG=1.9.0` example sat one release behind and was invisible to both
  `bump_version.sh --check` and the new CI version-consistency gate, which is precisely the
  uncovered-carrier shape #172/#193 set out to eliminate. Since the surrounding comment already
  names `VERSION` as the source of truth, the example is now the placeholder `X.Y.Z`: it cannot
  drift, rather than being hand-bumped every release forever.
- **lessons-learned §16–20 + the rules distributed across every AI config** — today's milestone
  sweep produced five durable lessons, now committed rather than left in a transcript: mutation-check
  any test that claims to pin a fix (it passed against the *unfixed* code four separate times, and
  `git stash -- <file>` silently no-ops for committed changes); a signature or behaviour change needs the **full** suite *as CI runs it*
  (`pytest -n auto`), because stale siblings in other files are invisible to `-k` — caught twice in
  review, and once only after it reddened `main`, where it had passed every serial local run; verify that claimed gates actually gate (CI ran pytest with no `--cov-fail-under` for the
  project's whole history, and `--check` lived only in a local hook); fix the *duplication*, not the
  instance (a copy-pasted revert block meant a fix reached one of three abort paths); and a repo
  rename does not carry container packages — new GHCR packages are created private and visibility
  does not follow a rename. The operational half is mirrored into `pr-reviewer` (mutation-check as a
  review step), `backend-dev`/`frontend-dev` (full-suite discipline), `CLAUDE.md` rule 7 (a
  `Closes #NN` auto-close is **not** close-the-loop — link the PR, SHA, pipeline and criteria; report
  what you measured), plus `AGENTS.md`, `.github/copilot-instructions.md`, the path-scoped backend
  instructions, the `issue-workflow` skill (close-the-loop must name **who** verified and **what**
  they ran) and the A2A `PROJECT_PLAYBOOK` injected into every agent's prompt.

## [1.9.0] - 2026-08-30

### Added
- **Automated prod rollout (`deploy` job in `deploy.yml`)** — closes the "published ≠ live" CD gap
  (#112/#156): after all four images are promoted, the pipeline SSHes to the prod host and rewrites
  only `IMAGE_REPO`/`IMAGE_TAG` in the host `.env` to the **immutable `sha-<gitsha>` tag** (guarded so
  a missing/unreadable/short `.env` aborts untouched rather than losing secrets; only the previous
  coordinate lines are kept for rollback), pulls and recreates just the four app services
  (`--no-deps`, so third-party images and volumes are never rolled), verifies every app container by
  **image digest**, waits on `/api/app/health`, runs the retried #169 freshness probe (public
  `/admin/login` → 404), and rolls back to the previous sha tag on any failure. The job is a
  guarded no-op until the owner adds `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_SSH_KEY` secrets, so forks
  and secretless runs stay green; volumes are never touched (rule 9). New `docs/DEPLOYMENT.md` covers
  the clean-server first deploy, the secrets to activate rollout, and the first LinkedIn content
  import; `docker-compose.prod.yml` image defaults now point at the registry CI actually publishes to
  (GHCR, anonymous pulls) instead of the stale Docker Hub repo — landed as `ghcr.io/mavrovde/mavrov.de`
  and superseded later in this same release by the rename to `ghcr.io/mavrovde/hirefolio` (see below).
- **GitHub Copilot parity** (Refs #115, #121, #122) — `.github/copilot-instructions.md` rewritten
  in sync with the current `CLAUDE.md` (RxJS-primary — the old file wrongly mandated
  "Signals only" on "Angular 18" — engineering rules 1–11, issue flow, published≠live,
  no-real-credentials, destruction guardrail); new path-scoped
  `.github/instructions/{backend,frontend,infra-ci}.instructions.md`, reusable
  `.github/prompts/{verify,release-check}.prompt.md`, a root `AGENTS.md` for coding agents, and
  `.github/workflows/copilot-setup-steps.yml` pre-installing deps for the Copilot coding agent.
  `CLAUDE.md` remains the single source of truth; all Copilot files summarize and point back.

### Changed
- **The project is now `Hirefolio`; the repository is `mavrovde/hirefolio`** (#88). The old identity
  (`mavrov.de` as a *product* name) described one person's site and could not name a reusable,
  fork-and-go template — `mavrov.de` remains the maintainer's own deployment of it. GitHub redirects
  the previous repository URLs and existing clones keep working, but remotes should be updated
  (`git remote set-url origin https://github.com/mavrovde/hirefolio.git`). Repo-slug references were
  rewritten across the compose files, CI/AI configuration, agent charters and docs (historical
  `CHANGELOG`/`specs/done` entries are left untouched as a record). **Image-path consequence:** CI
  publishes to `ghcr.io/${{ github.repository }}-*`, so builds now land at
  `ghcr.io/mavrovde/hirefolio-*` while previously published tags remain at
  `ghcr.io/mavrovde/mavrov.de-*` — pin `IMAGE_REPO` explicitly when deploying a pre-rename tag.
  **Requires a one-time owner action:** the four new GHCR packages are created *private* (package
  visibility does not follow a repository rename) and the prod host pulls without a `docker login`,
  so they must be made public once. The rollout job now preflights anonymous pullability and fails
  with the package name before touching the host. `.env.example` and `verify_proxy_startup.sh`
  (which gates `release.sh`) also stop naming the retired Docker Hub org.
- **CI: removed the dead E2E base-image cache** (#134) — the e2e-tests job's "Restore cached
  base images" + "Load or pull base images" steps ran *after* `docker compose up -d` had
  already pulled every image the stack needs, so the ~5 GB tarball restore + `docker load`
  bought nothing: ~2 min pure overhead per run on a cache hit, and ~10 min (pull + `docker
  save` + post-job cache upload) on a cache miss — the whole 18.6 m E2E outlier on run
  `33230883491`. The tar even pinned `open-webui:v0.5.10`, a version the stack no longer runs.
  Steps and `.github/base-images.txt` removed; base-image pins live solely in
  `docker-compose.prod.yml` (README/.env.example pointers updated, incl. the stale
  ollama-model-cache paragraph left over from the #78 revert). Expected: E2E ~9 m → ~7 m
  typical and the cache-miss variance spike eliminated. Confirms lessons-learned §5
  (multi-GB `actions/cache` is net-negative).
- **`crewai` 1.15.6 → 1.15.18** (within-minor bump, refs #52) — picks up 12 upstream patch
  releases. This does **not** unblock #52: crewai 1.15.18 still declares `pydantic<2.13,>=2.11.9`
  (and its `instructor` dependency still declares `rich<15.0.0,>=13.7.0`), so `pydantic` stays
  `>=2.12.5` and `rich` stays `<15.0.0`. #52 remains upstream-blocked and open.
- **Root service-script robustness** — all root `*.sh` scripts are shellcheck-clean with
  consistent `set -e`(`uo pipefail` where safe): `verify_all.sh` prints numbered per-phase banners
  and an unmistakable final `VERIFICATION FAILED` banner on any failure (proxy verification and
  Playwright included) via an EXIT trap; `release.sh` sources `.env` instead of `export $(cat …
  | xargs)`, runs `bump_version.sh --check` before verifying, and its abort path reverts the full
  carrier set (previously left `package-lock.json`, shared `package.json`, compose tags and the
  rotated CHANGELOG dirty); `build_amd64_and_push.sh` now defaults to GHCR (Docker Hub default
  dropped by user directive; landed as `ghcr.io/mavrovde/mavrov.de-*`, retargeted to
  `ghcr.io/mavrovde/hirefolio-*` by the rename later in this release; forks can
  retarget via `REGISTRY`/`IMAGE_REPO`) and drops the commented-out `docker system prune`
  footguns; `verify_proxy_routes.py` dispatches any
  HTTP method (the old GET/PUT/POST chain left `response` unbound for other methods). Release
  runbook docs (`.claude/commands/release.md`, `.claude/agents/release-manager.md`) synced.
- **AI-config hooks hardened** (Refs #115, #121, #122) — `pre-push-tests.sh` now fails fast when
  another pytest suite is already running (`pgrep -f pytest`; two suites clobber the shared
  `test_mavrov` DB), and `guard-destructive.sh` closes the `rm --recursive --force` /
  separated-flag / `-Rf` bypass of the data-dir rule (pattern 5), with new deny/allow self-test
  cases in `guard-destructive.test.sh`.

### Fixed
- **`POST /api/app/ai/multi-chat` repaired** (#180) — broken since the crewai 0.11 → 1.x bump
  (v1.4.1): the service passed a LangChain `ChatOpenAI` client as `Agent(llm=...)`, which crewai 1.x
  rejects with a `ValidationError` *before the streaming generator's first yield*, so clients saw
  HTTP 200 + a mid-body connection close and the public `/llm` page showed "Connection Error". The
  vestigial crewai/LangChain plumbing is removed outright — participants are plain dataclasses and
  generation streams directly to Ollama as it already did — and `conftest.py` no longer mocks the
  crewai/langchain module tree wholesale (those vacuous mocks are exactly how the breakage hid from
  778 green tests). The service's tests now exercise the real construction path.
- **Root service-script overhaul (#172)** — `bump_version.sh` now updates EVERY version carrier,
  adding the previously missed `frontend/projects/shared/package.json` (caught up from the stale
  `1.7.0` to the current version) and the `docker-compose.prod.yml` `${IMAGE_TAG:-…}` defaults
  (previously a macOS-only `sed` in `release.sh`); it writes `VERSION` with exactly one trailing
  newline (idempotent — ends the newline diff churn) and gains `--check` (verify all carriers
  agree, naming the offending file + both values on mismatch; wired into the pre-push hook's docs
  check) and `--dry-run`. Its CHANGELOG rotation is guarded against the historical double-rotation
  (two inserted version headers). `build_amd64_and_push.sh` no longer calls the uninstalled
  `podman push` (broken; now `docker push` throughout) and documents that CI's ghcr publish is the
  primary path. `verify_all.sh`'s frontend-startup timeout check was testing the Open WebUI wait
  loop's counter — moved to its own loop.

### Security
- **Admin JWTs can no longer be signed with a publicly-known secret** (#177). `jwt_secret_key`
  defaulted to the committed placeholder `your-secret-key-change-in-production`
  (`backend/app/config.py`) and **no compose file passed `JWT_SECRET_KEY`**, so a production
  deployment signed/verified admin bearer tokens with a secret published in this public repo —
  admin API access without any credential, bypassing the #142 password hardening entirely.
  Mirroring #142, the insecure state is now impossible rather than merely documented: the
  config default is gone, the historical placeholder is an explicitly **rejected** value, and the
  `app.main` lifespan **refuses to start** (`InsecureJwtSecretError`, actionable message) when no
  explicit secret is configured. `docker-compose.prod.yml` now passes
  `JWT_SECRET_KEY=${JWT_SECRET_KEY:-}`, and `.env.example` documents it as REQUIRED with an
  `openssl rand -hex 32` hint. Local dev / E2E opt into `JWT_ALLOW_EPHEMERAL_SECRET=true` and get a
  **random per-process** secret, so no key is committed and CI needs no real credential (rule 10).
  **Operator action required before the next prod rollout: set `JWT_SECRET_KEY` in the host `.env`**
  — the backend will otherwise refuse to start (fail-closed by design). Rotating the secret
  invalidates existing admin sessions (one re-login), which is the point: tokens minted under the
  old known key stop being accepted.
- **`/ai/multi-chat` no longer streams exception text to clients** (CodeQL alert #31,
  `py/stack-trace-exposure`, medium) — introduced by the #180/#184 repair, which surfaced setup and
  per-turn failures as `[Error: {e}]` on the public stream. Because the response body has already
  started when these fire, they cannot become a 500; the reason is now **logged server-side** and
  the client receives a fixed, non-revealing message instead. The infrastructure-error chunk also
  stops echoing the configured Ollama URL. Tests assert the *absence* of the exception reason, so a
  future regression that leaks internals fails the suite.

### Docs
- **Operational lessons folded into agent charters** (Refs #115, #121, #122) —
  `.claude/agents/{backend-dev,frontend-dev,devops-pipeline,release-manager,pr-reviewer}.md` and
  `agents/common/roster.py` (`PROJECT_PLAYBOOK`) now carry: never run backend pytest concurrently
  (`pgrep -f pytest` first), bisect local gate failures against an unmodified `main` build
  (lessons-learned §13), local proxy HTTPS on host port 10443, and the "green `deploy.yml` =
  green pipeline = images published; live-on-host only if the secrets-gated rollout job ran" doctrine (#112/#156/#175). `.claude/commands/release.md`
  drops its stale verify_all.sh conda-path warning (fixed long ago) and both `release.md` and
  `verify.md` encode the same lessons. Dev/release charters (and the Copilot files) now also
  require every PR to carry ≥1 type + ≥1 area label, same scheme as issues (agent PRs had been
  going out unlabeled, e.g. #171/#174).
- **lessons-learned §13–14** — two durable lessons from the #170 dependency sweep: bisect a
  failing local gate against an unmodified `main` build before blaming your diff (the stale
  pre-split admin-login proxy check failed on `main` too; prod "passing" was an artifact of the
  #112 rollout gap), and `@angular/*` exact-peer lockstep (single-pass group updates, lockfile
  regeneration escape hatch). Also renumbers the pre-existing duplicate §11 heading.
- **Pre-release accuracy sweep** (Refs #61) — brings the user-facing docs back in line with the
  code: honest `SECURITY.md` (supported 1.8.x, GitHub Security Advisories reporting — replaces the
  unedited GitHub boilerplate with its fictional 5.1.x/4.0.x version table); `frontend/README.md`
  rewritten for the real 3-project workspace (was stock `ng new` boilerplate claiming CLI 21.1.1
  and "no e2e framework"); `README.md` version/tooling corrections (FastAPI 0.141, Python 3.12,
  SQLAlchemy 2.0.52, Vitest 4.1, Playwright 1.62, Ruff 0.16, Node 22; drops the false ESLint claim),
  redrawn project tree, real ruff/coverage/E2E commands, correct frontend env paths, `encrypt0002`
  migration row, and a truthful deployment section (GHCR `sha-<gitsha>`/version/latest publishing,
  and the secrets-gated `Roll Out To Prod Host` job — a green run rolls the host only when the
  `DEPLOY_*` secrets are configured, #175/#112/#156); `.env.example` image
  registry/tag comments refreshed (GHCR, 1.8.4); dead importer spec link fixed; scraper
  `WORKFLOW.md` gains posts/env-vars/tests sections; `README_TESTING.md` updated (Python 3.12,
  Node 22, test-DB isolation via `TEST_DATABASE_URL` + `create_test_db.py`, per-project Vitest
  configs, dev vs prod+e2e compose stacks, no hardcoded test counts); `agents/README.md` roster
  regenerated from `common/roster.py` (16 agents, ports 8010–8025) with the real delivery flow.
- **Release-time doc truthing** — `SECURITY.md`'s supported-versions table moves to `1.9.x`;
  `docs/DEPLOYMENT.md`'s intro no longer asserts the GHCR packages *are* public (post-rename the
  four `hirefolio-*` packages are created **private** and need the one-time visibility change the
  same document's "Registry notes" already describe), and the example `IMAGE_TAG` in
  `docs/DEPLOYMENT.md` / `.env.example` tracks the current release.

## [1.8.4] - 2026-08-29

### Changed
- **Backend within-major dependency bumps** — consolidates Dependabot PR #168: `uvicorn` 0.52.0 →
  0.52.4, `pydantic-settings` 2.14.2 → 2.15.0, `python-dotenv` 1.2.2 → 1.2.3, `sqlalchemy` 2.0.51 →
  2.0.52, `alembic` 1.18.5 → 1.19.1, `langchain-openai` 1.4.1 → 1.6.0, `google-genai` 2.16.0 →
  2.19.0; dev tools `ruff` 0.16.1 → 0.16.4, `mypy` 2.3.0 → 2.3.1. Validated: `pytest` (778 passed,
  100% coverage), `ruff check`/`ruff format --check`, `mypy`, `bandit` all green.
- **Frontend within-major dependency bumps** — consolidates Dependabot PRs #164 and #167 (they both
  touch `frontend/package-lock.json` and conflict pairwise): the `@angular/*` group 22.1.1 →
  22.1.4 (core / common / compiler / compiler-cli / forms / platform-browser /
  platform-browser-dynamic / platform-server / router) and 22.1.3 → 22.1.6 (build / cli / ssr),
  `@analogjs/vite-plugin-angular` 2.6.4 → 2.7.1, `@vitest/browser-playwright` (and the Vitest
  family) 4.1.10 → 4.1.11. The lockfile was regenerated from the updated ranges because npm's
  exact-version Angular peer pins can't be upgraded incrementally. Validated: `npm run build`
  (shared → public → admin) and `npm run test:coverage` (100% statements/branches/functions/lines
  on all three projects).

### Fixed
- **Stale proxy-verification check** (`verify_proxy_routes.py`) — the "Frontend Admin Login
  Route" check still expected `mavrov.de/admin/login` → 200, encoding the pre-workspace-split
  layout (admin SPA inside the public app). Since the July 2026 split the admin SPA is served on
  the dedicated admin host and the public app has no `/admin/*` routes, so any freshly built
  frontend correctly 404s there — the check failed `verify_all.sh` on an unmodified `main` build
  (verified empirically). Replaced with two checks matching the intended architecture:
  `admin.localhost/login` → 200 and public-host `/admin/login` → 404. It previously appeared to
  pass only against prod, whose running frontend image still predates the split (tracked
  separately).

### Security
- **`cryptography` 49.0.0 → 50.0.0** (`backend/requirements.txt`) — fixes Dependabot alert #169
  (high): *PKCS#7 EnvelopedData decryption exposes a Bleichenbacher oracle through distinguishable
  errors and timing*. Our Fernet usage (`app/services/crypto.py`, #143) never calls the vulnerable
  PKCS#7 APIs, so this is a hygiene forward-bump, not an active exposure (#160). Supersedes
  Dependabot PRs #163/#158. Validated: crypto + migration tests pass in the full backend suite.

## [1.8.3] - 2026-08-09

### Changed
- **`jsdom` 29 → 30 (major)** — deliberate major upgrade of the Vitest jsdom test environment
  devDependency (resolved to `30.0.1`), superseding held Dependabot PR #131 (#131). The DOM/HTML-parsing
  behavior the unit suites rely on is unchanged. **Removed the leftover jsdom-29 `undici` scaffolding**
  — the `overrides.undici: "^7.29.0"` pin *and* the direct `devDependencies.undici: "^7.29.0"` entry
  are gone, so jsdom 30 pulls its own `undici@^8` (resolved `8.10.0`). That old pin (added for jsdom 29,
  which needed undici 7 — see `[1.5.0]` note) inverted the hazard under jsdom 30, which is rewritten for
  undici 8's module layout: it force-downgraded jsdom's resource-loader dispatcher to undici 7,
  reintroducing the "Cannot find module …/jsdom-dispatcher" class of failure. Nothing in
  `frontend/projects/**` imports `undici` directly, so it moves with the jsdom major. The prior
  undici-7 pin is thereby superseded. Added a regression spec
  (`projects/shared/src/jsdom-undici-resource-loader.spec.ts`) that asserts undici ≥ 8 is resolved from
  jsdom and drives jsdom's undici-backed resource loader on a local `data:` subresource (no network) —
  the existing 727 specs never touch that path because they mock `HttpBackend`. Validated against the
  full frontend gate — `npm run build` (shared → public → admin) and `npm run test:coverage`
  (100% statements/branches/functions/lines on all three projects).
- **Frontend within-major dependency bumps** — consolidates Dependabot PRs #129, #130, #136, #137,
  #139 into one validated PR (they all touch `frontend/package-lock.json` and conflict pairwise, so
  they can't merge independently). Bumps the `@angular/*` group 22.0.8 → 22.1.x (core / common /
  compiler / forms / platform-browser / platform-server / router → 22.1.1; build / cli /
  compiler-cli / ssr / platform-browser-dynamic → 22.1.3), `@playwright/test` 1.62.0 → 1.62.1, and
  `@types/node` 26.1.1 → 26.2.0, and pulls the patched dev/transitive `hono` 4.13.1, `js-yaml`
  4.3.1, and `fast-uri` 3.1.5 — clearing the dev-only Dependabot alerts #162 / #164 / #165–167.
  `jsdom` was intentionally held at 29.x here; the 30.x major landed as its own deliberate effort (see above, #131).
  Validated against the full frontend gate: `npm run build` (shared → public → admin) and
  `npm run test:coverage` (100% statements/branches/functions/lines on all three projects).
- **Backend within-major dependency bumps** (#128) — `fastapi` 0.140.0 → 0.141.1, `uvicorn` 0.51.0 →
  0.52.0, `google-genai` 2.14.0 → 2.16.0, `ruff` 0.16.0 → 0.16.1. Validated: `pytest` 100% coverage,
  `ruff check`/`ruff format --check`, `mypy` all green; the `google-genai` bump is compatible with
  `app/services/ai.py`'s `genai.Client` / `client.models.generate_content` call sites.
- **CI: serialize prod deploys with a `concurrency` guard** (#147). `deploy.yml` gained
  `concurrency: { group: deploy-${{ github.ref }}, cancel-in-progress: false }`, so two pushes to
  `main` in quick succession queue instead of running overlapping pipelines that race on the shared
  container-registry tags — the newest commit is always published last. `cancel-in-progress: false`
  avoids aborting a half-published deploy.
- **Replace DEBUG `print()` with the structured logger in `app/services/ai.py`** (#145). The
  module-load import trace and `_get_gemini_client` diagnostics now use `logger.debug(...)` instead of
  `print("DEBUG: ...")`, so they no longer pollute prod stdout and honour log-level config. No
  credential value is ever logged — only a presence boolean (`Has key? {bool(api_key)}`).

### Fixed
- **Gemini no longer defaults to a premium model or double-bills on fallback** (#144). `_generate_text_gemini`
  (and `chat_with_gemini`) in `app/services/ai.py` previously hardcoded the premium `gemini-3.1-pro`
  (an invalid model name) and, on **any** exception, retried with a second billable call to a
  different model — so one logical suggestion could bill twice. The model is now **config-driven**
  via `settings.gemini_model` / `settings.gemini_model_fallback` (env `GEMINI_MODEL` /
  `GEMINI_MODEL_FALLBACK`), defaulting to the cheap flash tier (`gemini-2.5-flash`, fallback
  `gemini-2.0-flash` — both valid in the installed `google-genai` 2.16.0). The fallback model is now
  attempted **only** on a genuine "model unavailable" (HTTP 404 / `NOT_FOUND`) error — which is
  raised before any inference runs, so it never double-bills; every other error returns `None` so the
  existing free local Ollama fallback in `suggest_*` takes over. Net: at most one billable Gemini call
  in the normal path.
- **`open-webui` crash-loop: pin the image forward to `v0.11.0` to match the volume schema** (#123).
  `docker-compose.prod.yml` pinned `ghcr.io/open-webui/open-webui:v0.5.10`, but the persistent
  `mavrovde_open-webui_data` volume had already been migrated to a **newer** schema (head alembic
  revision `f0bd01a18a3d`, `add_unique_normalized_user_email_index`) — the dev `docker-compose.yml`
  ran `:latest`, which forward-migrated the shared volume. The old pinned v0.5.10 then crashed on
  boot (`Can't locate revision identified by 'f0bd01a18a3d'`, `sqlite3.OperationalError: no such
  column: config.id`), and because nginx resolves the `open-webui` upstream at startup, `global_proxy`
  crash-looped downstream (`host not found in upstream "open-webui"`). Revision `f0bd01a18a3d` is a
  migration that first ships in open-webui **v0.11.0** (present in the `v0.11.0` tag, absent in
  `v0.10.2`), so v0.11.0 is the minimum version whose migration chain already contains the volume's
  head — it reads the existing volume forward with **no data loss** (no volume wipe). Both compose
  files are now pinned to the specific, current stable `v0.11.0` (dev switched off the floating
  `:latest` so dev and prod agree and the volume schema stops drifting ahead of the prod pin). Because
  the E2E stack starts from a fresh volume it can't reproduce the persistent-volume mismatch; the fix
  is validated by pulling the pinned image and by both `docker compose config` files parsing clean.
  Residual manual step on the prod host: `docker compose -f docker-compose.prod.yml pull open-webui &&
  docker compose -f docker-compose.prod.yml up -d open-webui`, then confirm it reaches `healthy` and
  `global_proxy` stabilizes.

### Security
- **Stop exposing the Gemini API key over the wire and encrypt it at rest** (#143). The per-user
  Gemini credential (a paid, billable key) was returned to the browser by `GET /auth/me` and stored
  as plaintext `String(255)`. Now: (1) `UserResponse` (`backend/app/api/auth.py`) returns
  **`has_gemini_key: bool`** instead of the raw `gemini_api_key` — the key is write-only via
  `PUT /auth/gemini-key` and never read back; the admin profile page
  (`frontend/projects/admin/.../profile`) shows "Key configured / Not configured" from
  `has_gemini_key` and offers a write-only set/replace field (the secret is never pre-filled and is
  cleared from the DOM after a successful save). (2) The `users.gemini_api_key` column is **encrypted
  at rest** via a new `EncryptedString` SQLAlchemy type (`backend/app/services/crypto.py`) using
  `cryptography` **Fernet** (AES-128-CBC + HMAC), transparently decrypted on read for AI callers. The
  Fernet key comes from the new `GEMINI_ENCRYPTION_KEY` setting (`app/config.py`); when it is empty,
  encryption is disabled and values pass through as plaintext, so local/dev/E2E keep working, and
  existing plaintext rows (no `enc:v1:` marker) are read transparently — enabling encryption never
  breaks or loses data. Decryption fails safe (logs a warning, treats an undecryptable value as
  unset) rather than crashing `/auth/me` or the AI endpoints. Migration `encrypt0002` widens the
  column to `TEXT` and encrypts any existing plaintext key in place — guarded by the key
  (no-op when unset) and idempotent (skips already-marked values). The migration `downgrade`
  **refuses to overwrite an encrypted credential with NULL**: if the key is missing/rotated at
  rollback (so decryption fails safe to `None`), it aborts with a clear error instead of wiping the
  value. `decrypt()` also fail-safes on a **malformed** `GEMINI_ENCRYPTION_KEY` (not just an invalid
  token), so a bad key can never 500 `/auth/me` or the AI endpoints — it degrades to "unset". Because
  the migration runs once, existing plaintext keys are **not** retroactively encrypted if the key is
  enabled later; a one-off idempotent backfill (`backend/scripts/backfill_encrypt_gemini_key.py`,
  `python -m scripts.backfill_encrypt_gemini_key`) or re-saving via the admin UI encrypts them, and
  the network **exposure** (Part A) is closed regardless of encryption state. Docs/compose
  (`docker-compose*.yml`, `.env.example`, `README.md`) document the env var and the two-step.
  Regression tests cover the boolean-only responses (incl. blank-key), the write/clear paths, the
  encrypt/decrypt round-trip with legacy-plaintext passthrough + fail-safe (invalid **and** malformed
  key) decryption, and a **real up/down Alembic migration test** against Postgres — key-set
  (encrypt-in-place + idempotent skip + downgrade decrypts back), key-unset (no-op widen, no wipe),
  the downgrade null-wipe guard, and the backfill.
- **Remove the hardcoded default admin password; require `ADMIN_PASSWORD` in prod** (#142). The
  startup DB-seed in `backend/app/main.py` created the initial admin with `get_password_hash("admin")`
  — a weak `admin`/`admin` login that shipped to prod with no override, letting anyone into the admin
  console (and read the stored Gemini key via `/auth/me`). The seed now reads the new `ADMIN_PASSWORD`
  setting (`app/config.py`, default empty): with it set, the seeded admin uses that password; with it
  empty it **refuses** to create a login-able default admin (logs a clear error and skips), so prod can
  never ship `admin`/`admin`. **Automatic rotation of an existing weak admin** — because the long-lived
  prod DB already has a user (so the fresh-install seed never runs), startup now also rotates a
  *still-weak-default* admin: when `ADMIN_PASSWORD` is set and the stored password still verifies
  against the historical `admin` default, it is replaced automatically (idempotent, no manual step),
  closing the live login on the next deploy. A password an operator already changed via the admin UI is
  left untouched (rotation is gated on the weak-default check). Local dev / E2E keep working via
  `scripts/seed_e2e_user.py` (its own throwaway `admin123`). `ensure_admin.py` and
  `scripts/reset_admin_password.py` likewise source the password from `ADMIN_PASSWORD` instead of a
  hardcoded default, and `docker-compose.prod.yml` + `.env.example` now document/require it. Regression
  tests cover fresh-install (set → uses it), prod refusal (unset → no weak admin), rotation (existing
  weak default → rotated, `admin` no longer verifies), the no-clobber guard (custom password preserved),
  and the E2E seed.
- **Harden admin console access: nginx `real_ip` + `ADMIN_ALLOWED_CIDRS`** (#86, split from #60).
  The admin subdomain filtered on `$remote_addr`, but in the containerized prod topology Docker NAT
  masks every external client to the bridge gateway, so the allowlist could not distinguish real
  operators (and flipping to `deny all;` would have locked the owner out). The proxy now recovers the
  real client IP first: `proxy/nginx.conf` includes a generated `real_ip.conf`
  (`set_real_ip_from ${TRUSTED_PROXY_CIDRS}` default `172.16.0.0/12` + `real_ip_header
  ${REAL_IP_HEADER}` default `X-Forwarded-For` + `real_ip_recursive on`), then filters that IP against
  `admin_allowlist.conf` generated from `ADMIN_ALLOWED_CIDRS`. Both are regenerated at container start
  by `proxy/generate-admin-config.sh` (env values validated as IPv4/IPv6/CIDR so a malformed value
  cannot inject nginx directives); the committed files are safe defaults + fallback. The admin surface
  now ships **CLOSED** (empty `ADMIN_ALLOWED_CIDRS` → loopback only; **never** a blanket `allow all;`),
  opened by listing trusted operator CIDRs. A fail-safe re-tests the generated config (`nginx -t`) and
  reverts to a known-good closed default if it is invalid, so a bad allowlist can neither crash nginx
  (which would take the public site down too) nor silently misfilter the owner; a documented loopback
  break-glass path always works. E2E opens the allowlist via env for the test run only
  (`docker-compose.e2e.yml` + `deploy.yml`), never a real secret. Docs: `.env.example`, README
  "Deploying as a new owner", `docker-compose{,.prod}.yml`. Validated with `nginx -t` on the rendered
  config + a generator unit test (`proxy/test-generate-admin-config.sh`); real-client-IP recovery
  behind the live front proxy needs manual verification in the prod topology (proxy access logs must
  show the real external client IP).

### Docs
- **Mandatory independent review gate — CLAUDE.md rule 11** (no PR merges without a `pr-reviewer`
  APPROVE verdict posted to it; green CI / dev-agent validation / "user-directed" / trivial changes
  are NOT substitutes; urgent = expedited, not skipped). Mirrored into `agents/common/roster.py`, the
  `release-manager`/`backend-dev`/`frontend-dev`/`pr-reviewer` charters, and the `lessons-learned`
  skill. Origin: four PRs merged this cycle without an independent verdict (retrospective reviews
  posted, all clean).

## [1.8.2] - 2026-08-09

### Security
- **Stop tests/CI from calling the paid Gemini API with a real key** (cost leak). The `e2e-tests` job
  started the prod-topology stack with `GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}` and
  `frontend/e2e/admin/ai-suggestions.spec.ts` drove `/posts/suggest-*` **unmocked**, so every push to
  `main` billed real, premium Gemini calls. Fixed both layers: `deploy.yml` now passes
  `GEMINI_API_KEY: ""` to the E2E stack (the backend falls back to the free in-stack Ollama, so the
  flow is still exercised at zero cost — real prod is unaffected, its key comes from the host env), and
  the AI-suggestion specs now mock `/posts/suggest-tags` + `/posts/suggest-details`. Codified as a hard
  rule: **NEVER use real API keys / paid credentials in tests or CI** — added as CLAUDE.md **rule 10**
  and mirrored into every `.claude/agents/*.md` charter, the shared `agents/common/roster.py` playbook,
  and the `lessons-learned` skill (mock the call, or use a free local fallback with an empty/dummy
  credential; real credentials belong only to the production runtime environment).

### Changed
- **Backend image: drop the unused Node.js + Playwright + Chromium install** (#91, backend-build
  lever). Investigation of why `Build Backend Image` stayed ~5min despite an existing `type=gha`
  layer cache found the base stage running `npx playwright install --with-deps chromium` (plus a
  Node.js 20 install + `npm i -g playwright dotenv cross-env`) — **~500MB+ of browser tooling the
  FastAPI backend never uses at runtime**. Verified exhaustively: LinkedIn ingest uses the pure-HTTP
  Python `linkedin-api` client (`app/services/linkedin.py`, docstring "no Node.js"), the entrypoint
  is Python/alembic, `main.py` uses the Python `python-dotenv`, and the only subprocess is `pg_dump`
  (postgresql-client) — nothing imports/execs Node, Playwright, or Chromium (the "Playwright scraper"
  references were stale docstrings, now corrected). Removing it shrinks the image by ~500MB+, cuts the
  dominant base-stage build step, and shrinks the `type=gha` cache (whose slow restore of that giant
  layer was the "5min despite cache" cause — same net-negative pattern as #72/#78), with a security
  bonus (smaller attack surface). Validated against the full Docker E2E (backend builds, starts, and
  serves the stack with no Playwright). `libpq5`/`postgresql-client`/`curl` retained.

### Fixed
- **E2E startup race: no more transient `500 UndefinedTableError` on cold start** (#124). On a
  fresh stack the backend exposed no true readiness signal — `GET /api/app/health` returned `200`
  unconditionally — so an orchestrator / the E2E gate hammered endpoints while the container's
  `alembic upgrade head` (run by `docker-entrypoint.sh` before uvicorn) was still bringing the
  schema up, and `GET /api/app/profile` leaked a raw `500`
  (`asyncpg.UndefinedTableError: relation "profile_snapshots" does not exist`) that flipped to `200`
  once init finished. `/api/app/health` is now a real **readiness** probe (new
  `app/services/readiness.schema_ready`): `200 {"status":"healthy","ready":true}` only when the
  required tables exist, else a retryable `503 {"status":"initializing","ready":false}` (also on a
  DB-connectivity error), so E2E/orchestrators can gate on it (`/api/app/ping` stays pure liveness).
  As defense-in-depth the public `GET /api/app/profile` read now downgrades a warm-up
  `UndefinedTableError` to a graceful, retryable `503` instead of a raw `500` (genuine, non-missing-table
  DB errors still propagate). Regression tests cover the pre-init path for both the health probe and
  the profile read.
- **Public app committed to zoneless change detection** (#105). The public build ships no `zone.js`
  polyfill (`frontend/angular.json`) yet declared no change-detection driver, so async property
  mutations silently never repaint in the browser (the #94 class) — fine in unit tests that bundle
  `zone.js`, frozen live. `app.config.ts` now provides `provideZonelessChangeDetection()` and the
  components that mutated plain template props in async callbacks trigger CD explicitly via
  `ChangeDetectorRef.markForCheck()` (`cv.component`, `header.component`, `blog.component`'s browser
  fetch/fallback/search paths). The dead `NgZone.run(...)` wrappers in `blog.component` (NgZone is a
  no-op under zoneless) were removed. A `public-e2e` guard asserts a purely-async region — the footer
  uptime counter (`setInterval` + `markForCheck`) — actually advances live.
- **Real HTTP 404 for unknown blog slugs on SSR** (#109). `blog-post.component` resolved a
  missing/unpublished slug to a graceful not-found panel but SSR served it `200` (a soft-404 that
  pollutes crawler indexes). When the view resolves to not-found on the **server**, the component now
  sets the outgoing SSR response status to `404` via the `RESPONSE_INIT` injection token
  (`@angular/core`), and marks the page `noindex` with a "Post not found" title (new
  `SeoService.setNotFound()`) on both platforms. Known slugs still return `200`; the client-rendered
  not-found panel is unchanged. Guarded by a `public-e2e` assertion (`404` for an unknown slug, `200`
  for known routes).

### Docs
- **In-repo AI knowledge base — stop re-researching what we already know** (#114). Added a committed
  `lessons-learned` skill (`.claude/skills/lessons-learned/SKILL.md`) distilling the hard-won,
  test-invisible lessons that previously lived only in machine-local private memory: the zoneless-CD
  "async mutation doesn't repaint" footgun, the SSR `HttpBackend`→`HttpXhrBackend` (never
  `FetchBackend`) rule, "SSR/HTTP changes need the Docker E2E" (PR CI is CodeQL-only), backend pytest
  local-DB isolation (`TEST_DATABASE_URL`/serialize/`--cov` segfault), the GHA multi-GB-cache
  net-negative, SemVer-by-content, the green-pipeline release rule, and the destruction guardrail —
  each with *why it bites* + *how to apply* and an AI-config map. `CLAUDE.md` now references the skill
  from the tooling section and **rule 7 mandates the sync discipline** (a new durable lesson lands in
  the in-repo knowledge base as part of the change, not only in private memory). No secrets/PII copied.
- **Guardrail against irreversible local/infra destruction** (#116). Added CLAUDE.md **rule 9** and a
  new `PreToolUse` **`Bash` guard hook** (`.claude/hooks/guard-destructive.sh`, registered in
  `.claude/settings.json`) that BLOCKS — as defense-in-depth beyond the generic permission classifier
  — `docker volume rm`/`prune`, `docker compose down -v`/`--volumes`, `docker system prune`,
  `docker image prune -a`, `dropdb`/`DROP DATABASE|SCHEMA` on a **non-`test_*`** target, and `rm -rf`
  of a persistent data/volume path (`data`/`pgdata`/`volumes`/`ollama`/`open-webui`/`.chrome-profile`/
  `linkedin_cookies`). It is **command-position aware** — it splits the command on shell separators and
  inspects each segment's first token, skipping text/VCS tools (`git`/`grep`/`echo`/`sed`/…), so the
  same text appearing merely as an *argument* is NOT blocked; only a real invocation is. Splitting is
  **quote-aware** — a separator inside a quoted argument (e.g. a `git commit -m "…| xargs docker volume
  rm…"` message) stays part of that one text-led segment, while a real unquoted pipe
  (`cat list | xargs docker volume rm`) is split and each part inspected. It also transparently
  **unwraps indirection** — `sudo`/`env`/`nohup`/`time`, `xargs [opts]`, and `bash -c`/`sh -c`/`eval
  "…"` — so `docker volume ls -q | xargs docker volume rm` (the "remove ALL volumes" idiom) and
  `bash -c "docker volume rm x"` are still caught. Passes every ordinary dev/test command through
  instantly (verified by a committed **45-case** self-test `.claude/hooks/guard-destructive.test.sh`,
  now also run by the pre-push hook; `verify_all.sh`/`manage.sh` use none of the blocked patterns).
  Bypass one authorized command with a **leading** `GUARD_DESTRUCTIVE=0` on that segment (a stray token
  elsewhere in the line does not disarm it), or export it for a session. The rule is mirrored into all seven `.claude/agents/*.md` charters and the shared
  `agents/common/roster.py` playbook. Origin: the #91 incident where a subagent ran `docker volume rm
  mavrovde_open-webui_data` on its own initiative (a backup is not consent).
- **Fold the v1.8.1 SSR/zoneless lessons into the agent charters** (`.claude/agents/frontend-dev.md`,
  `.claude/agents/pr-reviewer.md`, `agents/common/roster.py`). Documented the three hard-won gotchas
  from the #25/#94 fixes so future agents catch them at review/implementation time instead of at the
  deploy E2E: (1) the public app is effectively **zoneless** (no `zone.js` polyfill) so async
  property mutations need the `async` pipe / signals / `markForCheck()` to repaint (#94 class); (2)
  SSR URL rewrites belong in an `HttpBackend` delegating to `HttpXhrBackend`, never `FetchBackend`
  (#25 / reverted #84); (3) changing a user-visible behavior means grepping ALL e2e specs for the old
  assertion (the #108→#110 stale-test fix-forward). Also corrected `pr-reviewer.md`'s stale
  "Signals-primary" claim to the actual RxJS-Observables-+-async-pipe reality (rule 5).

## [1.8.1] - 2026-07-29

### Changed
- **Parallelize the CI `Backend Tests` job with `pytest-xdist` (`-n auto`)** (#91, lever 3). The
  backend suite ran serially (`deploy.yml`), making it the ~5.2-min head of the deploy critical
  path. It now runs across all available cores. The single shared Postgres service (one DB) made
  naive parallelism collide on unique constraints (`ux_post_slug_lang` / `ix_post_source_urn`), so
  `backend/conftest.py` now gives **each xdist worker its own database**: it derives a per-worker DB
  name from `PYTEST_XDIST_WORKER` (`test_mavrov_gw0`, `_gw1`, …), creates it if absent via asyncpg
  against the `postgres` maintenance DB in `pytest_configure`, points the async engine + schema
  `create_all` at it, and drops it (`WITH (FORCE)`) at session end. Serial runs (no `-n`) and the
  xdist controller keep the original single-shared-DB behavior unchanged. `pytest-cov` aggregates
  coverage across workers, so the 100% gate is preserved. Added `pytest-xdist==3.8.0` to
  `requirements-dev.txt`. Measured in real CI (deploy run 30404645861): the `Backend Tests` job
  dropped **298s → 191s (−36%)**, coverage aggregated at 100%, zero correctness regressions.
- **CI: remove the redundant standalone "Proxy Verification" job** (#91, lever 2). The
  `proxy-startup-test` job spun the full prod stack up a **second time** just to grep the Nginx
  start banner, and all four `publish-*` jobs blocked on it — pure critical-path waste (~284s). The
  `e2e-tests` job already starts the same stack (including `global_proxy`) and waits for HTTP
  200/302 on `:80` (a stronger check); its unique log-grep assertion is now folded into `e2e-tests`
  as a "Verify Proxy Startup (Smoke)" step, and `publish-{backend,frontend,admin-frontend,proxy}`
  now depend on `e2e-tests` directly. No verification dropped. Measured in real CI (deploy run
  30406891756): end-to-end deploy wall-clock **29.45min → 24.85min (−15.6%)**. Remaining #91 lever:
  the ~5.5-min backend-image build (the Ollama-weights and base-image caches were both measured
  net-negative and reverted, #78/#72).

### Fixed
- **Blog deep-links no longer flash back to the home page on hydration; the public site's
  `/stats/public` browser fetch keeps working** (#25, #94). The SSR relative→absolute URL rewrite
  (`/api/...` → `http://backend:8000/...`) lived in an `HttpInterceptorFn`, which runs *before*
  Angular's HTTP transfer-cache interceptor — so the server keyed the transfer cache on the
  *rewritten* absolute URL while the browser keyed it on the *relative* URL. The keys never matched,
  so on hydration the browser re-fetched every request; a transient failure of the needless blog
  re-fetch hit `BlogPostComponent`'s `catchError`, which navigates to `/` — the "flash to home". The
  rewrite now lives in a custom `HttpBackend` (`SsrHttpBackend`), which runs *after* the transfer
  cache has keyed the original (server/client-identical) relative URL, so the browser reuses the SSR
  response instead of re-fetching. Unlike the first attempt (reverted #84, which delegated to
  `FetchBackend` and broke the only genuine browser fetch, `GET /api/app/stats/public` →
  `net::ERR_FAILED`), this backend delegates to **`HttpXhrBackend`** — the exact backend the app has
  always used on both platforms — so the browser dispatch is byte-identical to the long-working
  baseline and #94 cannot regress. Removed the old `ssr.interceptor.ts`. Follow-up: `BlogPostComponent`
  now resolves a genuine 404 / transient fetch error to a **graceful "post not found" panel** instead
  of `router.navigate(['/'])` (the old home-bounce, now removed) — a `vm$` of `loading|found|notfound`
  rendered via the `async` pipe. Added a **retries:0** E2E guard (`blog-display.spec.ts`) that asserts a
  direct `/blog/:slug` load renders the post and keeps the URL (no flash-to-home) and that an unknown
  slug shows the not-found panel without redirecting home; the existing create→view E2E tests now poll
  the public API until the new post is queryable, removing the brand-new-post propagation flake (#107).
- **Footer system-stats now render on the public site (backend version, uptime, memory)** (#94). The
  full Docker E2E surfaced a second, deeper root cause behind the footer showing `BE: vUnknown`: the
  public app bundles **no `zone.js`** (`angular.json` has no `polyfills` entry) and declares no
  zoneless change-detection provider, so it runs effectively zoneless — yet `SystemStatsComponent`
  updated **plain properties** inside `subscribe`/`setInterval` callbacks, which never trigger change
  detection, leaving the footer frozen at its SSR-initial values (`vUnknown`, `00:00:00`, `24MB`).
  The `/api/app/stats/public` fetch itself was fine (HTTP 200); only the repaint was missing. Fixed
  by injecting `ChangeDetectorRef` and calling `markForCheck()` after each async mutation — the same
  pattern the sibling `blog.component` already uses. (The broader "no CD driver configured" ambiguity
  is tracked separately for a deliberate zone-vs-zoneless decision.) Both #25 and #94 were validated
  against the full Docker E2E stack (`footer-stats` + blog specs) before merge, not just unit tests.
- **LinkedIn session now persists across container recreates/deploys** (#44). The saved LinkedIn
  login session was stored under `/tmp/linkedin_cookies` inside the backend container — part of the
  ephemeral container layer — so every deploy or restart wiped it and forced the admin to
  re-authenticate. The session directory is now driven by the new env-overridable
  `LINKEDIN_COOKIES_DIR` setting (defaulting to `/data/linkedin_cookies`) and is backed by a new
  `linkedin_cookies` named volume mounted on the `backend` service in both `docker-compose.yml` and
  `docker-compose.prod.yml`, so the saved session survives container recreation. The `/linkedin/status`
  response now also returns a human-readable `message` explaining whether a session is active.
- **E2E: correct the stale `blog-interactions` invalid-slug test to the shipped graceful not-found
  behavior** (Refs #25). PR #108 (issue #25, criterion 3) removed the old home-bounce so
  `BlogPostComponent` now renders a "post not found" panel while staying on `/blog/:slug`, but the
  leftover `should redirect to home for invalid slug` test in
  `frontend/e2e/public/blog-interactions.spec.ts` still asserted the removed redirect and failed the
  public-e2e shard deterministically. Retitled it to
  `should show a graceful not-found panel for an invalid slug (no home redirect)` and aligned its
  assertion with the authoritative `blog-display.spec.ts` guard — it now expects the
  `post-not-found` panel visible and the URL to stay on `/blog/:slug`. Test-only; no app change.

### Docs
- **Reconcile the root `agents/` A2A roster prompts with the `.claude/agents/` charters** (#99).
  The A2A delivery-team `system_prompt`s in `agents/common/roster.py` predated the richer Claude
  Code subagent charters added in #89 and had drifted. Enriched the overlapping role prompts with
  the hard-won guidance from the matching charters: `code-reviewer` ← `pr-reviewer` (mandatory
  test-coverage + user/edge-case analysis — "coverage executed ≠ behavior asserted" — and a clear
  severity-tagged APPROVED/REJECTED verdict); `release-manager` ← `release-manager` (SemVer bump by
  content, never default to minor; the CHANGELOG `[Unreleased]`→version rotation trap; tag on the
  full SHA; `deploy.yml` has no concurrency guard so serialize; babysit to green, fix-forward on
  red); `security-reviewer` ← `security-triage` (pull & triage CodeQL + Dependabot real-vs-noise,
  file grounded issues, verify a release's fixed alerts show `fixed`, no exploit details in a public
  repo); `spec-analyst`/`story-writer` ← `issue-author` (ground every claim in real code with
  `path:line`, the full issue template + milestone/priority/area labels). Also fixed factual drift:
  the `frontend-dev` prompt no longer claims Angular "signals" (the app uses RxJS Observables + the
  `async` pipe, per #29 — Signals only sparingly for local state), and `PROJECT_PLAYBOOK` now states
  Python **3.12** in prod/CI (dev venv may be 3.13) and adds the lesson that SSR/`HttpBackend`/
  interceptor/transfer-cache changes must be validated against the full Docker E2E before merge (the
  v1.8.0 #84 revert). Prompt strings only — no change to role keys, ports, dependencies or the
  A2A architecture; the `agents/tests/` suite (55 tests) still passes.

### Reverted
- **Reverted the Ollama model-weights CI cache** (#78). After it deployed, before/after
  measurement showed it made the `E2E Tests (Docker Stack)` job **~56s slower** (8m20s → 9m16s):
  the cache-hit path cost ~53s (restore 38s + pre-load 15s) but saved only ~11s of model pull —
  the ~3.6 GB GitHub-cache transfer costs as much as re-pulling the models from Ollama's registry,
  and it consumed ~3.6 GB toward the 10 GB repo cache limit. Same self-defeating pattern as the
  base-image cache (#72/#76). Removed the cache steps + `.github/ollama-models.txt`; the real
  pipeline bottleneck is the sequential critical path (tests → build → E2E → proxy), tracked with
  concrete levers in #91.

## [1.8.0] - 2026-07-26

### Fixed
- **Schema drift: Alembic is now the sole, authoritative schema-management mechanism** (#46).
  `app/main.py` no longer calls `Base.metadata.create_all` or runs ad-hoc `ALTER TABLE cv_requests`
  checks at startup; `backend/docker-entrypoint.sh` self-adopts the database into Alembic on every
  container start — no manual step required — before the app starts. It detects which of three
  states the DB is in (a plain `asyncpg` check for `alembic_version` + a known core table): a fresh
  DB just gets `alembic upgrade head`; a DB that predates Alembic (built by the old `create_all` —
  today's prod case) is first stamped at the baseline revision (no DDL) and then upgraded to head,
  avoiding an "object already exists" crash; a DB already tracked by Alembic just gets `upgrade
  head` (a no-op at head). Replaced the previously disjoint/incomplete migration history — the
  top-level `migrations/00N_*.py` scripts (never even on Alembic's discovery path) and the
  `migrations/versions/*` chain (incremental diffs that assumed tables already existed via
  `create_all` and could never run against an empty database) — with a single `baseline0001`
  revision that creates the full current schema (`users`, `cv_documents`, `cv_requests`, `posts`
  incl. pgvector `embedding` and the partial unique index on `source_urn`, `profile_snapshots`).
  Verified byte-identical (via `pg_dump --schema-only`) to what `create_all` previously produced.
  Also fixed `migrations/env.py` (missing `sys.path` bootstrap + missing model imports) and
  `app/models/__init__.py` (missing `User` import), which silently left autogenerate blind to most
  of the schema. Added a CI `backend-migrations` job that exercises the real entrypoint against a
  simulated pre-Alembic DB and a fresh DB (each re-run to confirm idempotency), plus `alembic check`
  (drift guard), on every push to `main`.

### Reverted
- **Reverted the #25 blog-post SSR routing fix** (and its follow-up #94 `withFetch()` change).
  The #25 approach overrode Angular's `HttpBackend` with a custom `SsrHttpBackend` (delegating to
  `FetchBackend`); in the prod E2E this deterministically broke the public site's only genuine
  browser-side fetch (`GET /api/app/stats/public` → `net::ERR_FAILED`), blocking the deploy — and
  adding `withFetch()` did not resolve it. Restored the prior interceptor-based SSR URL rewriting
  (browser HttpClient back on the XHR backend). Issue #25 is reopened to be redone with a
  browser-safe approach validated against the full E2E stack before merge.

### Security
- **Rate-limited the public `GET /api/app/profile` endpoint** (#47): a small, self-contained
  in-memory sliding-window limiter (`backend/app/services/rate_limit.py`, no new dependency)
  rejects excess requests per client IP with `429 Too Many Requests`; the limit/window are
  configurable via `Settings.profile_rate_limit_requests`/`profile_rate_limit_window_seconds`
  (default 100 requests/60s — generous enough that normal browsing/SSR is never affected).
- **Sanitized legacy LinkedIn admin error responses** (`backend/app/api/linkedin.py`, #47): the six
  handlers that used to interpolate the raw caught exception into the client-facing `detail`
  (`login`, `profile-sync`, `posts`, `transfer-post`, `transfer-posts`) now log the full exception
  server-side (`logger.exception`) and return a generic, non-revealing message to the client,
  matching the pattern already used by the newer `import-post`/`import-posts-json` endpoints.

### Changed
- **Pre-push hook now runs backend lint/type (ruff + mypy), matching CI** (#48). Added a
  backend lint/type leg to `.claude/hooks/pre-push-tests.sh` running `ruff check .`,
  `ruff format --check .`, and `mypy app --ignore-missing-imports --no-error-summary` from
  `backend/` (venv), so lint/format/type failures are caught at `git push` instead of only in CI's
  `Backend Lint & Format` / `Backend Type Check` jobs. Env-gated (`PREPUSH_RUN_LINT` default on,
  plus granular `PREPUSH_RUN_RUFF` / `PREPUSH_RUN_MYPY`); the `deny` reason and script header now
  mention the leg. Self-gating (non-`git push` commands still pass instantly) unchanged.
- **Parameterized deployment & infra for a new owner** (#60). Externalized every owner-specific
  infra literal behind env/config so a forker deploys by editing only `.env`/repo variables — no
  source edits. A new root [`.env.example`](.env.example) documents each knob.
  - **Container images:** `docker-compose.yml` dev image names now use the same
    `${IMAGE_REPO:-mavrovde}-<svc>` scheme as prod (`${IMAGE_REPO:-maverickde/mavrov.de}-<svc>`);
    `deploy.yml` publishing is overridable via the `REGISTRY` / `IMAGE_NAME` repository variables
    (defaults keep `ghcr.io/${{ github.repository }}` unchanged for the canonical repo).
  - **Proxy `server_name`:** `proxy/default.conf` became `proxy/default.conf.template`, rendered at
    container start by `entrypoint.sh` (envsubst) from `PUBLIC_SERVER_NAME` / `ADMIN_SERVER_NAME`
    (defaults preserve the canonical hostnames). (Admin-allowlist hardening is deferred to #86 so
    prod admin access is unchanged here.)
  - **Postgres port:** the `5433` literal became the `POSTGRES_PORT` env knob across both compose
    files (PGPORT, host mapping, healthcheck, `DATABASE_URL`).
  - **`verify_all.sh`:** replaced the hardcoded conda python path with a portable interpreter
    (`backend/venv` → `python3`, override via `PYTEST_PYTHON`); updated `.claude/commands/verify.md`.
  - **Agents:** `agents/autonomous.py` and `agents/common/tools.py` derive the repo root at runtime
    (no `/Users/maverick` absolute paths); `A2A_REPO`/`A2A_BACKEND_BIN`/`A2A_BACKEND_PYTHON` override.
- **CI: pinned & cached third-party base images** (#72, PR #76). Added `.github/base-images.txt`
  as the single source of truth (pinned `ollama/ollama:0.5.7`, `open-webui:v0.5.10`,
  `pgvector/pgvector:pg16`, matching prod compose — removed the `:latest` drift) and replaced both
  `Pull Standard Images` steps with an `actions/cache` restore + `docker load`/`save`, so the base
  images download once instead of every run.

### Docs
- **Corrected `CLAUDE.md` frontend state-management guidance** (#48, #29). Rule #5 "Frontend
  discipline" and the project-description bullet now describe the pattern the code actually uses —
  RxJS Observables + the `async` pipe as the **primary** state/streams mechanism (Signals are used
  only sparingly for local component state, e.g. `blog-post`), instead of implying Signals-first
  state; SSR/`isPlatformBrowser()`/dumb-component guidance retained.
- **Codified the issue/milestone/label development workflow into repo config** (#74, PR #75):
  a new `CLAUDE.md` section, `backend-dev`/`frontend-dev`/`devops-pipeline` role updates, a committed
  `.claude/skills/issue-workflow` skill, and a `/issue-triage` command — shared across devices and
  developers.

## [1.7.1] - 2026-07-26

### Security
- **Removed mistakenly-committed TLS certificate files** (`proxy/ssl/fullchain.pem`,
  `proxy/ssl/privkey.pem`) from the (public) repository and added `proxy/ssl/` to `.gitignore`.
  The certificate was already revoked (no live exposure), and the files were orphaned — the proxy
  `Dockerfile` never copied them, no compose service mounts them, and `proxy/entrypoint.sh`
  self-signs a dev cert when none is present, so removal has no runtime effect. Real TLS material
  is provided at runtime (host mount / deploy secret), never committed. Closes #64.

### Changed
- **Backend dependency modernization sweep** (fix-forward on the `ruff` revert from #56;
  closes #54). Re-verified every pinned backend package against latest: `fastapi` 0.140.0,
  `uvicorn` 0.51.0, `sqlalchemy` 2.0.51, `asyncpg` 0.31.0, `pgvector` 0.5.0, `alembic` 1.18.5,
  `httpx`/`respx` 0.28.1/0.23.1, `python-jose` 3.5.0, `passlib` 1.7.4, `python-multipart`
  0.0.32, `Pillow` 12.3.0, `setuptools` 83.0.0, `crewai` 1.15.6, `langchain-openai` 1.4.1,
  `google-genai` 2.14.0, `pytest`/`pytest-asyncio`/`pytest-cov`/`pytest-mock`
  9.1.1/1.4.0/7.1.0/3.15.1, `mypy` 2.3.0, `bandit` 1.9.4 were all already at latest (no changes
  needed). `linkedin-api` stays hard-pinned at `2.2.1` (patched wheel).
- **`ruff` 0.15.2 → 0.16.0, with a real migration** (closes #54). Ruff 0.16 expands its
  *default* enabled rule set from ~62 to ~416 rules. Added an explicit `[tool.ruff.lint]`
  `select` in `backend/pyproject.toml` that pins today's default rule set (413 codes, grouped
  and commented by originating linter) so a future ruff release can't silently change our
  effective lint config again. Of the ~592 resulting findings: ~450 were auto-fixed
  (`ruff check . --fix`, mostly import sorting and `pyupgrade` modernization); real
  correctness/observability issues were fixed at the root — `logger.exception(...)` instead of
  `logger.error(..., exc_info=True)` (`G201`), module loggers instead of the root logger
  (`LOG015`), timezone-aware `datetime.now(UTC)` (`DTZ005`), `asyncio.to_thread(...)` for
  blocking file reads in async startup code (`ASYNC230`), narrowed `pytest.raises(...)` in
  tests (`B017`), a swallowed vector-search exception now logged (`S110`), mutable default
  arguments removed (`B006`), and several small `TRY`/`SIM`/`PERF`/`RUF`/`FURB`/`C4` fixes.
  Three rules are deliberately ignored with documented rationale in `pyproject.toml`:
  `BLE001` (this codebase's intentional broad error-boundary pattern — every site still logs
  or re-raises), `TRY002` (a bespoke exception hierarchy is disproportionate for this app's
  size), and `SIM117` (collapsing nested `with` blocks would hurt readability at several
  test-double and long-async-body call sites). Added
  `[tool.ruff.lint.flake8-bugbear] extend-immutable-calls` for FastAPI's `Depends`/`File`/etc.
  so `B008` no longer false-positives on the framework's documented DI pattern. Removed the
  `ruff >=0.16.0` dependabot `ignore` added in #56 now that the explicit pyproject config
  protects future bumps.
- **`crewai` re-verified at latest (1.15.6)** (refs #52): still pins `pydantic<2.13` and (via
  `instructor`) `rich<15.0.0`, so `pydantic` and `rich` stay held at their current floors
  (`pydantic>=2.12.5`, `rich>=13.0.0,<15.0.0`) — unchanged from before this sweep. #52 stays
  open until a future crewai release relaxes these pins.
- **`backend/Dockerfile` stays on `python:3.12-slim`** (refs #53): `lxml` (pulled in
  transitively by the hard-pinned `linkedin-api==2.2.1`, which requires `lxml<6.0.0`) has no
  Python 3.14 wheel and its sdist fails to build without `libxml2`/`libxslt` dev headers — no
  change needed here, base image was already 3.12.
- **Frontend dependency sweep** (Dependabot #33/#34/#36/#37): `@types/node` `^22.20.1` →
  `^26.1.1`, `jsdom` (Vitest DOM env) `^27.4.0` → `^29.1.1`, `frontend/Dockerfile`
  `node:24-alpine`/`node:24-slim` → `node:26-alpine`/`node:26-slim`, and
  `frontend/Dockerfile.admin` `nginx:1.27-alpine` → `nginx:1.31-alpine`. Verified with
  `npm run test:coverage` (100% across `shared`/`public`/`admin`), `npm run build`, and local
  `docker build` of both Dockerfiles.
- **Comprehensive frontend dependency refresh.** Pinned `@angular/animations`, `@angular/common`,
  `@angular/compiler`, `@angular/core`, `@angular/forms`, `@angular/platform-browser`,
  `@angular/platform-server`, `@angular/router`, `@angular/cli`, `@angular/compiler-cli`,
  `@angular/platform-browser-dynamic`, and `@angular/ssr` from `^22.0.0` to the latest published
  Angular 22 patch, `^22.0.8` (matching the already-current `@angular/build`). Audited every
  other frontend dependency (`ng-packagr`, `express`, `rxjs`, `tslib`, `zone.js`,
  `@analogjs/vite-plugin-angular`, `@playwright/test`, `@tailwindcss/postcss`/`tailwindcss`,
  `@types/express`, `@types/node`, `@vitest/browser-playwright`, `@vitest/coverage-v8`, `jsdom`,
  `stylelint`/`stylelint-config-standard`, `undici`) against their published `latest` dist-tag —
  all were already at their true latest version (a recent sweep had already landed them), so no
  further bump was needed for those. Verified with `npm run test:coverage` (100% across
  `shared`/`public`/`admin`), `npm run build`, and local `docker build` of both Dockerfiles.
  **Held back:** `typescript` stays on `~6.0.3` — `@angular/compiler-cli@22.0.8`'s
  `peerDependencies` requires `typescript: ">=6.0 <6.1"`, and `6.0.3` is already the newest
  version in that range (latest published `typescript` is `7.0.2`, which Angular 22 does not
  support). `undici` stays on `^7.29.0` — `jsdom@29.1.1` depends on `undici@^7.25.0` and its
  internal `jsdom-dispatcher.js` requires a module path (`undici/lib/handler/wrap-handler.js`)
  that `undici@8.x` removed/renamed; overriding to `undici@^8.9.0` breaks every DOM-environment
  test with `Cannot find module 'undici/lib/handler/wrap-handler.js'` (`7.29.0` is the latest
  `7.x` release). Pre-existing `npm audit` findings (`@hono/node-server`/`@modelcontextprotocol/sdk`
  via `@angular/cli`'s MCP tooling, and `brace-expansion`/`ts-morph` via
  `@analogjs/vite-plugin-angular`) are unchanged by this sweep; `npm audit fix --force` would
  downgrade `@angular/cli` to `21.x` and `@analogjs/vite-plugin-angular` to a pre-release, both
  regressions, so they're left for a deliberate follow-up.
- **Backend dependency sweep** (Dependabot #38/#40/#42): `pytest` 9.0.3→9.1.1, `pytest-asyncio`
  1.3.0→1.4.0, `pytest-cov` 7.0.0→7.1.0, `mypy` 1.19.1→2.3.0, `bandit` 1.9.3→1.9.4,
  `google-genai` 1.75.0→2.14.0. `pydantic` (#39) and `rich` (#41) bumps were held back:
  `crewai==1.15.6` pins `pydantic<2.13` and its `instructor` dependency pins `rich<15.0.0`, so
  both would break the dependency graph. `ruff` 0.15.2→0.16.0 was also held: 0.16.0 changed its
  default lint rule set from ~62 to ~416 rules, surfacing 592 unrelated findings across the
  codebase — out of scope for a dependency-only sweep. The backend `Dockerfile` base image bump
  to `python:3.14-slim` (#32) was held too: `lxml` (pulled in by `linkedin-api`) has no Python
  3.14 wheel yet and its sdist build fails (`Please make sure the libxml2 and libxslt development
  packages are installed`).

### Fixed
- **Reverted `ruff` 0.16.0 (Dependabot #55) that broke `main`.** Dependabot auto-merged a
  recreated group PR bumping `ruff` 0.15.2→0.16.0; 0.16's expanded default rule set failed
  `ruff check .` on the existing codebase (`I001`, …), turning the prod deploy red. Pinned back
  to `0.15.2` and added a dependabot `ignore` for `ruff >=0.16.0` so it can't re-open the loop.
  The deliberate 0.16 migration (pin an explicit `[tool.ruff.lint] select`, then triage ~592
  findings) is tracked in #54.

### Held
- `pydantic` (`>=2.13.4` available) and `rich` (`15.0.0` available) — blocked by
  `crewai==1.15.6`'s own `pydantic<2.13,>=2.11.9` pin and its `instructor` dependency's
  `rich<15.0.0,>=13.7.0` pin (verified via `pip install crewai==1.15.6 --dry-run`). Tracked in
  #52.
- `lxml` (`6.1.1` available, currently resolves to `5.4.0`) — `linkedin-api==2.2.1` requires
  `lxml<6.0.0,>=5.3.0`; `pip install lxml==6.1.1 linkedin-api==2.2.1` fails with
  `ResolutionImpossible: linkedin-api 2.2.1 depends on lxml<6.0.0 and >=5.3.0`. `linkedin-api`
  is hard-pinned per policy, so `lxml` stays on the newest `linkedin-api`-compatible release.
  Related to #53.

## [1.7.0] - 2026-07-26

### Added
- **DB-backed, versioned profile + admin JSON upload.** The scraper's
  `profile_data.json` can now be uploaded from the admin **Profile Data** page and is stored
  **versioned, per language** (EN/DE evolve independently — one active version each).
  - Backend: `ProfileSnapshot` model (table `profile_snapshots`, unique `(version, language)`),
    public `GET /api/app/profile?lang=en|de` (active snapshot; 404 → frontend falls back to the
    bundled static asset), admin `POST /admin/profile/upload`, `GET /admin/profile/versions`,
    `PATCH /admin/profile/versions/{id}/activate`. Alembic migration `a1b2c3d4e5f6`.
  - **Security**: the public endpoint serves a **field allowlist**, never the raw stored blob, so an
    uploaded scraper JSON can't leak non-public PII (phone/address/connections); `contact` is
    reduced to email+linkedin. Admin upload is **size-capped** (413), `sort_by` is allowlisted, and
    full auth coverage (401 unauth / 403 non-admin) is enforced and tested.
  - Public site now loads the profile from the backend (with a static-asset fallback), so an
    upload is reflected immediately. Site-enriched fields (`contact`, `recommendations`,
    `certifications`, `languages`) are optional and every block guards for absence, so a raw
    scraper `profile_data.json` renders cleanly even when it omits them.
- **Bulk posts import from `posts_data.json`.** `POST /api/app/linkedin/import-posts-json` and an
  **Upload posts_data.json** button in the admin LinkedIn tab upsert scraper posts by URN as drafts
  (idempotent). Images are downloaded best-effort from LinkedIn's CDN, else the remote URL is kept.
  - Security-hardened: image fetch is restricted to https `*.licdn.com` (SSRF guard; the `li_at`
    cookie never leaves LinkedIn), redirects are not followed, and the upload/post-count/image size
    are bounded (413 over limit).

### Notes
- Full test coverage: backend 100% (new `profile`/`admin_profile`/`linkedin` paths), admin app 100%
  (service + Profile Data component + posts-JSON upload) and public app 100%, plus **admin-e2e**
  (Profile Data page) and **public-e2e** (backend profile render + minimal-JSON resilience).

## [1.6.0] - 2026-07-25

### Changed
- **Angular 21 → 22 major upgrade** across the whole workspace (`shared` / `public` / `admin`).
  All `@angular/*` packages, `@angular/build`, `@angular/cli`, `ng-packagr` moved to `22.x`;
  TypeScript bumped to `~6.0` and `@types/node` to `22.x` to satisfy Angular 22's peer ranges.
  Triggered by a Dependabot partial bump of `@angular/build` to v22 against a v21 framework, which
  broke the build; resolved by completing the full major migration rather than pinning back.
- **HttpClient Fetch backend** — Angular 22 defaults `HttpClient` to the Fetch backend; the public
  blog specs were adjusted to target the posts request explicitly so the change in transport no
  longer confuses the native-`fetch` infinite-scroll assertions (no runtime behavior change).

### Added
- **Dependabot configuration** (`.github/dependabot.yml`) — replaces the empty placeholder. The
  Angular toolchain is now **grouped into a single PR** and **major bumps are ignored** for
  `@angular/*`, `@angular/build`, `ng-packagr`, and `typescript`, so the workspace can never again
  be left with a half-migrated major. Also covers backend pip (linkedin-api pinned/ignored),
  GitHub Actions, and Docker base images with grouped weekly updates.

## [1.5.2] - 2026-07-25

### Changed
- **Clearer CI job names** in `deploy.yml` — per-app frontend lanes and E2E steps renamed to a
  consistent scheme (`Frontend Tests · Shared Library` / `· Public App (SSR)` / `· Admin App (SPA)`;
  `Build Public Frontend Image`; `E2E · Public Site` / `E2E · Admin Console`).
- **Behavior docs** — `CLAUDE.md`, the `backend-dev` / `frontend-dev` / `devops-pipeline` subagents,
  and the `/release` runbook updated to the PR-based workflow (never push feature work to `main`
  directly), the full local test round (backend + frontend + E2E), and a per-release security-report
  check; agent paths updated for the frontend workspace split.

## [1.5.1] - 2026-07-25

### Changed
- **CI flow split per app** — `deploy.yml` now runs one test lane per workspace project
  (`frontend-shared-tests` / `frontend-public-tests` / `frontend-admin-tests`, distinct
  Codecov flags); each image build depends on its own lane; the E2E job runs two explicit
  steps, `E2E — Public (public-e2e)` and `E2E — Admin (admin-e2e)`, so the public and admin
  flows are legible end to end.

### Added
- **Pre-push test gate** (`.claude/hooks/pre-push-tests.sh`, wired via `.claude/settings.json`)
  — before any `git push`, runs a docs check (CHANGELOG `[Unreleased]` + README), the backend
  pytest suite, and the frontend shared/public/admin unit tests, blocking the push on failure.
  Self-gates on the push command so it never interferes with other shell commands; all legs are
  env-configurable (`PREPUSH_RUN_BACKEND` / `PREPUSH_RUN_FRONTEND` / `PREPUSH_CHECK_DOCS` /
  `TEST_DATABASE_URL`).

### Fixed
- Hardened the cross-app blog E2E specs to wait for admin logout to settle before the
  cross-origin navigation to the public site.

## [1.5.0] - 2026-07-25

### Added
- **Frontend split into two independent apps.** The single Angular app is now an Angular
  workspace with three projects under `frontend/projects/`:
  - `public` — the SSR visitor site (home, blog, cv, llm, marketing shell), unauthenticated.
  - `admin` — a CSR-only admin console SPA (login + management), served on the restricted
    `admin.mavrov.de` subdomain.
  - `@mavrov/shared` — an ng-packagr library holding the code both apps share (blog/stats/llm/
    language/storage services, translate pipe, i18n), decoupled from the host app via the
    `SHARED_ENVIRONMENT` and `AUTH_TOKEN_PROVIDER` injection tokens.
  Each app builds, tests (100% coverage per project), and deploys independently.
- **Second frontend Docker image** `…-admin-frontend` (static nginx SPA, no SSR/Node) plus a
  dedicated `admin.mavrov.de` reverse-proxy server block with a loopback-allowed access
  allowlist (`proxy/admin_allowlist.conf`) and `noindex` headers.

### Changed
- CI (`deploy.yml`) now builds/tests/publishes both frontends and runs the Playwright E2E suite
  split into `public-e2e` and `admin-e2e` projects. `release.sh` / `build_amd64_and_push.sh`
  build and promote the admin image alongside the others.

## [1.4.2] - 2026-07-25

### Added
- **Ollama model prewarming** — the `ollama` service now loads the generation models
  (`llama3.2`, `llama3.2:1b`) into memory right after pulling them, and keeps all models
  resident (`OLLAMA_KEEP_ALIVE=-1`, prod `OLLAMA_MAX_LOADED_MODELS` raised to 3), so the first
  chat/tag request is not a multi-second cold start.

### Changed
- **Timeline reaches the present** — `GET /api/app/cv/years` now always includes the current
  calendar year, so the header year-slider shows the current year (e.g. 2026) even when no
  experience *started* this year.
- `/release` slash command now mirrors `release.sh` end-to-end (all steps documented).

### Fixed
- **Prod pulled stale images** — `docker-compose.prod.yml` image tags were pinned to the previous
  release's default (`IMAGE_TAG:-1.4.0`); `bump_version.sh` never updated them (only `release.sh`
  does). Bumped to the current version so the prod server pulls the right images.
- **Ollama models re-downloaded on every restart** — `ollama pull` is now guarded by an
  `ollama list` check, so models already in the persistent `ollama_data` volume are not
  re-downloaded (offline-safe once cached).
- **`HeaderComponent` NG0100** — subscribe to `YearsService.getYears()` in the constructor rather
  than `ngOnInit`, so a synchronous `shareReplay(1)` replay can't mutate bindings after the view
  was checked (removes the dev-mode `ExpressionChangedAfterItHasBeenCheckedError`).

## [1.4.1] - 2026-07-25

### Changed
- **Dependency modernization** to latest **within current majors** (deliberately not crossing
  breaking majors — no Angular 22, TypeScript 7, or google-genai 2):
  - Backend: `fastapi` 0.129→0.140, `sqlalchemy` 2.0.46→2.0.51, `pgvector` 0.4.2→0.5.0,
    `alembic` 1.18.4→1.18.5, `uvicorn` 0.41→0.51, `Pillow` 12.2→12.3, `python-multipart`
    0.0.26→0.0.32, `google-genai` 1.64→1.75, `setuptools` 69.5→83, `respx` 0.22→0.23.1.
    (`linkedin-api` stays 2.2.1 — prod installs a patched wheel.)
  - Frontend: Angular 21.2.17→21.2.19, `tailwindcss` 4.0→4.3, `vitest` 4.1.9→4.1.10,
    `express` 5.1→5.2, `zone.js` 0.16.0→0.16.2, `@playwright/test` 1.58→1.62,
    `@analogjs/vite-plugin-angular` 2.2→2.6.4 (TypeScript pinned at 5.9.x, `@types/node` at 20.x).
- **CrewAI 0.11.0 → 1.15.6** (Python 3.13 compatible). `multi_chat.py` migrated off the
  removed `langchain.tools` to `langchain_core.tools`; `langchain-openai` 0.0.2→1.4.1;
  `ChatOpenAI` `api_key` typed as `SecretStr` for the stricter 1.x signatures.
- **Chat agents**: `fast_generation_model` switched `tinyllama` → `llama3.2:1b` (cleaner,
  parseable JSON for tag/metadata generation at a similar footprint). Compose `ollama pull`
  lists and healthchecks updated to match.

### Added
- Scraper: both `scrape-linkedin.js` (profile) and `scrape-posts.js` (posts) now reuse a
  single persistent Chrome profile session, and honor `PLAYWRIGHT_CHANNEL` (e.g. `chrome`) to
  drive system Google Chrome instead of the bundled Chromium.
- Production backend accepts `LINKEDIN_IMPORT_TOKEN` and `IMPORT_MAX_IMAGE_MB` env vars,
  enabling authenticated LinkedIn post import against production.

## [1.4.0] - 2026-07-08

### Added
- **LinkedIn post import (end-to-end)** — move LinkedIn posts (text **and** images) into the
  mavrov.de blog:
  - `POST /api/app/linkedin/import-post` — multipart ingest of one post (text + optional image
    bytes). Stores the image **locally** (served from our own domain via
    `GET /api/app/posts/{id}/image`) and **upserts by LinkedIn URN** so re-imports never
    duplicate. Auth by `X-Import-Token` (constant-time compare) **or** an admin JWT; image type
    allowlist (`415`) + size cap `import_max_image_mb` (`413`); tags derived from hashtags.
    Imported posts are drafts by default. (spec 04)
  - `Post` provenance columns `source_urn` (partial-unique when not null), `source_url`,
    `posted_at`, with Alembic migration `c3f8a1d2e947`. (spec 01)
  - Import settings `linkedin_import_token` and `import_max_image_mb`. (spec 02)
  - LinkedIn text normalization helpers `normalize_linkedin_text` / `extract_hashtags` (strip the
    literal `hashtag` labels + zero-width chars; hashtags → tags). (spec 03)
- **Scraper** — correct post image/date extraction: captures the post's **own** media (no longer
  the author's profile photo), decodes `postedAt` from the activity URN's embedded timestamp,
  emits a stable `posts_data.json` schema, adds `scrape:posts` / `scrape:posts:debug` / `test`
  npm scripts, gentle scraping (session reuse, randomized delays, `SCRAPE_MAX_POSTS`), and a pure
  `parse-post.js` unit-tested with `node --test`. (spec 05)
- **Standalone importer** (`importer/`, independent of the A2A team) — drives the scraper,
  downloads each image with the LinkedIn session, and posts to the ingest endpoint. Idempotent
  (server URN upsert + local processed-URN ledger), retry/backoff (one bad post never aborts the
  batch), oldest→newest, `--dry-run` / `--watch` / `--publish`; 10 pytest tests (mocked HTTP). (spec 06)
- Decomposed feature-spec workflow under `specs/planned/` (run order + `_full-reference.md`).

### Changed
- A2A agent team now defaults to **Claude** (`claude-sonnet-4-6`) with **prompt caching** on the
  system prompt + tool definitions + a rolling tool-transcript breakpoint; `A2A_LOG_USAGE=1`
  surfaces per-call cache hits.
- Autonomous pipeline hardened from live-run experience: dev agents **implement via tools**
  (rather than only describing a plan); the deterministic gate now **mirrors CI** (auto
  `ruff format` + `ruff check --fix` + `mypy` before pytest); an empty implement is treated as a
  **RED** gate (no fake-green); the PR title is derived from the spec's H1 and length-capped;
  `run_tests` uses the checkout's venv; each agent server waits for its port to free (fixes the
  recurring `:8021` bind race).

### Fixed
- Backend coverage traces greenlets (`concurrency = ["thread", "greenlet"]`) so lines executed
  after SQLAlchemy-async awaits are recorded — async DB endpoints no longer mis-report as
  uncovered.
- Ruff-formatted autonomous LinkedIn changes that had reached `main` unformatted.

## [1.3.0] - 2026-07-06

### Added
- A2A multi-agent delivery team (12 roles: PM, architect, story-writer, backend/frontend dev, QA, code-reviewer, LinkedIn checker, DevOps, security-reviewer, documentation-writer, release-manager) as real Agent2Agent servers (Agent Cards + JSON-RPC) with a PM orchestrator, an inter-agent dependency graph, Docker compose and 25 tests, under `agents/`.
- Pluggable LLM brain for the agents: Ollama-first (local, no API key) with Gemini/Anthropic/stub fallbacks; recommended model qwen2.5-coder:7b.

## [1.2.29] - 2026-07-06

### Added
- Project MCP servers for Claude Code (`postgres`, `playwright`, `github`).
- CI-fix agent team under `.claude/agents/` (`devops-pipeline`, `backend-dev`, `frontend-dev`).
- Dependabot configuration.

### Security
- Dependency remediation: bumped `pillow`, `pydantic-settings`, `python-dotenv`, `python-multipart`, `pytest`; resolved npm advisories via `npm audit fix` + Angular 21.x patch bumps (`undici`, `vite`, `hono`, `path-to-regexp`, `postcss`, `esbuild`, ...). Open Dependabot alerts reduced from 85 to 3 low-severity (deferred -- require a breaking Angular 22 upgrade).
- Dismissed the `py/sql-injection` CodeQL alert on the admin SQL console as accepted risk (admin-gated; arbitrary SQL is the feature's intent).
- Dismissed `setuptools` and `langchain-openai` advisories as tolerable risk (CrewAI `pkg_resources` compatibility pin; breaking major bump avoided).

### Fixed
- Restored server-side rendering behind the reverse proxy: Angular 21.2's `@angular/ssr` SSRF host allowlist was silently falling back to client-side rendering. Fixed with `NG_ALLOWED_HOSTS` + `trustProxyHeaders: true` (title, `<h1>`, and content now present in initial SSR HTML).
- Resolved CI lint/format failures (`ruff` F401 + formatting) introduced by the new coverage suites.

### Changed
- Excluded the SSR server entry (`src/server.ts`) from coverage, consistent with `src/main.ts`; frontend coverage remains 100%.

## [1.2.28] - 2026-07-05

### Added
- 100% line & branch coverage -- backend (605 tests) and frontend (687 tests).
- Merged still-compatible test and scraper additions salvaged from a pre-rebase branch.

### Changed
- Ignored the scraper Chrome profile and browser runtime artifacts.

## [1.2.27] - 2026-03-15

## [1.2.26] - 2026-03-15

### Fixed
- Fixed SQL injection vulnerability in `execute_sql` in admin API.
- Fixed information exposure through exception stack traces in AI API.

## [1.2.25] - 2026-03-15

### Added
- Standardized AI Assistant global prompt configurations across all major cloud/desktop tools (`.cursorrules`, `.windsurfrules`, `.cline.md`, `AI.md`, etc.).
- Embedded ultra-strict "Mission Command" directives for clean code, solid principles, and zero-tolerance bug resolutions.

### Changed
- Increased Docker Compose healthcheck retries for the Ollama container from 60 to 180 (10 mins to 30 mins) to prevent initialization timeouts during model downloads in CI.

- Implemented `ssr.interceptor.ts` in Angular to properly route relative API calls during SSR (Server-Side Rendering) by correctly resolving `http://backend:8000` via the internal Docker DNS.
- Extended unit tests in Frontend to achieve 100% coverage on `blog-post.component.ts` and intercepted logic.
- Extended unit tests in Backend `app/api/posts.py` to achieve full coverage on draft permissions, image uploading logic, and retry generation cases.
- E2E Testing configuration adjusted to run Playwright tests against proper `BASE_URL` target inside local Docker environment.

- Improved fallback SEO metadata handling in the blog component in case the post summary is missing.
- Reorganized `APP_CONFIG` interceptors to include SSR functionality implicitly without manual code workarounds.

### Security

- **CRITICAL**: Removed `NODE_TLS_REJECT_UNAUTHORIZED=0` parameter from the `frontend` container in `docker-compose.prod.yml`. The application no longer overrides Node TLS certificate validation checks; the SSR Interceptor properly avoids self-signed SSL certificate issues by rendering data directly from the unencrypted Docker DNS internal network (`http://backend:8000`).

### Fixed

- Fixed bug where blog posts were returning `302 Found` Redirects or `404 Not Found` when directly opening their URLs due to relative pathing issues during Express server-side rendering.
- Fixed `window.location` references resolving incorrectly in the Vitest frontend suite.
