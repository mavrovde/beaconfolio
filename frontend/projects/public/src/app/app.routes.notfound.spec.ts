import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, RESPONSE_INIT, provideZonelessChangeDetection } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { routes } from './app.routes';
import { NotFoundComponent } from './components/not-found/not-found.component';
import { SeoService } from './services/seo.service';
import { YearsService } from './services/years.service';
import { provideTestBrand } from '@beaconfolio/shared/testing';

/**
 * #324 — the wildcard route itself. Without the `**` entry an unmatched URL
 * never reaches Angular: the router rejects the navigation, the SSR engine
 * declines the request, and Express answers with its bare `Cannot GET /…` page.
 *
 * Mutation contract: delete the `**` route from `app.routes.ts` and both the
 * ordering assertion and every navigation case below go red.
 *
 * These cases run the REAL `routes` against `PLATFORM_ID: 'server'` with a
 * `RESPONSE_INIT` provided the way @angular/ssr provides it, which is as close
 * to the SSR contract as this suite can get. A full `renderApplication()` from
 * `@angular/platform-server` was tried and does NOT work here: `test-setup.ts`
 * installs the jsdom `BrowserDomAdapter` before any spec runs, and
 * `setRootDomAdapter` is `_DOM ??= adapter` (first one wins), so domino never
 * becomes current and `Meta` creates jsdom elements inside a domino document
 * (`TypeError: node.isAncestor is not a function`). The over-the-wire status +
 * markup assertion therefore lives in `e2e/public/not-found.spec.ts`, which is
 * the layer that can actually enforce it.
 */
describe('app routes — wildcard 404 (#324)', () => {
    it('declares a `**` route LAST (anything after it would be dead)', () => {
        const wildcardIndex = routes.findIndex((route) => route.path === '**');

        expect(wildcardIndex).toBeGreaterThan(-1);
        expect(wildcardIndex).toBe(routes.length - 1);
    });

    it('lazy-loads NotFoundComponent for the wildcard route', async () => {
        const wildcard = routes.find((route) => route.path === '**')!;

        expect(wildcard.loadComponent).toBeDefined();
        await expect(wildcard.loadComponent!()).resolves.toBe(NotFoundComponent);
    });

    // The `for/:slug` and `blog/:slug` routes must keep winning over `**`
    // (acceptance criterion 3: no regression on the paths that were correct).
    describe('navigation', () => {
        let responseInit: ResponseInit;

        beforeEach(() => {
            TestBed.resetTestingModule();
            responseInit = { status: 200, headers: new Headers() };
            TestBed.configureTestingModule({
                providers: [
                  ...provideTestBrand(),
                    provideZonelessChangeDetection(),
                    provideRouter(routes),
                    { provide: PLATFORM_ID, useValue: 'server' },
                    { provide: RESPONSE_INIT, useValue: responseInit },
                    {
                        provide: SeoService,
                        useValue: {
                            setNotFound: vi.fn(),
                            setNoIndex: vi.fn(),
                            updateSeo: vi.fn(),
                            setJsonLd: vi.fn(),
                            jsonLdSchema$: of(null),
                        },
                    },
                    { provide: YearsService, useValue: { getYears: () => of([2024]) } },
                ],
            });
        });

        it.each(['/does-not-exist', '/deep/unknown/path', '/blog/extra/segments'])(
            'renders the branded 404 (and a real SSR 404 status) for %s',
            async (url) => {
                const harness = await RouterTestingHarness.create();
                const component = await harness.navigateByUrl(url, NotFoundComponent);

                expect(component).toBeInstanceOf(NotFoundComponent);
                expect(
                    harness.routeNativeElement!.querySelector('[data-testid="page-not-found"]'),
                ).toBeTruthy();
                // The point of the route: the response is a real 404, not a
                // 200 carrying "not found" text.
                expect(responseInit.status).toBe(404);
            },
        );

        // Matched against the ROUTE CONFIG rather than the rendered component:
        // navigating without an outlet activates the route without constructing
        // the page, which is all this assertion needs.
        it.each([
            ['/', ''],
            ['/blog', 'blog'],
            ['/blog/a-real-slug', 'blog/:slug'],
            ['/for/a-real-link', 'for/:slug'],
            ['/cv', 'cv'],
            ['/llm', 'llm'],
        ])('leaves the known URL %s to the %s route (no wildcard capture)', async (url, path) => {
            const router = TestBed.inject(Router);

            expect(await router.navigateByUrl(url)).toBe(true);
            expect(router.routerState.snapshot.root.firstChild?.routeConfig?.path).toBe(path);
        });
    });
});
