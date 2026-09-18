import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';

import {
    AUTH_TOKEN_PROVIDER,
    BrandAssetsService,
    SITE_BRAND_SOURCE,
    ShellChromeService,
    SiteBrandService,
    ThemeService,
} from '@beaconfolio/shared';
import { appConfig } from './app.config';
import { SiteConfigService } from './services/site-config.service';
import { environment } from '../environments/environment';

/**
 * The `SITE_BRAND_SOURCE` wiring (#67) — the thing that keeps the shared
 * library's three brand consumers from opening their own requests.
 *
 * This reads the REAL `appConfig.providers`. A spec that re-declared the
 * provider here would pass with the line deleted from `app.config.ts`, which
 * is the class of fake-green test the retrospectives keep finding: it would be
 * testing its own copy of the wiring.
 */
describe('appConfig — the shared brand source (#67)', () => {
    const url = `${environment.apiUrl}${environment.apiPrefix}/config/site`;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                // `appConfig`'s own `HttpBackend` is `SsrHttpBackend`; the
                // testing backend is listed AFTER it so it wins, which is what
                // lets this exercise the real provider list without a network.
                ...appConfig.providers,
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        });
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        http.verify();
    });

    it('is provided, and resolves to this app’s own config stream', async () => {
        const source = TestBed.inject(SITE_BRAND_SOURCE);
        const brand = firstValueFrom(source);
        http.expectOne(url).flush({
            site_name: 'Acme Portfolio',
            owner_name: 'Ada Lovelace',
            theme: 'classic',
            brand_logo_url: '/assets/acme.svg',
        });

        await expect(brand).resolves.toMatchObject({
            theme: 'classic',
            siteName: 'Acme Portfolio',
            ownerName: 'Ada Lovelace',
            logoUrl: '/assets/acme.svg',
        });
    });

    // The measurement the wiring exists for. Four consumers — this app's own
    // `SiteConfigService` plus the library's theme, brand-asset and shell
    // services — and ONE request between them. `expectOne` is the assertion:
    // it fails on a second matching request, and `verify()` fails on an
    // unconsumed one.
    it('costs exactly one /config/site request across every consumer', async () => {
        const source = TestBed.inject(SITE_BRAND_SOURCE);
        const brandService = TestBed.inject(SiteBrandService);
        const shell = TestBed.inject(ShellChromeService);

        TestBed.inject(ThemeService).initialize();
        TestBed.inject(BrandAssetsService).initialize();
        const prompt = firstValueFrom(shell.prompt('~/blog'));
        const seen = firstValueFrom(brandService.brand$);
        source.subscribe();
        TestBed.inject(SiteConfigService).config$.subscribe();

        http.expectOne(url).flush({ site_name: 'Acme Portfolio', theme: 'terminal' });

        await expect(prompt).resolves.toBe('user@acme-portfolio:~/blog$');
        await expect(seen).resolves.toMatchObject({ siteName: 'Acme Portfolio' });
        expect(document.documentElement.getAttribute('data-theme')).toBe('terminal');
    });

    // The public app is UNAUTHENTICATED, and the shared library's HTTP layer
    // asks this provider for a bearer token on every request it sends. The
    // token must therefore be `null` — not `undefined`, not a stale value read
    // from storage — or a visitor's request would carry an Authorization
    // header the backend then has to reject. Reading the real provider list is
    // the only way to see that: the factory is a literal inside `appConfig`.
    it('hands the shared library a null-token provider', () => {
        expect(TestBed.inject(AUTH_TOKEN_PROVIDER)()).toBeNull();
    });
});
