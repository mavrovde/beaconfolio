#!/usr/bin/env node
/**
 * Mutation-check for the #234 cd-safety ESLint rule (the AST successor to
 * check-cd-safety.mjs): drops probe files into the RULE'S REAL SCOPE
 * (projects/public/src) and runs the workspace `eslint` on them, so what is
 * verified is the actual eslint.config.mjs the gate and CI run — not a copy
 * of the selectors. Seven probes:
 *   1. the #94 anti-pattern (subscribe-and-assign, no repaint)  → MUST flag
 *   2. the same callback with markForCheck()                    → MUST pass
 *   3. a signal write (.set()) instead of an assignment         → MUST pass
 *   4. the documented eslint-disable suppression                → MUST pass
 *   5. the observer-object shape, subscribe({ next })           → MUST flag
 *   6. the observer-object shape with markForCheck()            → MUST pass
 *   7. observer object where only `error` repaints              → MUST flag
 *      (each handler is judged on its OWN repaint)
 * Probes 5-7 exist because every earlier probe was built from the
 * direct-callback template, leaving the test structurally blind to
 * subscribe({…}) — the exact shape the direct-child selector silently
 * skipped (#423 round 1, blocker 2). Probe 1 (or 5) failing to flag means
 * the rule is neutered — exactly the fake-green this test exists to catch
 * (issue #234 AC 2).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = join(fileURLToPath(new URL(".", import.meta.url)), "..");
// Inside the rule's scope on purpose — a temp dir outside projects/public
// would never match the config block under test.
const PROBE_DIR = mkdtempSync(
  join(FRONTEND, "projects", "public", "src", "cd-safety-probe-"),
);

const VIOLATION = `export class CdSafetyProbe {
  value = '';
  probe(source: { subscribe(cb: (v: string) => void): void }): void {
    source.subscribe((v) => {
      this.value = v;
    });
  }
}
`;

const REPAINTED = VIOLATION.replace(
  "this.value = v;",
  "this.value = v;\n      this.cdr.markForCheck();",
).replace("value = '';", "value = '';\n  cdr = { markForCheck: () => undefined };");

const SIGNAL_WRITE = `export class CdSafetyProbe {
  value = { set: (_v: string) => undefined };
  probe(source: { subscribe(cb: (v: string) => void): void }): void {
    source.subscribe((v) => {
      this.value.set(v);
    });
  }
}
`;

const OBSERVER_VIOLATION = `export class CdSafetyProbe {
  value = '';
  probe(source: { subscribe(obs: { next: (v: string) => void }): void }): void {
    source.subscribe({
      next: (v) => {
        this.value = v;
      },
    });
  }
}
`;

const OBSERVER_REPAINTED = OBSERVER_VIOLATION.replace(
  "this.value = v;",
  "this.value = v;\n        this.cdr.markForCheck();",
).replace("value = '';", "value = '';\n  cdr = { markForCheck: () => undefined };");

// Only the error handler repaints — the next handler must still be flagged,
// pinning the per-handler judgment (a :has() over the whole observer object
// would let one handler's markForCheck excuse every other handler).
const OBSERVER_MIXED = `export class CdSafetyProbe {
  value = '';
  cdr = { markForCheck: () => undefined };
  probe(source: {
    subscribe(obs: { next: (v: string) => void; error: (e: unknown) => void }): void;
  }): void {
    source.subscribe({
      next: (v) => {
        this.value = v;
      },
      error: () => {
        this.value = '';
        this.cdr.markForCheck();
      },
    });
  }
}
`;

const SUPPRESSED = VIOLATION.replace(
  "      this.value = v;",
  "      // eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: probe fixture\n      this.value = v;",
);

function lint(file) {
  // eslint exits 1 on findings; the JSON on stdout is what we assert on.
  let out;
  try {
    out = execFileSync("npx", ["eslint", "--format", "json", file], {
      cwd: FRONTEND,
      encoding: "utf8",
    });
  } catch (e) {
    if (e.stdout) out = e.stdout;
    else throw e;
  }
  return JSON.parse(out)
    .flatMap((f) => f.messages)
    .map((m) => m.ruleId);
}

const cases = [
  ["anti-pattern is flagged", "violation.ts", VIOLATION, true],
  ["markForCheck exempts", "repainted.ts", REPAINTED, false],
  ["signal write passes", "signal.ts", SIGNAL_WRITE, false],
  ["documented suppression works", "suppressed.ts", SUPPRESSED, false],
  ["observer-object anti-pattern is flagged", "observer.ts", OBSERVER_VIOLATION, true],
  ["observer-object markForCheck exempts", "observer-repainted.ts", OBSERVER_REPAINTED, false],
  ["observer handlers judged individually", "observer-mixed.ts", OBSERVER_MIXED, true],
];

let failed = 0;
try {
  for (const [name, file, content, expectHit] of cases) {
    const p = join(PROBE_DIR, file);
    writeFileSync(p, content);
    const rules = lint(p);
    const hit = rules.includes("no-restricted-syntax");
    const stray = rules.filter((r) => r !== "no-restricted-syntax");
    if (hit === expectHit && stray.length === 0) {
      console.log(`  ok: ${name}`);
    } else {
      failed++;
      console.error(
        `  FAIL: ${name} — expected ${expectHit ? "a" : "no"} cd-safety hit, got [${rules}]`,
      );
    }
  }
} finally {
  rmSync(PROBE_DIR, { recursive: true, force: true });
}

if (failed) {
  console.error(`eslint-cd-safety: FAIL (${failed} case(s))`);
  process.exit(1);
}
console.log(
  "eslint-cd-safety: OK (7 cases — the #94 anti-pattern stays pinned in both subscribe shapes)",
);
