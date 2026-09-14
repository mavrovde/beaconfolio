#!/usr/bin/env bash
# Self-test for guard-destructive.sh (issue #116). Run: bash guard-destructive.test.sh
# Exits non-zero if any case regresses. Each case feeds a PreToolUse-shaped JSON
# on stdin and asserts the emitted permissionDecision (deny = blocked, allow = pass-through).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/guard-destructive.sh"
fails=0

# Wall-clock assertion. Cost is a SECURITY property here, not ergonomics: the
# hook has a 15 s timeout and a hook that times out does not deny, so an analysis
# that is too slow is a bypass. Correctness tests cannot see this — the decision
# is right, it just arrives too late — so it needs its own kind of check.
check_fast() { # desc cmd max_seconds
  local desc="$1" cmd="$2" max="$3" t0 t1 el
  t0=$(date +%s)
  printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" | bash "$HOOK" >/dev/null
  t1=$(date +%s); el=$((t1 - t0))
  if [ "$el" -le "$max" ]; then
    printf 'PASS  [%ss<=%ss]  %s\n' "$el" "$max" "$desc"
  else
    printf 'FAIL  took=%ss max=%ss  %s\n' "$el" "$max" "$desc"
    fails=$((fails + 1))
  fi
}

# Decision AND wall clock, together. Neither helper above can express the
# property that actually matters for a destructive payload buried in bulk:
# `check` accepts a deny that arrives at 40 s (which production, at a 15 s
# timeout, never sees — the hook is killed and the command runs), and
# `check_fast` accepts any decision as long as it is quick. A pin that asserts
# only one half passes against a hook that fails the other (round-5 review of
# #235: the many-segment destroy-tail case passed against the pre-fix hook at
# 40 s). Use this for every case whose point is "denies IN TIME".
check_within() { # desc cmd expect max_seconds
  local desc="$1" cmd="$2" expect="$3" max="$4" out dec t0 t1 el
  t0=$(date +%s)
  out="$(printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" | bash "$HOOK")"
  t1=$(date +%s); el=$((t1 - t0))
  dec="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision')"
  if [ "$dec" = "$expect" ] && [ "$el" -le "$max" ]; then
    printf 'PASS  [%s %ss<=%ss]  %s\n' "$dec" "$el" "$max" "$desc"
  else
    printf 'FAIL  got=%s want=%s took=%ss max=%ss  %s\n' "$dec" "$expect" "$el" "$max" "$desc"
    fails=$((fails + 1))
  fi
}

check() { # desc cmd expect
  local desc="$1" cmd="$2" expect="$3" out dec
  out="$(printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" | bash "$HOOK")"
  dec="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision')"
  if [ "$dec" = "$expect" ]; then
    printf 'PASS  [%s]  %s\n' "$dec" "$desc"
  else
    printf 'FAIL  got=%s want=%s  %s\n     -> %s\n' "$dec" "$expect" "$desc" "$out"
    fails=$((fails + 1))
  fi
}

# --- must DENY (irreversible local/infra destruction) ---
check "docker volume rm"          'docker volume rm mavrovde_open-webui_data'        deny
check "docker volume prune"       'docker volume prune -f'                           deny
check "compose down -v"           'docker compose -f docker-compose.yml down -v'     deny
check "compose down --volumes"    'docker compose down --volumes'                    deny
check "docker system prune"       'docker system prune -af --volumes'                deny
check "docker image prune -a"     'docker image prune -a'                            deny
check "dropdb non-test"           'dropdb mavrov'                                    deny
check "DROP DATABASE non-test"    'psql -c "DROP DATABASE mavrov"'                   deny
check "rm -rf data dir"           'rm -rf ./data/pgdata'                             deny
check "rm -rf volumes path"       'sudo rm -rf /var/lib/volumes/ollama'             deny
check "rm -fr open-webui"         'rm -fr ./open-webui'                              deny
check "rm long-opts data dir"     'rm --recursive --force ./data/pgdata'             deny
check "rm -r --force volumes"     'rm -r --force /var/lib/volumes/ollama'            deny
check "rm -f ... -r data"         'rm -f -r ./data'                                  deny
check "rm -Rf data dir"           'rm -Rf ./data/pgdata'                             deny
# #188: the force flag is NOT what makes it dangerous — recursive alone destroys.
check "rm -R data (no -f)"        'rm -R ./data'                                     deny
check "rm -r pgdata (no -f)"      'rm -r ./data/pgdata'                              deny
check "rm --recursive volumes"    'rm --recursive /var/lib/volumes'                  deny
check "rm -R ollama dir"          'rm -R ~/ollama'                                   deny
check "rm -R open-webui"          'rm -R ./open-webui'                               deny
# Quoted paths are the same delete — a trailing quote must not defeat the boundary.
check "rm -R quoted data"         'rm -R "./data"'                                   deny
check "rm -rf single-quoted"      "rm -rf './data/pgdata'"                           deny
# ...and the near-miss paths must STILL be allowed with quotes in play.
check "rm -R data-table (near)"   'rm -R ./src/app/data-table'                       allow
check "rm -R quoted metadata"     'rm -R "build/metadata"'                           allow
check "rm -f single file in data" 'rm -f ./data/file.txt'                            allow
# ...but a recursive rm outside the protected paths must still be allowed.
check "rm -R dist (no -f)"        'rm -R frontend/dist'                              allow
check "rm -r node_modules"        'rm -r node_modules'                               allow

# --- must ALLOW (ordinary dev / test — never impede) ---
check "compose down (no -v)"      'docker compose down'                              allow
check "compose up"                'docker compose up -d'                             allow
check "dropdb test_*"             'dropdb test_beaconfolio'                               allow
check "DROP DATABASE test_*"      'psql -c "DROP DATABASE IF EXISTS test_beaconfolio"'    allow
check "rm -rf dist"               'rm -rf frontend/dist'                             allow
check "rm -rf node_modules"       'rm -rf node_modules'                              allow
check "rm long-opts node_modules" 'rm --recursive --force node_modules'              allow
check "rm -f only (no -r)"        'rm -f ./data/tmp.lock'                            allow
check "rm -rf .angular cache"     'rm -rf .angular/cache'                            allow
check "rm -rf scratchpad"         'rm -rf /private/tmp/claude-501/scratchpad/x'      allow
check "pytest"                    'cd backend && ./venv/bin/pytest -q'               allow
check "git push"                  'git push origin HEAD'                             allow
check "docker volume ls"          'docker volume ls'                                 allow
check "docker volume inspect"     'docker volume inspect mavrovde_db'                allow

# --- must ALLOW: destructive text is a mere ARGUMENT, not an invocation ---
check "git commit mentions rm"    'git commit -m "guard blocks docker volume rm now"' allow
check "grep for pattern"          "grep -rn 'docker volume rm' .claude/hooks"        allow
check "echo the pattern"          'echo "do not run docker system prune"'            allow
check "grep DROP DATABASE"        "grep -rn 'DROP DATABASE mavrov' backend"          allow
check "commit mentions rm -rf"    'git commit -m "note: never rm -rf ./data"'        allow

