import { Injector, StaticProvider, Type, runInInjectionContext } from '@angular/core';

/**
 * Construct a component or service the way a spec used to with
 * `new Thing(depA, depB, …)`, but resolving its dependencies from `providers`.
 *
 * WHY THIS EXISTS (#425). After the `inject()` migration a class takes **no**
 * constructor arguments — its dependencies come from the ambient injection
 * context — so the positional form silently wires nothing and the class blows up
 * on `inject()` instead. The cases that used it are the ones a `TestBed` fixture
 * cannot express: SSR / non-browser behaviour, where the point is to build the
 * component under `{ provide: PLATFORM_ID, useValue: 'server' }` while the
 * fixture in the same file runs under the browser platform.
 *
 * Every token the class injects must appear in `providers`; an omitted one
 * raises `NullInjectorError` rather than quietly arriving as `undefined`, which
 * is the same polarity the constructor form had (a missing argument was a type
 * error). Dependencies the class declares `{ optional: true }` may be left out.
 */
export function createInInjectionContext<T>(type: Type<T>, providers: StaticProvider[]): T {
  const injector = Injector.create({ providers });
  return runInInjectionContext(injector, () => new type());
}
