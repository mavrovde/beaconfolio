import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
    PLATFORM_ID,
    RESPONSE_INIT,
    provideZonelessChangeDetection,
} from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockTranslatePipe } from '@beaconfolio/shared/testing';

import { NotFoundComponent } from './not-found.component';
import { SeoService } from '../../services/seo.service';
import { SiteConfigService } from '../../services/site-config.service';
import { YearsService } from '../../services/years.service';
import { provideTestBrand } from '@beaconfolio/shared/testing';

/**
 * #324 — the branded wildcard 404.
 *
 * The TestBed opts into `provideZonelessChangeDetection()` so it models the
 * shipped runtime (neither browser app bundles zone.js): the requested path is
 * rendered through the `async` pipe, and a later emission must repaint without
 * anyone calling `detectChanges()` for it.
 */
describe('NotFoundComponent (#324)', () => {
    let seoServiceSpy: { setNotFound: any; setNoIndex: any; updateSeo: any };
    let urlSubject: BehaviorSubject<{ path: string }[]>;

    function setup(
        platform: 'server' | 'browser',
        responseInit: ResponseInit | null,
        segments: string[] = ['does-not-exist'],
    ): ComponentFixture<NotFoundComponent> {
        seoServiceSpy = { setNotFound: vi.fn(), setNoIndex: vi.fn(), updateSeo: vi.fn() };
        urlSubject = new BehaviorSubject(segments.map((path) => ({ path })));

        TestBed.configureTestingModule({
            imports: [NotFoundComponent, MockTranslatePipe],
            providers: [
              ...provideTestBrand(),
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: SeoService, useValue: seoServiceSpy },
                { provide: PLATFORM_ID, useValue: platform },
                { provide: RESPONSE_INIT, useValue: responseInit },
                { provide: ActivatedRoute, useValue: { url: urlSubject.asObservable() } },
                // The rendered site chrome (app-header) would otherwise fire a
                // real /api/app/cv/years request from jsdom.
                { provide: YearsService, useValue: { getYears: () => of([2024, 2025]) } },
                {
                    provide: SiteConfigService,
                    useValue: {
                        config$: of({
                            siteName: 'beaconfolio.com',
                            siteUrl: 'https://beaconfolio.com',
                            ownerName: 'Mock Owner',
                            ownerHeadline: 'Principal Software Engineer',
                            ownerDescription: 'Desc.',
                            socialLinks: [],
                            analyticsId: '',
                            availability: 'open',
                            aiCrawlerPolicy: 'allow',
                        }),
                    },
                },
            ],
        });

        const fixture = TestBed.createComponent(NotFoundComponent);
        fixture.detectChanges();
        return fixture;
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
    });

    it('renders the branded not-found panel with a way back into the site', async () => {
        const fixture = setup('browser', null);
        await fixture.whenStable();
        const el: HTMLElement = fixture.nativeElement;

        // Structure/attributes only — jsdom never applies the component
        // stylesheet, so a CSS assertion here would pass with the CSS deleted.
        expect(el.querySelector('[data-testid="page-not-found"]')).toBeTruthy();
        expect(el.querySelector('h1')?.textContent).toContain('404');
        // Site chrome: the header is what gives the page navigation back.
        expect(el.querySelector('app-header')).toBeTruthy();

        const links = Array.from(
            el.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Where to go next"] a'),
        );
        expect(links.map((a) => a.getAttribute('href'))).toEqual(['/', '/blog', '/cv']);
    });

    it('echoes the unmatched path, and repaints on a later emission without an explicit detectChanges (zoneless)', async () => {
        const fixture = setup('browser', null, ['deep', 'gone']);
        await fixture.whenStable();
        const command = () =>
            fixture.nativeElement.querySelector('[data-testid="not-found-command"]')
                ?.textContent ?? '';

        expect(command()).toContain('$ cat ~/deep/gone: No such file or directory');

        // A client-side navigation between two unmatched URLs re-emits on the
        // same component instance. No detectChanges() here on purpose: the
        // async pipe must be what requests the repaint.
        urlSubject.next([{ path: 'still-gone' }]);
        await fixture.whenStable();
        expect(command()).toContain('$ cat ~/still-gone: No such file or directory');
    });

    it('marks the page not found and unfollowable', () => {
        setup('browser', null);

        expect(seoServiceSpy.setNotFound).toHaveBeenCalledWith('Page');
        expect(seoServiceSpy.setNoIndex).toHaveBeenCalled();
    });

    it('sets a real SSR 404 status on the server (#109 RESPONSE_INIT pattern)', () => {
        const responseInit: ResponseInit = { status: 200, headers: new Headers() };
        setup('server', responseInit);

        expect(responseInit.status).toBe(404);
    });

    it('never touches the HTTP status in the browser', () => {
        const responseInit: ResponseInit = { status: 200, headers: new Headers() };
        setup('browser', responseInit);

        expect(responseInit.status).toBe(200);
        expect(seoServiceSpy.setNotFound).toHaveBeenCalledWith('Page');
    });

    it('does not throw on the server when RESPONSE_INIT is unavailable (null)', () => {
        expect(() => setup('server', null)).not.toThrow();
        expect(seoServiceSpy.setNotFound).toHaveBeenCalledWith('Page');
    });
});