# --- #204: PROSE is not a command -------------------------------------------
# A quoted argument that spans newlines is data. Before the fix, the raw newline
# inside the quotes split the argument into segments, so a line of prose that
# merely STARTED with a destructive verb was inspected as an invocation — which
# blocked writing docs and PR comments about the very commands this guard exists
# for, training reflexive GUARD_DESTRUCTIVE=0 use. Strings are assembled from
# ${D}/${T} so this test file cannot block its own execution.
D="rm -rf"; DR="rm -R"; T="./data"
check "multiline quoted prose"    "gh pr comment 1 --body \"line one
$D $T was blocked
done\""                                                                             allow
check "multiline quoted -R prose" "gh issue comment 1 --body \"why
$DR \\\"$T\\\" slipped through
end\""                                                                              allow
check "heredoc writing prose"     "cat > notes.md <<'EOF'
Never run $D $T on prod.
EOF"                                                                                 allow
check "echo prose to a file"      "echo \"$D $T\" > notes.md"                       allow
# ...and the same shapes must STILL deny when they are genuinely executable:
check "heredoc fed to bash"       "bash <<'EOF'
$D $T
EOF"                                                                                 deny
check "heredoc fed to ssh"        "ssh host bash -s <<'EOF'
$D $T
EOF"                                                                                 deny

# --- must ALLOW: explicit inline authorization bypass ---
check "inline bypass volume rm"   'GUARD_DESTRUCTIVE=0 docker volume rm mavrovde_db' allow

# --- must still DENY when actually invoked in a later pipeline segment ---
check "chained volume rm"         'docker volume ls && docker volume rm mavrovde_db' deny
check "sudo volume rm"            'sudo docker volume rm mavrovde_db'                deny

# --- hardening (PR #132 review): wrapped/indirect invocations must still DENY ---
check "xargs volume rm (rm ALL)"  'docker volume ls -q | xargs docker volume rm'    deny
check "xargs -n1 volume rm"       'docker volume ls -q | xargs -n1 docker volume rm' deny
check "bash -c volume rm"         'bash -c "docker volume rm mavrovde_db"'          deny
check "sh -c system prune"        'sh -c "docker system prune -af"'                 deny
check "eval volume rm"            'eval "docker volume rm mavrovde_db"'             deny
check "env wrapper volume rm"     'env FOO=bar docker volume rm mavrovde_db'        deny
check "xargs rm -rf data"         'find . -name x | xargs rm -rf /var/data'         deny

# --- hardening: stray bypass token must NOT disarm a real later invocation ---
check "stray bypass no disarm"    'echo GUARD_DESTRUCTIVE=0 && docker volume rm x'  deny
# --- but a real LEADING per-segment bypass is honored ---
check "leading bypass honored"    'GUARD_DESTRUCTIVE=0 docker volume rm mavrovde_db' allow
check "chained leading bypass"    'docker volume ls && GUARD_DESTRUCTIVE=0 docker volume rm x' allow
# --- xargs of a benign command still ALLOWed ---
check "xargs benign"              'ls *.log | xargs rm'                             allow

# --- quote-aware: a separator INSIDE a quoted arg is text, not an invocation ---
check "commit msg quoted pipe"    'git commit -m "idiom: docker volume ls | xargs docker volume rm"' allow
check "echo quoted pipe rm"       'echo "run: cat x | xargs rm -rf /data"'         allow
# --- but a REAL unquoted pipe to a destructive command still DENYs ---
check "real pipe xargs volume rm" 'cat volumes.txt | xargs docker volume rm'       deny

# --- MULTI-LINE QUOTED ARGUMENTS (#204) -------------------------------------
# This is the input class the #204 fix actually changed, and the one the first
# attempt at that fix got wrong: collapsing a quoted newline to a space fused a
# multi-line SCRIPT into one segment, so a benign leading `echo` hid everything
# after it and nine real destructions became allowed. The distinction is whether
# the quoted text is DATA (prose) or CODE (passed to a shell).
#
# Strings are assembled from $D/$T/$V parts so this file cannot block its own
# execution — the guard inspects the command that writes it, too.
D="rm -""rf"
DV="docker vol""ume rm"
DP="docker sys""tem prune"
DD="DR""OP DATA""BASE"
T="./""data"
V="mavrovde_db"

# CODE: newlines inside the quotes are command separators. Every one of these
# was DENIED before #204 and must stay denied.
check "sh -c: benign line then volume rm" "bash -c \"echo start
$DV $V\""                                                                        deny
check "sh -c: cd then rm -rf"             "sh -c \"cd /srv
$D $T\""                                                                         deny
check "eval: benign first line"           "eval \"echo hi
$DV $V\""                                                                        deny
check "sh -c single-quoted: prune"        "bash -c 'echo hi
$DP'"                                                                            deny
check "sh -c: sql database removal"       "bash -c \"echo ok
psql -c $DD mavrov\""                                                            deny
check "ssh: multi-line quoted body"       "ssh host \"cd /srv
$DV prod_db\""                                                                   deny
check "sh -c: destruction sandwiched"     "bash -c \"echo a
$D $T
echo b\""                                                                        deny
check "sh -c: leading newline"            "bash -c \"
$D $T\""                                                                         deny
check "unterminated quote then rm -rf"    "echo \"oops
$D $T"                                                                           deny

# DATA: the same newlines inside a quoted ARGUMENT are prose, and blocking them
# is what trained reflexive GUARD_DESTRUCTIVE=0 use.
check "multi-line quoted prose"           "gh pr comment 1 --body \"line one
$D $T was blocked
done\""                                                                          allow
check "heredoc written to a file"         "cat > notes.md <<'EOF'
$D $T is what #91 did.
EOF"                                                                             allow
check "heredoc fed to a shell"            "bash <<'EOF'
$D $T
EOF"                                                                             deny
check "heredoc fed to ssh"                "ssh host bash -s <<'EOF'
$DV $V
EOF"                                                                             deny

# --- HEREDOC OWNERSHIP AND FRAMING (#206 review round 2) --------------------
# Skipping a heredoc body is an EXEMPTION from a security control, so each of
# the three conditions that authorise it gets pinned here. Every case below was
# ALLOWED by the previous attempt at this fix.
#
# (a) The heredoc is consumed by the LAST command on the line, not the first.
#     Checking only the first token let a benign `echo` launder a shell heredoc —
#     the same first-token hole that broke the first version of this fix.
check "heredoc: echo && shell"       "echo 'cleaning up' && bash <<'EOF'
$DV $V
EOF"                                                                             deny
check "heredoc: pipe into shell"     "cat f | bash <<'EOF'
$DV $V
EOF"                                                                             deny
check "heredoc: echo ; sh"           "echo hi; sh <<'EOF'
$D $T
EOF"                                                                             deny

# (b) No terminator means we cannot know where the body ends, so nothing is
#     stripped. Skipping to EOF would have swallowed the destructive line.
check "heredoc: no terminator"       "cat > notes.md <<'EOF'
some docs
$DV $V"                                                                        deny

# (c) `<<` only counts as a redirect OUTSIDE quotes, and `<<<` is a here-string.
#     Otherwise merely WRITING ABOUT heredocs disarms the guard for every later
#     line — which is the #204 symptom turned into a bypass.
check "heredoc: << inside quotes"    "echo \"the <<HEREDOC form\"
cd /srv
$DV $V
$D $T
echo done"                                                                       deny
check "heredoc: grep for <<EOF"      "grep '<<EOF' notes.md
$DV $V"                                                                        deny
check "heredoc: commit msg <<EOF"    "git commit -m \"uses <<EOF here\"
$DV $V"                                                                        deny
check "heredoc: here-string <<<"     "cat <<<\"hello\"
$DV $V"                                                                        deny

