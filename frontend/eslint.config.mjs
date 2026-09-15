// @ts-check
/**
 * Workspace ESLint (flat config) — #234, the AST successor to #118's
 * dependency-free heuristic lint.
 *
 * Three projects, one config: `shared` (lib prefix), `public` and `admin`
 * (app prefix). Non-type-aware rule sets only — the pre-push gate runs this
 * under the owner's hard sub-minute budget, and type-checked linting costs a
 * full program build per project.
 */
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import angular from "angular-eslint";

/**
 * cd-safety (#94/#118): in the ZONELESS apps, a `this.*` assignment inside a
 * subscribe/then/setInterval/setTimeout callback with no markForCheck( /
 * detectChanges( in that callback renders once and never repaints. These
 * esquery selectors are the AST port of scripts/check-cd-safety.mjs — unlike
 * the heuristic, a comment mentioning markForCheck can never satisfy them,
 * and extracted-but-inline callbacks are followed by structure, not by
 * paren-balancing. Scope mirrors the heuristic exactly (public + admin src,
 * no *.spec.ts / *.server.ts; shared is a library with no view to repaint —
 * see the scope rationale preserved in git history of check-cd-safety.mjs).
 * KNOWN LIMIT carried over: an `await`-then-assign continuation has no
 * callback node, so it is still not flagged.
 * Suppress a justified case with
 * `// eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: <reason>`.
 */
const CALLBACK = ":matches(ArrowFunctionExpression, FunctionExpression)";
const NO_REPAINT = `:not(:has(CallExpression[callee.property.name=/^(markForCheck|detectChanges)$/]))`;
// this.a = …  and  this.a.b = …  (the shapes the codebase actually writes;
// signal writes are CallExpressions, so they can never match an assignment).
const THIS_ASSIGN =
  ":matches(AssignmentExpression[left.object.type='ThisExpression'], AssignmentExpression[left.object.object.type='ThisExpression'])";
const CD_SAFETY_MESSAGE =
  "zoneless app: this.* assigned in an async callback with no markForCheck/detectChanges in that callback — the view never repaints (#94/#118). Use the async pipe, a signal, or ChangeDetectorRef.markForCheck(); or suppress with `// eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: <reason>`.";
const cdSafetySelectors = [
  `CallExpression[callee.property.name=/^(subscribe|then)$/] > ${CALLBACK}${NO_REPAINT} ${THIS_ASSIGN}`,
  `CallExpression[callee.name=/^(setInterval|setTimeout)$/] > ${CALLBACK}${NO_REPAINT} ${THIS_ASSIGN}`,
].map((selector) => ({ selector, message: CD_SAFETY_MESSAGE }));

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      ".angular/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    files: ["projects/**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: ["app", "lib"], style: "camelCase" },
      ],
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: ["app", "lib"], style: "kebab-case" },
      ],
      // The underscore convention marks a deliberately unused binding
      // (interface-mandated params, destructuring holes).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // BASELINED at adoption (#234): 127 pre-existing constructor-injection
      // sites. The fix is the official codemod (`ng generate
      // @angular/core:inject`) — a mechanical, whole-workspace migration that
      // belongs in its own PR (dependency-policy reasoning: big mechanical
      // rewrites ride alone), tracked as a follow-up issue. New code should
      // use inject(); flip this to "error" when the codemod lands.
      "@angular-eslint/prefer-inject": "off",
    },
  },
  {
    // Spec files and the shared testing doubles: `any` is the price of
    // terse mock plumbing (vi.fn() wiring, partial fakes). 311 of the 352
    // adoption-time hits were here; production code keeps the rule.
    files: [
      "projects/**/*.spec.ts",
      "projects/shared/src/lib/testing/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // The zoneless repaint rule, scoped exactly like its heuristic
    // predecessor. Spec files bundle zone.js via the test setup and server
    // entries never repaint a browser view.
    files: ["projects/public/src/**/*.ts", "projects/admin/src/**/*.ts"],
    ignores: ["**/*.spec.ts", "**/*.server.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...cdSafetySelectors],
    },
  },
  {
    files: ["projects/**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {
      // BASELINED at adoption (#234): 217 pre-existing *ngIf/*ngFor sites.
      // The fix is the official codemod (`ng generate
      // @angular/core:control-flow`) — same reasoning as prefer-inject
      // above: mechanical whole-workspace rewrite, own PR, tracked as a
      // follow-up issue. Flip to "error" when the codemod lands.
      "@angular-eslint/template/prefer-control-flow": "off",
    },
  },
);
