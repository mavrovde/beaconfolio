---
name: env-gotchas
description: >-
  Environment and tooling pitfalls specific to this repo's dev machines (macOS/BSD userland) and
  GitHub setup — macOS has no `timeout`, BSD grep/sed differences, the same-identity
  `gh pr review --approve` block, zsh vs CI-bash differences, and the shared local test-DB rules.
  Consult when writing shell commands meant to run on both a dev Mac and Linux CI, or when a
  gh/git command behaves differently than expected.
---

# Environment gotchas (#119)

Facts about THIS repo's environments that keep costing cycles. Check here before blaming the code.

## macOS / BSD userland (dev machines) vs GNU (CI runners)
- **No `timeout`(1).** Stock macOS ships neither `timeout` nor `gtimeout` (coreutils not installed
  by default). Scripts that need it must guard (`command -v timeout || …`) or use a
  bash-native bound. Anything you *test* with `timeout` locally silently means "the binary was
  missing" — verify the command actually ran (proven live in #225's execution checks: every shape
  but `timeout …` produced its artifact).
- **BSD `grep`/`sed`.** Alternation and `+`/`?` need `-E`; `sed -i` requires
  an explicit backup suffix argument (`sed -i '' 's/…/…/'`) where GNU sed takes bare `-i`; `\b` word
  boundaries are unreliable — use `(^|[^A-Za-z0-9_])` classes. `cat -A` does not exist (use
  `LC_ALL=C od -c` or `cat -evt`). **Watch WHICH grep you test with** (#231 review): on this machine
  the PATH `grep` is ugrep (accepts `-P` and `\b`) while `/usr/bin/grep` is BSD grep (rejects
  both) — a `-P` pattern that passes interactively breaks in scripts/hooks/CI that resolve the
  system grep. `**` globs need bash `globstar` (off by default) — prefer `find`.
- **`awk '{print length}'` counts BYTES, not characters — and NO awk you will meet here counts
  characters** (#465). An em-dash `—` is **3 bytes**, so a single one makes a 99-character line
  measure 101. Measured against `a—b` (3 characters, 5 bytes):

  | awk | where | default | under a UTF-8 locale |
  |---|---|---|---|
  | BSD awk 20200816 | macOS, this machine | **5** | **5** — `LC_ALL`/`LANG` ignored |
  | mawk 1.3.4 | `ubuntu:24.04`, the CI runner's `awk` | **5** | **5** — not multibyte-aware |
  | GNU awk 5.2.1 | only after `apt-get install gawk` | 5 (`LC_ALL=C`) | **3** — obeys |

  `wc -m` gives 4 (3 + the newline), `wc -c` 6, and `python3 len(line.rstrip())` **3**.

  **This is NOT the `#400` shape below.** There, macOS and CI genuinely disagree. Here they
  **agree** — both report bytes — and the reflex fix, "set `LC_ALL` to a UTF-8 locale", works on
  **neither**: BSD awk ignores it and mawk cannot do multibyte at all. Only gawk honours it, and
  gawk is not installed on the `ubuntu-24.04` runner (its `awk` is mawk). So the machine that
  disagrees with both is a **developer box with gawk on it** — the opposite of the usual
  macOS-vs-CI split. Use `python3` for any width check that must be right; never build a
  column-width lint on `awk length`, because on CI it would false-fail on every em-dash.

  It has already cost a round: in #465 I reported a paragraph over the 100-column limit and
  re-flowed it. Measured, the lines were **98 characters before and 99 after** — never over the
  limit. One em-dash on the widest line made awk report **101**.
- **`` \` `` inside a single-quoted ERE is a GNU ANCHOR, and a literal to BSD** (#400). In shell
  single quotes `` '\`' `` is backslash+backtick; BSD grep reads it as a literal backtick, GNU grep
  reads `` \` `` as its **start-of-buffer anchor**, so a pattern like ``grep -oE '\`[a-z-]+\`'``
  matches happily on macOS and matches **NOTHING** on the Linux runner. Measured both ways on the
  same input: BSD prints `` `postgres` ``, GNU prints nothing. Write the backtick BARE —
  ``grep -oE '`[A-Za-z0-9_-]+`'`` — since single quotes already protect it from the shell. The
  escape is only needed inside DOUBLE quotes (`"\`$m\`"`), which is why the two forms sit side by
  side in the same file and look interchangeable. They are not.
  **Why this one is expensive:** the failing pattern is usually inside a `for`/`while` that only
  *reports* problems, so no-match means the loop body never runs and the check reports SUCCESS.
  A whole category silently cannot fail on the platform CI uses, while the self-test is green on
  the author's machine — which is how this shipped inside the very PR that existed to close
  cannot-fail categories. **A shell lint's self-test is only evidence on the platform it ran on.**
  Cheapest proof before pushing — measured at **2.0 s** against an image already on the box
  (`docker image ls`; no pull, so the stack-resources guard is uninvolved):

  ```bash
  docker run --rm --entrypoint bash -v "$PWD":/w -w /w \
    ghcr.io/mavrovde/beaconfolio-backend:1.14.0 -c 'bash scripts/<tool>.test.sh'
  ```

  It catches every BSD-vs-GNU divergence on this list, not just the backtick one.
- **`date`**: BSD `date` has no `date -d`; use `date -v-1d` forms or python.
- **zsh is the interactive shell**; CI and hooks run bash. `echo ===` in zsh can trigger
  `== not found` (zsh treats `=cmd` as a path expansion); `setopt`-dependent behavior and word
  splitting differ — write scripts for bash, run them with `bash`, don't paste bash-isms into zsh.
- **Sourcing `.env` in zsh** executes unquoted lines that look like commands — prefer
  `set -a; source .env; set +a` and expect noise from bare-word values, or read single vars with
  `grep '^VAR=' .env`.

## GitHub / gh
- **Same-identity approval is blocked**: `gh pr review --approve` on your own PR fails. The
  pr-reviewer posts a clear **COMMENT verdict** (`gh pr review --comment` / `gh pr comment`) — that
  counts as the rule-13 verdict; never work around the block.
- **`gh release create` needs the FULL commit sha** for `--target`, not an abbreviation.
- **A green run ≠ rolled out**: the `Roll Out To Prod Host` job and even its gate step report
  `success` when rollout is disabled — the tell is the gated steps being `skipped` (see
  `/deploy-status`, #120).
- **Repo renames don't move GHCR packages** (lessons-learned §20): container packages keep the old
  visibility/links until touched.
- **`gh api -f` does NOT read `@file`; `-F` does.** `-f body=@notes.md` sends the literal string
  `@notes.md`. Editing an issue comment that way (#318, round 2) **replaced a 5 KB public comment
  with a local filesystem path** — silent success, wrong content, and internal path information
  published to a PUBLIC repo. Use `-F body=@file` (or `--input -` with JSON on stdin), and for
  issue/PR/comment bodies prefer the porcelain that takes a file directly: `gh pr edit
  --body-file`, `gh pr comment --body-file`, `gh issue comment --body-file`. **Always read the
  edited surface back** — `gh api … --jq '.body|length'` next to `wc -c` on the source file is a
  two-second check that catches it.
- **EDITING a published comment does NOT purge what it used to say — only DELETING it does.**
  This is the half that made the above an actual disclosure rather than a typo. GitHub keeps every
  prior revision of an issue/PR comment in its **edit history**, and on a public repo that history
  is readable by anyone — so "I fixed it by editing" leaves the leaked body in place. When a comment
  has published something that must not stay (a secret, an internal path or hostname, a session id
  per issue-flow rule 8), **delete the comment and repost the clean body**; a fresh comment has no
  prior revisions. Verify, do not assume:
  `gh api repos/<owner>/<repo>/issues/comments/<id> --jq '.body_html|length, (.user.login)'` for the
  live body, and check the replacement really is clean with
  `gh api graphql -f query='{node(id:"<node_id>"){... on IssueComment{userContentEdits(first:10){totalCount}}}}'`
  — **`totalCount` must be 0** on the repost. Same rule for PR/issue *bodies* (`gh pr edit --body-file`
  likewise only adds a revision): if the content is sensitive, the surface has to be recreated, and
  anything already in a **commit message** cannot be scrubbed by editing at all — report it rather
  than rewriting public history unilaterally.
- **A large heredoc in a `Bash` call can be refused by the destructive-command guard** (it blocks
  what it cannot finish analysing). Write the body with the `Write` tool to a scratch file, then
  run a short `gh … --body-file` command — which is also the shape that avoids the `-f`/`-F` trap.

## Local test databases (shared state)
- Backend pytest needs `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/test_beaconfolio`
  and `BEACONFOLIO_GEMINI_API_KEY=""` — without it the suite hangs on (or would wipe) the live dev DB.
- **One suite at a time** on `test_beaconfolio` (`pgrep -f pytest` first) — two runs clobber each other
  into dozens of spurious failures (lessons-learned §4).
- `seed_e2e_user.py` **obliterates all users and posts** in whatever DB it points at — only ever run
  it in-container against an E2E stack, never against the dev DB.

## git in a SHARED checkout (and the shallow-fetch trap)

- **`--depth=1` in a CI recipe SHALLOWS your working repository.** Proving a new CI step locally
  (lessons §27) means running its exact commands — and `git fetch --no-tags --depth=1 origin main`
  writes a graft into `.git/shallow`. Everything afterwards lies quietly: the fetched commit reports
  **no parent**, `git merge-base --is-ancestor` says no for commits that plainly are ancestors, and
  `git status -sb` invents a "behind 698" that sends you hunting for a force-push that never
  happened. Tell: `test -f .git/shallow`. Fix: `git fetch --unshallow origin`. Prefer running the
  depth-limited form in a throwaway clone, or unshallow immediately afterwards.
- **A shared checkout is not yours alone.** In the v1.14.0 cycle two agents on one checkout put
  #318's commit on #317's branch and switched a branch under a running agent — and it happened once
  more DURING the v1.14.0 retro: the retro branch was created off `origin/main`, and by the time the
  work was committed `HEAD` was on `main`, so the commit landed there instead. Recovery is cheap if
  you notice (`git branch -f <branch> <sha>`, `git checkout <branch>`, `git branch -f main
  origin/main`) and expensive if you do not — a `git push` from that state pushes straight to `main`.
  **Check `git status -sb` immediately before every commit and every push**, and give concurrent
  agents their own worktree (lessons §54).

## Docker on a shared dev box
- **A container remembers the port binding it was CREATED with.** If another project held a port
  when a service was first created, the broken binding survives `docker compose restart`, `stop`/
  `start` and a reboot — the container is only re-created when the *spec* changes. v1.13.0 lost a
  diagnosis cycle to this: the integration tier failed three different ways before anyone checked
  the binding. Tell: `docker port <container>` (or `docker inspect -f '{{.HostConfig.PortBindings}}'`)
  disagrees with the compose file. Fix: `docker compose up -d --force-recreate <service>` once the
  port is free — **never** `down -v` (rule 9). Free the port first (`lsof -nP -iTCP:<port> -sTCP:LISTEN`).

## Vitest worker teardown (frontend gate) — 4.x **and** 5.x
- Vitest can end a **fully passing** run with an unhandled worker-teardown error —
  `[vitest-worker]: Closing rpc while "onUserConsoleLog" is pending` (same family as upstream
  [#8649](https://github.com/vitest-dev/vitest/issues/8649) / [#9872](https://github.com/vitest-dev/vitest/issues/9872),
  "Closing rpc while 'fetch' was pending" / `EnvironmentTeardownError`). The process exits non-zero
  with e.g. `337/337 tests passed`. It is **not your change**.
- It hit twice in v1.13.0, once while pushing the release tag. Because `npm test` chains the three
  projects with `&&`, the admin project never ran either time — one flaky teardown hid two whole
  suites and hard-failed the pre-push gate. `scripts/run_frontend_suites.sh` now runs each project
  independently and retries a project **once** when — and only when — the output carries that
  teardown signature with zero failed tests; a second occurrence, or any real failure, still denies.
- **The Vitest 5 bump (#309) did NOT fix it** — measured on 5.0.0: 1 occurrence in 25 consecutive
  `npm run test:public` runs, byte-identical signature. Do not delete the harness on the assumption
  that a runner major fixed the upstream race, and do not "fix" it by loosening the gate.

## Hooks
- The pre-push hook runs the full docs+backend+frontend gate on every `git push` — from worktrees
  too (symlink `backend/venv` + `frontend/node_modules` into a fresh worktree or the backend leg
  cannot run). Legs are env-configurable (`PREPUSH_RUN_*`) — configure, don't `--no-verify`.
- The destruction guard (rule 9) inspects every Bash tool call; oversized commands (>24 KB, or
  analysis past its deadline) are DENIED by design — split the command or write content to a file
  first, don't reach for `GUARD_DESTRUCTIVE=0`.