# ssh option grammar must not decide whether the body is inspected. `-p 2222`
# etc. previously made the value look like the host and the host like the
# command, so the body was never reached.
check "ssh -p, multi-line body"      "ssh -p 2222 deploy@host \"cd /srv
$DV $V\""                                                                      deny
check "ssh -i, multi-line body"      "ssh -i ~/.ssh/k host \"echo hi
$D $T\""                                                                         deny
check "ssh -p, single-line body"     "ssh -p 2222 host \"$DV $V\""              deny
check "ssh -o, single-line body"     "ssh -o Port=22 host \"$DV $V\""           deny

# ...and the documents this exemption exists for are still allowed.
check "heredoc: tee to a file"       "tee notes.md <<'EOF'
$DV $V
EOF"                                                                             allow

# --- ESCAPED QUOTES (found by self-audit before round 3) --------------------
# A backslash escapes the next character everywhere except inside single quotes.
# Without that, `echo "a \" <<EOF"` looks like the quote closed early, the <<EOF
# reads as a real redirect, and a line of pure TEXT opens a heredoc that swallows
# the commands after it — a third instance of the same exemption-too-wide shape.
check "escaped quote fakes heredoc"  "echo \"a \\\" <<EOF\"
$DV $V
EOF"                                                                             deny
check "escaped quotes, no heredoc"   "echo \"say \\\"hi\\\" now\"
$DV $V"                                                                          deny
check "backslash inside single q"    "echo 'a \\ b'
$DV $V"                                                                          deny
check "prose with escaped quotes"    "gh pr comment 1 --body \"he said \\\"$D $T\\\" ok\"" allow

# --- THE HEREDOC EXEMPTION'S THREE CONDITIONS, PINNED (#206 review round 3) --
# Skipping a heredoc body is an exemption from a security control, so every
# condition that authorises it needs a test that fails without it. Round 3 showed
# `mask_quotes` was doing real work that NO case pinned — the terminator lookahead
# happened to cover the same inputs, so disabling the mask killed zero tests.

# The delimiter must be QUOTED. With an unquoted delimiter the shell EXPANDS the
# body, so `$(…)` and backticks in it execute — that body is code, not a
# document, and must stay inspected.
check "heredoc: unquoted delimiter"  "cat > n.md <<EOF
x=\$($D $T)
EOF"                                                                             deny
check "heredoc: dq delimiter ok"     "cat > notes.md <<\"EOF\"
$D $T here
EOF"                                                                             allow
check "heredoc: backslash delim ok"  "cat > notes.md <<\\EOF
$D $T here
EOF"                                                                             allow

# A `<<` inside a COMMENT is not a redirect.
check "heredoc: << in a comment"     "echo ok # <<'EOF'
$DV $V
EOF"                                                                             deny

# ...and a `<<` inside quotes is not either. This case exists specifically to
# pin mask_quotes: with the terminator present, the lookahead alone would let the
# body be stripped, so disabling the mask makes this case fail.
check "heredoc: << quoted, terminated" "grep \"<<'EOF'\" notes.md
$DV $V
EOF"                                                                             deny
check "heredoc: escaped quote + <<"  "printf \"a \\\" b <<'EOF'\"
$DV $V
EOF"                                                                             deny

# --- ONE QUOTING MODEL (#206 review round 4) --------------------------------
# mask_quotes and quote_split JOINTLY grant the heredoc exemption: the first
# decides whether a `<<` is a real redirect, the second decides whether every
# command on the line is a text tool. When only one of them understood backslash
# escapes they disagreed about what the line even was — `\"` looked like an
# unclosed quote to quote_split (so the line collapsed to one `echo`-led segment
# and read as "all text tools") while mask_quotes correctly saw a real redirect.
# An everyday commit message then hid a shell heredoc behind it.
#
# The existing "escaped quote + <<" case only covered an escaped quote FAKING an
# opener; these cover it HIDING the consuming shell, which 105/105 green missed.
check "escq: commit then shell hd"   "git commit -m \"escape the \\\" char\" ; bash <<'EOF'
$DV $V
EOF"                                                                             deny
check "escq: echo dq then shell hd"  "echo \\\" ; bash <<'EOF'
$DV $V
EOF"                                                                             deny
check "escq: echo sq then shell hd"  "echo \\' ; bash <<'EOF'
$DV $V
EOF"                                                                             deny
check "escq: printf then pipe sh"    "printf \\\" | sh <<'EOF'
$D $T
EOF"                                                                             deny
check "escq: inside a quoted arg"    "echo \"a \\\" b\" ; bash <<'EOF'
$DV $V
EOF"                                                                             deny
check "escq: then ssh bash -s"       "echo \"x \\\" y\" ; ssh host bash -s <<'EOF'
$DV $V
EOF"                                                                             deny
# ...and an escaped quote in an ordinary message stays allowed.
check "escq: commit msg, no heredoc" "git commit -m \"the \\\" char and $D $T\"" allow

# --- PACKED COMMANDS BEHIND A BENIGN TOKEN (#210) ---------------------------
# Two shapes where a destructive command hides behind something harmless. Both
# were allowed on `main` and are the same root cause as #204's rounds: the guard
# inspects the FIRST token of a segment, so anything that keeps the destruction
# out of first position slips past.

# (a) Separators packed INSIDE a shell wrapper's quoted argument. The outer
#     quote_split correctly protects them (they are inside quotes), so the whole
#     script arrives as one `echo`-led segment. The wrapper's argument is now
#     re-split as the script it is.
check "packed: ; inside bash -c"     "bash -c \"echo hi; $DV $V\""                deny
check "packed: && inside bash -c"    "bash -c \"echo hi && $D $T\""               deny
check "packed: || inside sh -c"      "sh -c \"false || $DV $V\""                  deny
check "packed: ; inside eval"        "eval \"echo hi; $DV $V\""                   deny
check "packed: nested bash -c"       "bash -c \"bash -c '$DV $V'\""               deny

# (b) A pipeline whose final stage is a shell reading stdin. `printf`/`echo` are
#     text tools and `bash` alone is not destructive, so neither segment looks
#     dangerous on its own — but the construct means "execute this text".
check "pipe: printf into bash"       "printf \"%s\" \"$DV $V\" | bash"            deny
check "pipe: echo into sh"           "echo \"$D $T\" | sh"                        deny
check "pipe: echo into sudo bash"    "echo \"$DV $V\" | sudo bash"                deny
check "pipe: echo into bash -s"      "echo \"$D $T\" | bash -s"                   deny

# (b2) THE SPELLING OF THE SHELL IS NOT A SECURITY BOUNDARY (#253).
#      FIVE of the seven cases below were MEASURED bypasses on the pre-fix hook
#      — the payload ran unguarded. (The other two, `/bin/bash` and the benign
#      control, already behaved; they are here to pin that the fix does not
#      regress them. Stating "every case below" would have been an overclaim —
#      the mutation run says 5, so the comment says 5.)
#      Cause: normalisation (absolute-path basename, leading backslash) happened
#      ONCE, AFTER the wrapper-peel loop had already given up. `/usr/bin/env
#      bash` was reduced to `env bash` with nothing left to peel it. Normalising
#      INSIDE the loop is what makes peeling iterative.
check "pipe: \\bash suppresses alias" "echo \"$DV $V\" | \\bash"                   deny
check "pipe: absolute env wrapper"   "echo \"$DV $V\" | /usr/bin/env bash"        deny
check "pipe: absolute sudo wrapper"  "echo \"$DV $V\" | /usr/bin/sudo bash"       deny
check "pipe: absolute timeout+opt"   "echo \"$DV $V\" | /usr/bin/timeout 60 bash" deny
check "pipe: absolute shell path"    "echo \"$DV $V\" | /bin/bash"                deny
check "pipe: stacked wrappers"       "echo \"$DV $V\" | /usr/bin/env /bin/bash"   deny
# …and the normalisation must not invent denials for innocent text.
check "pipe: benign via env wrapper" "echo \"hello\" | /usr/bin/env bash"         allow

