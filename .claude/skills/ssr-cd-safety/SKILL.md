---
name: ssr-cd-safety
description: >-
  The SSR + zoneless change-detection contract for frontend/projects/public AND
  frontend/projects/admin — the silent-failure class unit tests CANNOT catch (they bundle zone.js;
  neither app does). Consult BEFORE writing or reviewing any public- or admin-app component that
  updates from subscribe/setInterval/setTimeout/fetch callbacks, and before touching HttpBackend /
  interceptors / the transfer cache / SSR hydration.
  Encodes: async mutation ⇒ markForCheck | signal | async pipe; SSR URL rewrite lives in an
  HttpBackend delegating to HttpXhrBackend (never FetchBackend); E2E — not unit tests — is the only
  gate that sees violations.
---

# SSR + zoneless CD safety (#118)

The class behind #94 (footer frozen at `BE: vUnknown` while the fetch returned 200) and the #84
revert. Unit tests pass while the browser silently breaks, because `test-setup.ts` bundles
`zone.js` and the shipped app does not.

## The zoneless contract (BOTH browser apps — public and admin)

**Public** — `frontend/projects/public/src/app/app.config.ts:23` calls
`provideZonelessChangeDetection()` explicitly (#105).

**Admin — zoneless too, by default (#276).** This was gotten wrong for a whole release cycle: the
cd-safety lint scoped itself to `projects/public` on the stated premise that "the admin app is
zone-based CSR". It is not. `frontend/angular.json` gives the **admin** project no `polyfills`
entry (identical to public → no zone.js is bundled; `grep -rl __zone_symbol__ dist/admin/` returns
nothing), and `projects/admin/src/app/app.config.ts` provides no `provideZoneChangeDetection()`, so
`@angular/core`'s `ZONELESS_ENABLED` token default (`factory: () => true`, verified in 22.1.4)
applies. Proven reachable in the browser: stripping the `addNote()` `detectChanges()` from the
served pipeline chunk made `frontend/e2e/admin/pipeline.spec.ts` fail while its API assertion still
passed — the note reached the server and the operator never saw it. **Consequence: every rule below
applies to admin components exactly as it does to public ones**, and
`npm run lint` (the #234 eslint cd-safety rule) scans both roots.

Neither app has `zone.js` at runtime. Therefore **nothing repaints on its own**: change detection
runs only for signals, the `async` pipe, template events, and explicit
`markForCheck()`/`detectChanges()`.

**Rule: every async mutation needs an explicit repaint path.** A component property assigned inside
`subscribe(…)`, `setInterval(…)`, `setTimeout(…)`, a promise `.then`, or an `await` continuation
will render **once and never again** unless one of these holds:
1. the value is a **signal** (`this.count.set(...)` / `update`), or
2. the template consumes an **Observable via the `async` pipe** (preferred house style —
   `value$ | async`, composed with `switchMap`/`catchError`/`shareReplay`), or
3. the callback ends with `this.cdr.markForCheck()` (inject `ChangeDetectorRef`; pattern in
   `stats.component.ts`, `blog.component.ts`).

Audit grep (what the reviewer runs): in `projects/public` **and `projects/admin`**, find
`subscribe(`/`.then(`/`setInterval(`/`setTimeout(` callbacks that assign `this.<prop> =` with no
`markForCheck` in the same callback and no signal/async-pipe consumption of that property —
`npm run lint` (the #234 eslint cd-safety rule) automates exactly this over both roots. An `await`-then-assign
continuation is the heuristic's known blind spot (needs the #234 AST lint) — check those by eye.

**Rule (the READ direction, #255): never read an async-populated field synchronously in
`ngOnInit` — compose off the stream.** The mirror image of the repaint rule: a constructor
subscription filling `this.site` looks done by `ngOnInit`, but on SSR the router resolves in a
microtask while the config HTTP response is a macrotask — `ngOnInit` reads the placeholder, bakes
it into interpolated strings (SEO meta, JSON-LD), and NO later re-apply can repair strings already
built. Fix: `config$.pipe(take(1)).subscribe(cfg => updateSeo(...))` so SSR's stability tracking
waits for the value. Unit-pin it with a NOT-yet-emitted `ReplaySubject` (assert nothing applied,
then emit, assert applied) — every eager `of(config)` mock emits during construction and hides the
race, which is why 321 green tests missed it. E2E only asserts the `<title>`, so it can't see a
wrong meta description either — this class is invisible to both gates without that specific pin.

## The SSR HTTP contract

- The SSR relative→absolute URL rewrite lives in a custom **`HttpBackend`**
  (`interceptors/ssr-http-backend.ts`, wired `{provide: HttpBackend, useClass: SsrHttpBackend}`) —
  NOT in an interceptor. An `HttpInterceptorFn` runs before Angular's transfer-cache interceptor,
  so the server would key the cache on the rewritten absolute URL while the browser keys the
  relative one → keys never match → hydration re-fetches everything (#25 "flash to home").
- **Delegate to `HttpXhrBackend`, never `FetchBackend`.** The app has always been XHR on both
  platforms; #84 switched to Fetch, was 100% green in unit tests and review, and deterministically
  broke the browser's only real fetch in the prod E2E across 4 deploy attempts. Only the revert
  greened it.
- Guard all DOM access with `isPlatformBrowser()`.

## Why your tests lie to you

- Unit tests bundle zone.js → the anti-pattern repaints in tests and freezes in production.
- PR CI runs CodeQL only → a violation sails through review.
- **The full Docker E2E is the only automated gate that sees this class by default** — run it
  before merging any change touching this file's subject matter (`/e2e`, lessons-learned §1–§3).
  When you change user-visible behavior, grep ALL e2e specs for assertions on the OLD behavior
  (#108→#110).

## Making a UNIT test see it anyway (#276)

The "unit tests can't catch this" limitation is about the *default* TestBed, not a law. A spec can
model the shipped runtime by opting its own TestBed into zoneless:

```ts
TestBed.configureTestingModule({
  providers: [provideZonelessChangeDetection(), /* mocks */],
});
```

Then drive change detection **only** the way the browser would:
- `await fixture.whenStable()` for anything that repaints via `markForCheck()` / the `async` pipe;
- for a `setTimeout` auto-clear, `vi.useFakeTimers()` + `vi.advanceTimersByTime(n)` and then assert
  the DOM **without** calling `detectChanges()` (the component's own `detectChanges()` must do it).

Never call `fixture.detectChanges()` after the action under test — that forces the repaint the
component failed to request and turns the pin into a decoration. `*.zoneless.spec.ts` beside the
four admin components fixed in #276 are the worked examples; each was mutation-checked (revert the
component, spec goes red). Expect a harmless `NG0914` warning on stderr: `src/test-setup.ts` still
loads zone.js for every other spec.

## When adding a new public OR admin component

Default to the house style: expose `Observable` fields consumed with `value$ | async`. Reach for
signals for small local state. If you must assign imperatively in a callback, inject
`ChangeDetectorRef` and `markForCheck()` — and say in the PR why the async pipe didn't fit.
