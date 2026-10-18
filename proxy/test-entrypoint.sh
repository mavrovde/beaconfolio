#!/bin/sh
# Real-entrypoint test: builds the ACTUAL proxy image and runs the ACTUAL /entrypoint.sh with
# a stub CMD, offline (--network none). Needs Docker. Run: sh proxy/test-entrypoint.sh
#
# Why this exists: entrypoint.sh splits PUBLIC_SERVER_NAME into a canonical host and aliases
# with `set --`. At script level that rewrote "$@" - the image CMD the final `exec "$@"` runs -
# and nginx never started (review of #492; the first version of that PR was verified against
# a COPY of the logic, not the entrypoint, which is how it got that far). The only honest test
# runs the real script and asks whether the CMD still runs.
#
#   sh proxy/test-entrypoint.sh              plain cases
#   sh proxy/test-entrypoint.sh --mutations  also prove the cases go red when the bug returns
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
IMG="beaconfolio-proxy-entrypoint-test:$$"
WORK="$(mktemp -d)"
FAILED=0
trap 'docker rmi -f "$IMG" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=$((FAILED + 1)); }

build() { # $1 = build context dir
    docker build -q -t "$IMG" "$1" >/dev/null
}

# run_cmd <PUBLIC_SERVER_NAME> -> stdout+stderr of: entrypoint, then the stub CMD
run_cmd() {
    docker run --rm --network none -e PUBLIC_SERVER_NAME="$1" "$IMG" echo CMD-RAN 2>&1
}

rendered() { # <PUBLIC_SERVER_NAME> -> the config the entrypoint rendered
    docker run --rm --network none -e PUBLIC_SERVER_NAME="$1" "$IMG" sh -c 'cat /etc/nginx/conf.d/default.conf' 2>&1
}

cmd_survives() { # <label> <PUBLIC_SERVER_NAME>
    if out="$(run_cmd "$2")" && printf '%s\n' "$out" | grep -qx 'CMD-RAN'; then
        pass "$1: the image CMD still runs"
    else
        fail "$1: the image CMD did not run -> $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
    fi
}

run_cases() {
    cmd_survives "two names" "beaconfolio.com www.beaconfolio.com"
    cmd_survives "one name" "example.test"
    cmd_survives "three names, extra whitespace" "  a.test   www.a.test  m.a.test "

    cfg="$(rendered "beaconfolio.com www.beaconfolio.com")"
    if printf '%s\n' "$cfg" | grep -q 'server_name www.beaconfolio.com;' \
        && printf '%s\n' "$cfg" | grep -q 'server_name beaconfolio.com localhost 127.0.0.1;' \
        && [ "$(printf '%s\n' "$cfg" | grep -c 'return 301 https://beaconfolio.com\$request_uri;')" = "2" ]; then
        pass "two names: alias block redirects to the canonical host (http + https)"
    else
        fail "two names: rendered config does not redirect www -> canonical"
    fi

    cfg="$(rendered "example.test")"
    if printf '%s\n' "$cfg" | grep -q 'server_name alias.invalid;'; then
        pass "one name: the placeholder keeps the alias block valid"
    else
        fail "one name: no alias placeholder in the rendered config"
    fi

    if out="$(run_cmd " ")"; then
        fail "whitespace-only PUBLIC_SERVER_NAME: expected a non-zero exit, got 0"
    elif printf '%s\n' "$out" | grep -q 'PUBLIC_SERVER_NAME is empty'; then
        pass "whitespace-only PUBLIC_SERVER_NAME: fails with a message that names the setting"
    else
        fail "whitespace-only PUBLIC_SERVER_NAME: failed without naming the setting -> $(printf '%s' "$out" | tail -1)"
    fi
}

echo "== real entrypoint, real image (plain cases)"
build "$DIR"
run_cases

if [ "${1:-}" = "--mutations" ]; then
    echo "== mutation contract: each deliberate regression must turn a case red"
    KILLED=0
    TOTAL=0
    # Each mutant = a sed program applied to a COPY of the build context.
    mutant() { # <name> <sed expr> <case to run: cmd|empty>
        TOTAL=$((TOTAL + 1))
        rm -rf "$WORK/ctx" && cp -R "$DIR" "$WORK/ctx"
        sed -e "$2" "$DIR/entrypoint.sh" > "$WORK/ctx/entrypoint.sh"
        if cmp -s "$DIR/entrypoint.sh" "$WORK/ctx/entrypoint.sh"; then
            echo "INVALID  $1 (the sed did not change the script)"
            FAILED=$((FAILED + 1))
            return
        fi
        build "$WORK/ctx"
        if [ "$3" = "cmd" ]; then
            if out="$(run_cmd "beaconfolio.com www.beaconfolio.com")" && printf '%s\n' "$out" | grep -qx 'CMD-RAN'; then
                echo "SURVIVED  $1"
                FAILED=$((FAILED + 1))
            else
                echo "KILLED    $1"
                KILLED=$((KILLED + 1))
            fi
        else
            # The plain case passes only for "non-zero exit WITH the message"; a mutant is
            # killed when the entrypoint no longer behaves that way.
            if out="$(run_cmd " ")"; then
                echo "KILLED    $1 (exit 0 on an empty list)"
                KILLED=$((KILLED + 1))
            elif printf '%s\n' "$out" | grep -q 'PUBLIC_SERVER_NAME is empty'; then
                echo "SURVIVED  $1"
                FAILED=$((FAILED + 1))
            else
                echo "KILLED    $1 (failed without the message)"
                KILLED=$((KILLED + 1))
            fi
        fi
    }
    # 1. the original bug: split at script level instead of in a function
    mutant "set -- at script level (clobbers the image CMD)" \
        's/^derive_public_hosts || exit 1$/set -- ${PUBLIC_SERVER_NAME}; PUBLIC_CANONICAL_HOST="$1"; shift; PUBLIC_ALIAS_HOSTS="${*:-alias.invalid}"/' cmd
    # 2. the empty-name guard removed
    mutant "empty PUBLIC_SERVER_NAME no longer rejected" \
        's/\[ "\$#" -lt 1 \]/false/' empty
    echo "mutants killed: $KILLED/$TOTAL"
fi

if [ "$FAILED" -ne 0 ]; then
    echo "$FAILED check(s) FAILED"
    exit 1
fi
echo "all checks passed"