# (b3) THE COST PREFILTER MUST NOT CHANGE A DECISION (#253 review round 1).
#      The first draft skipped mask_quotes for any segment with no QUOTE, on the
#      assumption it was then the identity. It is not: mask_quotes also
#      de-escapes `\X` (hook-parse-lib.sh:184) and blanks an unquoted `#`
#      comment (:200) — neither needs a quote. That assumption turned two
#      already-guarded commands into ALLOW, i.e. the optimisation opened a
#      bypass. These cases pin the wider predicate.
check "prefilter: backslash-escaped payload" "echo docker\\ volume\\ rm\\ $V | bash"  deny
check "prefilter: backslash-escaped rm -rf"  "echo rm\\ -rf\\ ./data | bash"          deny

# ...and none of that may cost a false denial.
check "pipe: benign echo into bash"  "echo \"hello\" | bash"                      allow
check "pipe: curl into bash"         "curl -s https://example.com/i.sh | bash"    allow
check "packed: benign bash -c"       "bash -c \"echo hello world\""               allow
check "packed: prose in bash -c"     "bash -c \"echo 'note: $D $T is bad'\""      allow
check "pipe: grep into wc, no shell" "grep -r \"$D $T\" docs/ | wc -l"            allow

# --- BOTH PASSES OVER A WRAPPER BODY ARE LOAD-BEARING (#210 review) ---------
# Re-splitting a wrapper's argument catches packed separators — but `quote_split`
# also treats `(`, `)` and backtick as separators, so a COMMAND SUBSTITUTION in
# the middle of an invocation fragments it, and the multi-condition rules
# (compose + `down` + `-v`; `rm` + recursive + data path) never see all their
# conditions in one piece. The fall-through that re-inspects the FLATTENED body
# as one segment is what catches those. Dropping it made the guard strictly
# weaker than before on these six paths.
DCMP="docker com""pose"
check "subst: compose down -v, \$()"  "bash -c \"$DCMP -f \$(echo docker-compose.yml) down -v\"" deny
check "subst: compose down -v, btick" "bash -c \"$DCMP -f \`echo docker-compose.yml\` down -v\"" deny
check "subst: eval compose down -v"   "eval \"$DCMP -f \$(echo docker-compose.yml) down -v\""    deny
check "subst: rm data, \$()"          "bash -c \"$D \$(pwd)/data\""                              deny
check "subst: rm data, backtick"      "bash -c \"$D \`pwd\`/data\""                              deny
check "subst: sh -c rm data"          "sh -c \"$D \$(pwd)/data\""                                deny
check "subst: eval rm data"           "eval \"$D \$(pwd)/data\""                                 deny

# --- A SHELL BY ANY OTHER SPELLING (#210 review, finding 3) -----------------
# The first version matched two exact spellings, which made it an allowlist of
# the forms that came to mind rather than a test for "is this a shell". Anything
# that is not `-c` reads its script from elsewhere — stdin, `-s`, `-`, a
# here-string — and text arriving by pipe is then code.
check "pipe: bash -x"                "echo \"$DV $V\" | bash -x"                   deny
check "pipe: bash -"                 "echo \"$DV $V\" | bash -"                    deny
check "pipe: absolute /bin/bash"     "echo \"$DV $V\" | /bin/bash"                 deny
# Root-level spelling: the old sed strip needed a SECOND '/' to fire, so `/bash`
# kept its slash and matched no shell name — allowed. The builtin strip (#235)
# takes the basename of any leading-'/' word, so it denies. Fail-closed, and one
# of only two decision changes #235 makes anywhere (the other is just below).
check "pipe: root-level /bash"       "echo \"$DV $V\" | /bash"                     deny
# Whitespace parity (#235 round-3 review): the fork-free path collapses inner
# whitespace only when it finds some, so the TRIGGER set must be exactly what
# the sed it replaced normalised. Testing only for a doubled space/tab left a
# lone \r (a CRLF-pasted line), \v or \f in place, `first` became `bash\r`,
# no shell was detected and a deny turned into an ALLOW — unexploitable (bash
# does not word-split on those) but a real, silent decision change. One case
# per character: a pin on \r alone would not have caught \v or \f.
check "pipe: bash + trailing CR"     "echo \"$DV $V\" | bash"$'\r'                 deny
check "pipe: bash + trailing VT"     "echo \"$DV $V\" | bash"$'\v'                 deny
check "pipe: bash + trailing FF"     "echo \"$DV $V\" | bash"$'\f'                 deny
# ...and the collapse must not invent a denial where there is none.
check "pipe: benign CR line"         'npm run build'$'\r'                          allow
# QUOTED spellings of the shell (#370): the shell list matched raw segment
# text, so every quoted spelling of the same binary piped a payload unguarded
# — measured allow×4 on main@32555b3 (issue table). Now argv_split (the ONE
# quoting model) reduces the segment before matching. All four spellings from
# the issue, each a distinct quoting mechanism; plus a quoted stdin FLAG,
# which the same raw-text matching also missed.
check "pipe: quoted \"bash\""        "echo \"$DV $V\" | \"bash\""                  deny
check "pipe: quoted 'bash'"          "echo \"$DV $V\" | 'bash'"                    deny
check "pipe: split ba\"sh\""         "echo \"$DV $V\" | ba\"sh\""                  deny
check "pipe: ansi \$'bash'"          "echo \"$DV $V\" | \$'bash'"                  deny
check "pipe: bash quoted \"-s\""     "echo \"$DV $V\" | bash \"-s\""               deny
# Backslash escapes are a quoting mechanism too (#370 round 1): both measured
# allow with the quote-only trigger class, same binary either way.
check "pipe: escaped ba\\sh"         "echo \"$DV $V\" | ba\\sh"                    deny
check "pipe: escaped b\\ash"         "echo \"$DV $V\" | b\\ash"                    deny
# ...and unquoting must not reclassify a benign quoted argument as a shell.
check "pipe: quoted non-shell"       "echo \"x\" | \"grep\" x"                     allow
# ...nor may the reduction break the FILE-operand exemption: `bash "ci.sh"`
# reduces to `bash ci.sh`, which reads the file, not the pipe — so even a
# DESTRUCTIVE piped payload is inert here. The payload must be destructive
# or the pin is vacuous: a benign one allows whatever the exemption answers
# (round-2 review measured exactly that against an exemption-deleted mutant).
check "pipe: quoted file operand"    "echo \"$DV $V\" | bash \"ci.sh\""            allow
check "pipe: sudo -E bash"           "echo \"$D $T\" | sudo -E bash"               deny
check "pipe: xargs -0 bash -c"       "echo \"$DV $V\" | xargs -0 bash -c"          deny
check "pipe: zsh"                    "echo \"$D $T\" | zsh"                        deny
# ...and ordinary xargs pipelines stay allowed.
check "pipe: benign xargs echo"      "ls | xargs -n1 echo"                         allow
check "pipe: xargs rm of logs"       "find . -name '*.log' | xargs rm -f"          allow

# The wrapper-depth bound must fail CLOSED: if it returned "nothing found", the
# bypass would simply be "nest one level deeper".
# A shell with a SCRIPT-FILE OPERAND reads that file, not the pipe. Phrasing the
# test as "any shell that is not -c" made it a negation, and it denied this
# repo's own pre-push-then-commit flow — §21.5 ("exempt via an allowlist, never a
# negation") and §21.7 ("a guard that fires on documentation is a real bug"),
# both of which I wrote before breaking them here.
check "operand: test.sh && commit"   "bash .claude/hooks/guard-destructive.test.sh && git commit -m \"$DV stays blocked\"" allow
check "operand: release && tag"      "bash release.sh --patch && git tag -a v1.11.0 -m \"$D $T guard\"" allow
check "operand: verify; gh release"  "time bash ./verify_all.sh; gh release create v1.11.0 --notes \"$DCMP down -v blocked\"" allow
check "operand: script + quoted arg" "bash ci.sh && echo \"$DV $V\""                allow
# A deeply nested destructive command is still caught — by the flattened-body
# pass, which is why denying AT the depth bound was unnecessary (and cost a false
# denial on benign deep nesting).
DEEP=""
for _i in 1 2 3 4 5 6 7 8 9; do DEEP="${DEEP}eval \""; done
DEEP="${DEEP}${DV} ${V}"
for _i in 1 2 3 4 5 6 7 8 9; do DEEP="${DEEP}\""; done
check "depth: 9 stacked evals"       "$DEEP"                                       deny
BENIGNDEEP=""
for _i in 1 2 3 4 5 6 7 8 9; do BENIGNDEEP="${BENIGNDEEP}eval \""; done
BENIGNDEEP="${BENIGNDEEP}echo hello"
for _i in 1 2 3 4 5 6 7 8 9; do BENIGNDEEP="${BENIGNDEEP}\""; done
# Refused, not allowed: at this depth the guard stops analysing, and an
# unanalysed command must not be let through. Deliberate trade — ordinary work
# does not nest shell wrappers 8 deep, and the cost of analysing it exceeds the
# hook's own timeout, at which point a "safe" allow is not safe at all.
check "depth: 9 deep but benign"     "$BENIGNDEEP"                                 deny

# --- OPTION VALUES ARE NOT SCRIPT OPERANDS (self-audit of the #214 allowlist) -
# `-o`, `--rcfile` and `--init-file` take a VALUE. Without consuming it, `bash -o
# posix` looked like it had a script operand, so the pipeline reading stdin was
# missed. The pair of directions is the point: the value must not be mistaken for
# a script, and a real script must still be recognised as one.
check "opt-value: -o posix"          "echo \"$DV $V\" | bash -o posix"             deny
check "opt-value: --rcfile"          "echo \"$DV $V\" | bash --rcfile /dev/null"   deny
check "opt-value: -x -s"             "echo \"$DV $V\" | bash -x -s"                deny
check "operand after -o value"       "bash -o posix deploy.sh"                     allow
check "operand after --rcfile value" "bash --rcfile /dev/null setup.sh"            allow
check "operand after -x"             "bash -x deploy.sh"                           allow

# --- THE ANALYSIS ITSELF MUST BE BOUNDED (#214 review round 3) --------------
# The hook is registered with a 15 s timeout, and a hook that times out does NOT
# deny — so unbounded analysis is a bypass in its own right: pad a command with
# enough inner commands and the guard never gets to answer. Cost was 2^depth
# (25 s at depth 9, against a command `main` decides in 153 ms) because the
# flattened pass re-descended the same subtree the inner pass had just walked.
#
# Two bounds now: the flattened pass runs only when it can help (the body
# contains `(`, `)` or a backtick — the fragmentation it exists for), and a
# wall-clock deadline stops analysis entirely. Both DENY when hit.
GUARD_INSPECT_DEADLINE=0 check "deadline: refuses rather than allows" "echo hello" deny
check "deadline: normal work unaffected" "echo hello"                              allow

# Analysis cost was 2^depth: the flattened pass re-descended the same subtree the
# inner pass had just walked. Depth 9 took 25 s against a command `main` decides
# in 153 ms — over the hook's 15 s timeout, i.e. an effective allow. These bound
# it. They are generous (a correct build answers in well under a second) so they
# fail on an exponential regression, not on a slow machine.
NEST7=""
for _i in 1 2 3 4 5 6 7; do NEST7="${NEST7}eval \""; done
NEST7="${NEST7}npm run build"
for _i in 1 2 3 4 5 6 7; do NEST7="${NEST7}\""; done
check_fast "cost: depth-7 nest is fast"   "$NEST7"                                 3
# A depth-9 nest trips the depth bound immediately, so timing it proves nothing —
# it passed at 0 s even against the exponential mutant. Time a nest that is
# BELOW the bound and carries quoted newlines, which is the shape whose cost
# actually blew up.
# A real backslash followed by a real newline. Written this way because inline it
# would be a line continuation *of this file* and vanish before the hook sees it.
BS="\\"$'\n'
# A command carrying a line continuation MUST run the flattened pass (it is the
# only thing that catches a fragmented invocation), and inside a nest that means
# running it at every level — so this shape stays exponential up to the depth
# bound. It is bounded, not flat, and the bound is what gets pinned: the deadline
# decides before the hook's own 15 s timeout. Measured: depth 7 ~6.5 s, depth 8
# denies at ~7.1 s, depth 10 denies at ~0.2 s via the depth bound. An ordinary
# continuation with no nesting is ~0.1 s.
NEST8NL=""
for _i in 1 2 3 4 5 6 7 8; do NEST8NL="${NEST8NL}eval \""; done
NEST8NL="${NEST8NL}npm run build${BS}  --verbose"
for _i in 1 2 3 4 5 6 7 8; do NEST8NL="${NEST8NL}\""; done
check_fast "cost: continuation nest bounded" "$NEST8NL"                            10
check_fast "cost: plain continuation fast"   "npm run build${BS}  --verbose"        1
check_fast "cost: 200-command wrapper"    "bash -c \"$(printf 'echo x; %.0s' $(seq 1 200))echo done\"" 8

# --- LINE CONTINUATION FRAGMENTS AN INVOCATION TOO ------------------------
# Making the flattened pass conditional (to kill the 2^depth cost) needed an
# exact answer to "what fragments a single invocation?". Parens and backticks
# were the documented answer; a LINE CONTINUATION is the one that was missed.
# bash joins `<cmd> \` + newline + `<args>` into ONE command, but the inner pass
# splits on that newline, so the multi-condition rules see only the halves.
#
# A BARE newline is deliberately not in that set: it genuinely terminates the
# command, so splitting there is correct — `<compose> -f a.yml` followed by
# `down -v` really is two commands, and the second is not destructive.
check "continuation: compose down -v" "bash -c \"$DCMP -f a.yml ${BS}down -v\""   deny
check "continuation: rm -rf data"     "bash -c \"$D ${BS}$T\""                    deny
check "continuation: twice"           "bash -c \"$DCMP ${BS}-f a.yml ${BS}down -v\"" deny

# --- THE test_* EXEMPTION MUST SURVIVE BEING WRAPPED (#214 review round 5) ---
# Unwrapping a wrapper strips its LEADING quote but not the trailing one, so an
# inner body arrives ending in a stray quote. Rule 4's boundary was `([ ]|$)`,
# which then failed to recognise a quoted scratch-DB name as a test database —
# denying the one destructive operation rule 9 explicitly authorises, on this
# repo's own prescribed test loop. Rule 5 was hardened for exactly this in #188;
# rule 4 was not. The suite missed it because it only pinned the bare form.
DBD="drop""db"
check "test-db: wrapped teardown"     "bash -c \"pytest -q; $DBD test_beaconfolio_review\""  allow
check "test-db: full pytest loop"     "bash -c \"cd backend && venv/bin/python -m pytest -q; $DBD test_beaconfolio_x\"" allow
check "test-db: sh -c single quotes"  "sh -c '$DBD test_beaconfolio'"                        allow
check "test-db: eval"                 "eval \"$DBD test_beaconfolio_ci\""                    allow
check "test-db: two scratch drops"    "bash -c \"$DBD test_beaconfolio_a; $DBD test_beaconfolio_b\"" allow
# ...and the exemption must not widen: a non-test database stays denied however
# it is wrapped.
check "test-db: non-test wrapped"     "bash -c \"pytest -q; $DBD mavrov\""              deny
check "test-db: non-test eval"        "eval \"$DBD production\""                        deny
check "test-db: suffix not prefix"    "bash -c \"$DBD mavrov_test\""                    deny

# The deadline's ALLOW side needs pinning too: a bound that only ever denies
# would pass every test while quietly denying ordinary work.
# 100 inner commands: comfortably inside the 8 s budget (~2 s), but enough that
# lowering the deadline flips it. A trivial 3-command case passed even at a 2 s
# deadline, so it pinned nothing — a bound that only ever denies would keep a
# green suite while quietly denying ordinary work.
BIGOK="bash -c \"$(printf 'echo x; %.0s' $(seq 1 100))echo done\""
check "deadline: allow side pinned"   "$BIGOK"                                      allow

# --- AN EXEMPTION'S BOUNDARY MUST NOT WIDEN (#214 review round 6) -----------
# The round-5 fix widened rule 4's boundary by copying rule 5's character class.
# Rule 5's class sits on a DENY condition, where wider means "denies more" —
# conservative. Rule 4's grants an EXEMPTION, where wider means "allows more".
# The same two characters therefore inverted: `=` let a test-database name in a
# FLAG disarm the rule while the operand was the production database.
#
# The suite could not catch it: every case pinned an operand-position name.
PRODDB="mav""rov"
check "exempt: flag names a test db"  "$DBD --dbname=test_x $PRODDB"                deny
check "exempt: quoted flag value"     "$DBD --dbname=\"test_x\" $PRODDB"            deny
check "exempt: flag after operand"    "$DBD $PRODDB --dbname=test_x"                deny
check "exempt: wrapped flag form"     "bash -c \"$DBD --dbname=test_x $PRODDB\""    deny
check "exempt: maintenance-db flag"   "$DBD --maintenance-db=test_x $PRODDB"        deny
# ...while a genuine flag alongside a scratch operand still works.
check "exempt: --if-exists scratch"   "$DBD --if-exists test_beaconfolio"                allow

# --- EVERY WRAPPER OUTSIDE THE LIST WAS A BYPASS (#217) ---------------------
# The unwrap loop recognised sudo/command/nohup/time/exec/env — an allowlist of
# the wrappers someone thought of. `nice`, `stdbuf`, `ionice`, `setsid`,
# `timeout`, `chrt`, `taskset`, `busybox` and `doas` each run the command that
# follows them unchanged, and every one of them carried a destruction straight
# past the guard, in both the direct and the piped-into-shell shape. Option
# VALUES must be consumed too: `nice -n 10 <destroy>` hid the destruction behind
# the value token.
check "wrap: nice"                    "nice $DV $V"                                 deny
check "wrap: nice -n 10 (sep value)"  "nice -n 10 $DV $V"                           deny
check "wrap: nice -n10 (joined)"      "nice -n10 $DP -af"                           deny
check "wrap: stdbuf -o0"              "stdbuf -o0 $DV $V"                           deny
check "wrap: ionice -c3"              "ionice -c3 $D $T"                            deny
check "wrap: setsid"                  "setsid $DV $V"                               deny
check "wrap: timeout 60 (operand)"    "timeout 60 $DV $V"                           deny
check "wrap: timeout -k 5 60"         "timeout -k 5 60 $DV $V"                      deny
check "wrap: chrt 50"                 "chrt 50 $DV $V"                              deny
check "wrap: taskset 0x1"             "taskset 0x1 $DV $V"                          deny
check "wrap: busybox applet"          "busybox $D $T"                               deny
check "wrap: doas"                    "doas $DV $V"                                 deny
check "wrap: stacked nice+sudo"       "nice -n10 sudo $DV $V"                       deny
check "wrap: sudo -u value consumed"  "sudo -u root $DV $V"                         deny
# ...the same wrappers in the piped-into-shell position.
check "wrap-pipe: nice bash"          "echo \"$DV $V\" | nice bash"                 deny
check "wrap-pipe: stdbuf -o0 bash"    "echo \"$D $T\" | stdbuf -o0 bash"            deny
check "wrap-pipe: busybox sh"         "echo \"$DV $V\" | busybox sh"                deny
check "wrap-pipe: timeout 60 bash"    "echo \"$D $T\" | timeout 60 bash"            deny
# ...and the ordinary commands these wrappers exist for stay allowed.
check "wrap: timeout 60 npm test"     "timeout 60 npm test"                         allow
check "wrap: nice -n10 npm build"     "nice -n10 npm run build"                     allow
check "wrap: ionice -c3 rsync"        "ionice -c3 rsync -a src/ dst/"               allow
check "wrap: stdbuf -oL coverage"     "stdbuf -oL npm run test:coverage"            allow
check "wrap: timeout verify_all"      "timeout 1800 bash ./verify_all.sh"           allow

# --- ' -execdir? ' NEVER MATCHED PLAIN -exec (#218) -------------------------
# In ERE the `?` binds to the single preceding character, so the pattern read as
# `-execdi` plus an optional `r`: it matched `-execdir` and `-execdi` but never
# the common `-exec` spelling, whose command was never inspected. `-ok`/`-okdir`
# are the same family (interactive, but they still execute). The branch is also
# gated on the segment's command BEING `find` — without the gate, widening the
# pattern would make a commit message that merely quotes `find -exec …` deny.
check "find: plain -exec destroys"    "find . -name '*.tmp' -exec $DV {} \\;"       deny
check "find: -execdir still denied"   "find . -name '*.tmp' -execdir $DV {} \\;"    deny
check "find: -ok destroys"            "find /x -ok $D $T {} \\;"                    deny
check "find: -okdir destroys"         "find /x -okdir $DV $V {} \\;"                deny
check "find: benign -exec rm -f"      "find . -name '*.log' -exec rm -f {} \\;"     allow
check "find: prose quoting -exec"     "git commit -m \"find . -exec $DV {} ;\""     allow

# --- ANSI-C QUOTING AND A LEADING BACKSLASH (#213) --------------------------
# $'…' is a THIRD quoting model with its own escape rules: \' is an escaped
# quote INSIDE the region, not a terminator, and \n expands to a real newline
# before the shell runs the text. Neither quoting function knew the model, so a
# destruction written this way was allowed. And a leading backslash on the
# command word (`\docker …`) only suppresses alias expansion — the same command
# runs — but it defeated every anchored rule.
check "ansi: bash -c \$'…' escaped q" "bash -c \$'$DV \\'$V\\''"                    deny
check "ansi: \$'…\\n…' second cmd"    "bash -c \$'echo hi\\n$DV $V'"                deny
check "ansi: eval \$'…'"              "eval \$'$DP -af'"                            deny
check "ansi: payload piped to bash"   "echo \$'$DV $V' | bash"                      deny
check "backslash: \\docker direct"    "\\$DV $V"                                    deny
check "backslash: sudo \\docker"      "sudo \\$DV $V"                               deny
check "backslash: inside bash -c"     "bash -c \"\\$DV $V\""                        deny
# ...and ANSI-C text on a text tool, or an alias-suppressed text tool, is prose.
check "ansi: prose on a text tool"    "git commit -m \$'note: $D $T blocked'"       allow
check "backslash: \\grep is grep"     "\\grep -rn \"$DV $V\" .claude/hooks"         allow

# --- BULK ALONE MUST NOT DEFEAT THE GUARD (#219) ----------------------------
# The quoting scan is pure bash and runs BEFORE the wall-clock deadline can see
# anything, so a large enough command used to outlive the hook's own 15 s
# timeout — and a hook that times out does NOT deny. Two halves to the fix:
# byte-wise scanning (LC_ALL=C) makes the scan ~3.5x cheaper, and an input-size
# bound (GUARD_MAX_CMD_LEN, default 24000) DENIES above it — refusing to analyse
# must never mean allowing. Wall-clock assertions, because correctness tests
# cannot see this failure mode: the decision is right, it merely arrives late.
PAD25K="$(printf 'x%.0s' $(seq 1 25000))"
check      "bound: 25k is denied"          "echo \"$PAD25K\""                       deny
check_fast "bound: 25k denied instantly"   "echo \"$PAD25K\""                       2
PAD6K="$(printf 'y%.0s' $(seq 1 6000))"
check      "bound: 6k prose is allowed"    "gh pr comment 1 --body \"$PAD6K\""      allow
check_fast "bound: 6k prose is fast"       "gh pr comment 1 --body \"$PAD6K\""      5
PAD16K="$(printf 'z%.0s' $(seq 1 16000))"
check_fast "bound: 16k inside the budget"  "echo \"$PAD16K\""                       4
# The bound is a knob, not a constant — and a malformed override must fall back
# to the default rather than switching the bound off.
GUARD_MAX_CMD_LEN=100 check "bound: override tightens" "echo \"$PAD6K\""            deny
GUARD_MAX_CMD_LEN=bogus check "bound: bogus override falls back" "echo ok"          allow

# --- A DOCUMENT THE SAME COMMAND EXECUTES IS A SCRIPT (#212) ----------------
# The #204 heredoc exemption is correct for `cat > notes.md <<'EOF'` — and wrong
# the moment the "document" is then run. All four exemption conditions held for
# write-then-execute, so the body was skipped. When the write target is executed
# by any line outside the body (bash/sh/source/`.`/exec, `./t`, or a chmod that
# touches it), the body now stays fully inspected.
check "w+x: cat > s.sh; bash s.sh"   "cat > s.sh <<'EOF'
$DV $V
EOF
bash s.sh"                                                                       deny
check "w+x: sh runs it"              "cat > s.sh <<'EOF'
$D $T
EOF
sh s.sh"                                                                         deny
check "w+x: source"                  "cat > s.sh <<'EOF'
$DV $V
EOF
source s.sh"                                                                     deny
check "w+x: dot-source"              "cat > s.sh <<'EOF'
$DV $V
EOF
. s.sh"                                                                          deny
check "w+x: chmod && ./s.sh"         "cat > s.sh <<'EOF'
$D $T
EOF
chmod +x s.sh && ./s.sh"                                                         deny
check "w+x: tee then bash"           "tee s.sh <<'EOF'
$DV $V
EOF
bash s.sh"                                                                       deny
# ...and the documents the exemption exists for stay documents.
check "w+x: notes.md then git add"   "cat > notes.md <<'EOF'
$D $T is what #91 did.
EOF
git add notes.md"                                                                allow
check "w+x: notes.md, no execution"  "cat > notes.md <<'EOF'
Never run $DV $V on prod.
EOF"                                                                             allow

# --- UNQUOTED PAYLOADS AND OTHER SHELL SPELLINGS (#220) ---------------------
# Only QUOTED arguments were re-read as code when a pipeline feeds a shell, so
# dropping the quotes was a bypass: `echo <destroy> | bash` executes identically.
# And the `-c` unwrap matched only the immediate `bash -c` form — an option
# before or around it (`-lc`, `-e -c`, `--login -c`) hid the script, as did the
# here-string spelling.
check "unq: echo payload into bash"  "echo $DV $V | bash"                         deny
check "unq: masked quotes stay text" "printf '%s ' $DV $V | sh"                   deny
check "spell: bash -lc"              "bash -lc \"$DV $V\""                        deny
check "spell: bash -e -c"            "bash -e -c \"$D $T\""                       deny
check "spell: bash --login -c"       "bash --login -c \"$DV $V\""                 deny
check "spell: sh -ec"                "sh -ec \"$DP -af\""                         deny
check "spell: bash <<< destroy"      "bash <<< \"$DV $V\""                        deny
check "spell: sh <<< destroy"        "sh <<< \"$D $T\""                          deny
# ...with no new false denials on the benign counterparts.
check "unq: benign unquoted pipe"    "echo hello world | bash"                    allow
check "spell: bash -lc benign"       "bash -lc \"echo hi\""                       allow
check "spell: here-string benign"    "bash <<< \"echo hi\""                       allow

# --- ROUND-1 REVIEW OF THIS PR (#225): the fixes' own regressions -----------
# 1. The first #212 fix forked greps per line per heredoc — O(heredocs×lines)
#    spawns, 27 s on a 2.2 KB command (50 text-heredoc blocks + one destroy),
#    past the 15 s hook timeout = the #219 bypass reintroduced. Wall-clock
#    pinned: the shape must DENY and answer inside the budget.
WXBOMB=""
for _i in $(seq 1 50); do WXBOMB+="cat > s.sh <<'EOF'
note about s.sh here
EOF
"; done
WXBOMB+="$DV $V"
check      "w+x cost: 50-heredoc destroy"      "$WXBOMB"                          deny
check_fast "w+x cost: answers in budget"       "$WXBOMB"                          8
# 2. The ANSI-C marker was the in-band character "A": a literal A inside $'…'
#    closed the region early — a bypass one way, a #204-class false denial the
#    other. Now an out-of-band control char, like NL_SENTINEL.
check "ansi: literal A then destroy"  "bash -c \$'echo DONE A\\n$DV $V'"          deny
check "ansi: prose containing A"      "git commit -m \$'Fix A; $D $T prose'"      allow
# 3. heredoc_write_target: a second redirect, a redirect AFTER the heredoc
#    word, and a quoted target must not hide the script.
check "w+x: 2>err.log beside target"  "cat > s.sh 2>err.log <<'EOF'
$DV $V
EOF
bash s.sh"                                                                       deny
check "w+x: redirect after heredoc"   "cat <<'EOF' > s.sh
$D $T
EOF
sh s.sh"                                                                         deny
check "w+x: quoted target"            "cat > 's.sh' <<'EOF'
$DV $V
EOF
bash s.sh"                                                                       deny
# 4. #220 arms were one character from evasion.
check "spell: <<<'x' no space"        "bash <<<'$DV $V'"                          deny
check "spell: -cx cluster"            "bash -cx \"$D $T\""                        deny
check "spell: -o posix -c"            "bash -o posix -c \"$DV $V\""               deny
# 5. env -S prepends its value to argv — the value IS the command.
check "wrap: env -S eats the command" "env -S $DV $V"                             deny
# ...and the benign counterparts stay allowed.
check "w+x: notes + err.log, no exec" "cat > notes.md 2>err.log <<'EOF'
$D $T prose
EOF
git add notes.md"                                                                allow
check "spell: bash -o posix script"   "bash -o posix deploy.sh"                   allow

# --- ROUND-2 REVIEW OF THIS PR (#225) ---------------------------------------
# The #212 execution scan violated the guard's own command-position principle:
# a bare space before `.` / a path admitted ARGUMENT positions, chmod matched
# any mode, and fd-redirect operands became "targets" — five ordinary
# doc-writing commands went allow→deny (the #204 class). Position + exec-mode
# aware now; both directions pinned.
check "w+x fp: git add . notes.md"   "cat > notes.md <<'EOF'
$D $T prose here
EOF
git add . notes.md"                                                              allow
check "w+x fp: ls -la . notes.md"    "cat > notes.md <<'EOF'
$D $T prose here
EOF
ls -la . notes.md"                                                               allow
check "w+x fp: chmod 644 notes.md"   "cat > notes.md <<'EOF'
$D $T prose here
EOF
chmod 644 notes.md"                                                              allow
check "w+x fp: later /dev/null"      "cat > notes.md 2>/dev/null <<'EOF'
$D $T prose
EOF
wc -l notes.md /dev/null"                                                        allow
check "w+x fp: grep -c . err.log"    "cat > notes.md 2>err.log <<'EOF'
$D $T prose
EOF
grep -c . err.log"                                                               allow
# ...while execute-intent chmod and command-position execution still deny.
check "w+x: chmod 755 then sh"       "cat > s.sh <<'EOF'
$DV $V
EOF
chmod 755 s.sh; sh s.sh"                                                         deny
# The deadline inside the heredoc machinery must fail CLOSED — it runs in a
# command substitution where a direct deny() is captured and fails OPEN
# (round-2 finding): past budget the body is handed through uninspected-strip
# and the main pass's deadline denies.
GUARD_INSPECT_DEADLINE=0 check "deadline: strip path fails closed" "cat > s.sh <<'EOF'
echo benign
EOF
bash s.sh"                                                                       deny
# Unterminated-heredoc cost: the terminator search forked a sed per line —
# O(lines^2) spawns, 52 s at 3.8 KB (round-2). Pure-bash ltrim + in-loop budget
# now: the same shape answers inside the budget.
UNTERM=""
for _i in $(seq 1 90); do UNTERM+="cat > longer-file-name-n$_i.md <<'EOF'
doc line without terminator
"; done
check_fast "cost: unterminated heredocs bounded" "$UNTERM"                       10
# `--` before the -c script is still the script.
check "spell: bash -c -- destroy"    "bash -c -- \"$DV $V\""                     deny

# --- ROUND-3 REVIEW OF THIS PR (#225): non-heredoc bulk shapes --------------
# Every earlier cost pin was heredoc- or nesting-shaped, which is why this
# survived three rounds: the token-peel loops (env-assignments, xargs options)
# forked 2-3 processes per token AFTER the one deadline check they passed —
# ~19 KB of env-assignments took 22 s, 12 KB of xargs options 18 s, both under
# the 24 KB size bound and past the 15 s hook timeout. Single-pass seds now;
# and correctness is pinned in BOTH directions: the peel must still reveal a
# destructive tail behind the bulk.
ENVRUN=""
for _i in $(seq 1 1400); do ENVRUN+="A$_i=xxxxxxxx "; done
check_fast "cost: 20KB env-assignment run"    "${ENVRUN}echo done"                8
check      "cost: env-run destroy tail"        "${ENVRUN}$DV $V"                  deny
check      "cost: env-run benign tail"         "${ENVRUN}npm run build"           allow
XOPTS="cat v.txt | xargs "
for _i in $(seq 1 1500); do XOPTS+="-a "; done
check_fast "cost: 5KB xargs-option run"       "${XOPTS}echo hi"                   8
check      "cost: xargs-opts destroy tail"     "${XOPTS}$DV"                      deny
# ...and the leading-run bypass check still honors a buried GUARD_DESTRUCTIVE=0.
check "bypass: mid-run GUARD_DESTRUCTIVE=0"   "FOO=1 GUARD_DESTRUCTIVE=0 $DV $V"  allow

# --- MANY-SEGMENT BULK (#235 — the last #219 residual) ----------------------
# pipes_into_shell forked ~3× per segment with no budget check: 5,000 ';'
# segments (10 KB) took 40 s — past the 15 s hook timeout, i.e. an unanalysed
# allow in production. Fork-free fast paths + a per-segment $SECONDS budget
# that fails CLOSED now: the shapes answer inside the budget (deny via the
# deadline is the designed answer for pathological bulk; an ordinary command
# with a normal segment count stays allowed — BIGOK above pins that side).
# These two carry no destructive payload, so BOTH decisions are correct for
# them (allow = analysed and clean; deny = budget, fail-closed) and pinning
# either would fail on a legitimate speed-up — cost is the only assertable
# property here, so they stay check_fast. Every case below that DOES carry a
# payload asserts decision and clock together with check_within.
MANYSEMI="$(printf 'x;%.0s' $(seq 1 5000))"
check_fast "cost: 5000 ;-segments in budget"  "$MANYSEMI"                        10
MANYPIPE="$(printf 'x|%.0s' $(seq 1 11000))"
check_fast "cost: 11000 |-segments in budget" "$MANYPIPE"                        10
# ...and a destructive tail behind the bulk must still be denied — IN TIME.
# As plain `check` this passed against the pre-fix hook at 40 s, i.e. it pinned
# nothing and asserted a deny production would never deliver (round-5 review).
check_within "cost: many-segment destroy tail" "${MANYSEMI}$DV $V"        deny 10
# The single-space shapes above take the fully fork-free path. ONE space more
# per segment and the whitespace collapse forks again, the budget is spent in
# pipes_into_shell, and (before the round-5 fix) 3,000 segments were handed to
# the payload pass — the one pre-inspection loop with no deadline check: 17.6 s
# measured, past the 15 s hook timeout. Pin the expensive shape too, or the
# blind spot this change closes survives one space to the right.
MANYDBL="$(printf 'a  b;%.0s' $(seq 1 3000))"
check_within "cost: double-space destroy tail" "${MANYDBL}$DV $V"         deny 10
# ...and the shape that actually enters the PAYLOAD pass. Every case above ends
# in a bare destructive command, so pipes_into_shell answers "not a shell" and
# the payload pass never runs — which is why deleting its deadline break left
# the whole suite green while this shape went from 7.1 s to 17.9 s, past the
# 15 s hook timeout (round-3 review; rule 2 — a fix needs a failing-first test).
# The piped shell makes pipes_into_shell return 0 legitimately, so the ~3
# forks per segment in that loop are paid 5,000 times unless the break is there.
# Measured on this shape: 7.1 s fixed, 17.9 s with the break deleted, 17.8 s
# with BOTH halves of the round-2 fix reverted, 53.5 s on the pre-#235 hook.
# The budget's `return 1` half has deliberately NO pin of its own: with the
# break in place, `return 0` enters the payload pass and leaves it immediately,
# so the two spellings produce the same decision at the same cost (measured
# 7.9 s vs 7.1 s) and there is nothing observable to assert. It stays because
# it does not depend on a sibling loop remembering to be bounded (§21.18) —
# and the case above fails the moment that assumption is violated.
check_within "cost: bulk + piped-shell payload" "${MANYSEMI}echo \"$DV $V\" | bash" deny 10

if [ "$fails" -eq 0 ]; then
  echo "All guard-destructive cases passed."
  exit 0
fi
echo "$fails guard-destructive case(s) FAILED."
exit 1
