import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
    HttpTestingController,
    provideHttpClientTesting,
} from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SiteConfigService, DEFAULT_SITE_CONFIG, SiteConfig, toBrand } from './site-config.service';
import { environment } from '../../environments/environment';

const DTO = {
    site_name: 'beaconfolio.com',
    site_url: 'https://beaconfolio.com',
    owner_name: 'Mock Owner',
    owner_headline: 'Principal Software Engineer',
    owner_description: 'Desc.',
    social_links: ['https://linkedin.example/x'],
    analytics_id: 'G-TEST0001',
    availability: 'open',
    ai_crawler_policy: 'deny',
    gtm_container_id: 'GTM-TEST001',
    theme: 'classic',
    brand_favicon_url: 'https://cdn.example/fav.svg',
    brand_logo_url: '/assets/my-logo.svg',
    brand_og_image_url: 'https://cdn.example/card.png',
    brand_font_css_url: 'https://fonts.example/css2?family=Inter',
    brand_font_family: "'Inter', sans-serif",
};

describe('SiteConfigService', () => {
    let service: SiteConfigService;
    let httpMock: HttpTestingController;
    const url = `${environment.apiUrl}${environment.apiPrefix}/config/site`;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting(), SiteConfigService],
        });
        service = TestBed.inject(SiteConfigService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('maps the snake_case wire shape to camelCase', () => {
        let received: SiteConfig | undefined;
        service.config$.subscribe((c) => (received = c));
        httpMock.expectOne(url).flush(DTO);

        expect(received).toEqual({
            siteName: 'beaconfolio.com',
            siteUrl: 'https://beaconfolio.com',
            ownerName: 'Mock Owner',
            ownerHeadline: 'Principal Software Engineer',
            ownerDescription: 'Desc.',
            socialLinks: ['https://linkedin.example/x'],
            availability: 'open',
            analyticsId: 'G-TEST0001',
            aiCrawlerPolicy: 'deny',
            gtmContainerId: 'GTM-TEST001',
            theme: 'classic',
            faviconUrl: 'https://cdn.example/fav.svg',
            logoUrl: '/assets/my-logo.svg',
            ogImageUrl: 'https://cdn.example/card.png',
            fontCssUrl: 'https://fonts.example/css2?family=Inter',
            fontFamily: "'Inter', sans-serif",
        });
    });

    // #67: the five brand knobs are the ONE part of this payload where "absent"
    // and "empty" must mean the same thing — "use the bundled asset" — so a
    // frontend newer than its backend renders the shipped favicon and card
    // rather than an empty `href`.
    it('treats absent brand assets exactly like empty ones', () => {
        let received: SiteConfig | undefined;
        service.config$.subscribe((c) => (received = c));
        const { brand_favicon_url, brand_logo_url, brand_og_image_url,
                brand_font_css_url, brand_font_family, ...preBrandBackend } = DTO;
        httpMock.expectOne(url).flush(preBrandBackend);

        expect(received).toMatchObject({
            faviconUrl: '', logoUrl: '', ogImageUrl: '', fontCssUrl: '', fontFamily: '',
        });
    });

    // A hand-edited env value picks up whitespace easily, and a favicon href of
    // `" /assets/f.png"` is a 404 with no visible cause.
    it('trims whitespace off every brand value', () => {
        let received: SiteConfig | undefined;
        service.config$.subscribe((c) => (received = c));
        httpMock.expectOne(url).flush({ ...DTO, brand_logo_url: '  /assets/logo.svg  ' });

        expect(received?.logoUrl).toBe('/assets/logo.svg');
    });

    // The projection the shared library consumes (#67) — it must carry the
    // theme and the identity fields the shell prompts are derived from, or
    // both apps fall back to `portfolio` as a hostname.
    it('projects onto the shared Brand contract', () => {
        let received: SiteConfig | undefined;
        service.config$.subscribe((c) => (received = c));
        httpMock.expectOne(url).flush(DTO);

        expect(toBrand(received!)).toEqual({
            theme: 'classic',
            siteName: 'beaconfolio.com',
            ownerName: 'Mock Owner',
            faviconUrl: 'https://cdn.example/fav.svg',
            logoUrl: '/assets/my-logo.svg',
            ogImageUrl: 'https://cdn.example/card.png',
            fontCssUrl: 'https://fonts.example/css2?family=Inter',
            fontFamily: "'Inter', sans-serif",
        });
    });

    // #339: the theme is stamped into `data-theme` and matched by a
    // `[data-theme="..."]` block in styles.css, so a name no block matches
    // leaves the page on whatever `:root` holds — a half-themed render rather
    // than a clean fallback. Absent (an older backend mid-deploy) and unknown
    // therefore normalize the same way, to the preset that deployment already
    // looked like.
    it.each([
        [undefined, 'terminal'],
        ['terminal', 'terminal'],
        ['modern', 'modern'],
        ['neon-vaporwave', 'terminal'],
        ['', 'terminal'],
    ])('normalizes theme %s to %s', (wire, expected) => {
        let got: string | undefined;
        service.config$.subscribe((c) => (got = c.theme));
        httpMock
            .expectOne((r) => r.url.includes('/config/site'))
            .flush({ ...DTO, theme: wire });
        expect(got).toBe(expected);
    });

    it.each([
        [undefined, 'allow'], // pre-#252 backend during a deploy window
        ['allow', 'allow'],
        ['DENY', 'deny'], // case-insensitive, like the backend's normalization
        ['sometimes', 'allow'], // a typo must never deindex the portfolio
    ])('normalizes ai_crawler_policy %s to %s', (wire, expected) => {
        let got: string | undefined;
        service.config$.subscribe((c) => (got = c.aiCrawlerPolicy));
        httpMock
            .expectOne((r) => r.url.includes('/config/site'))
            .flush({ ...DTO, ai_crawler_policy: wire });
        expect(got).toBe(expected);
    });

    it('falls back to the neutral default when the backend is unreachable', () => {
        let received: SiteConfig | undefined;
        service.config$.subscribe((c) => (received = c));
        httpMock.expectOne(url).flush('boom', { status: 500, statusText: 'Server Error' });

        expect(received).toEqual(DEFAULT_SITE_CONFIG);
        expect(received!.analyticsId).toBe('');
    });

    it('fetches once and replays to late subscribers (shareReplay)', () => {
        let first: SiteConfig | undefined;
        service.config$.subscribe((c) => (first = c));
        httpMock.expectOne(url).flush(DTO);

        let second: SiteConfig | undefined;
        service.config$.subscribe((c) => (second = c));
        // No second request may be issued:
        httpMock.expectNone(url);
        expect(second).toEqual(first);
    });

    it('normalizes a missing availability from an OLDER backend to the default', () => {
        // Deploy-window skew: the new frontend can meet the previous backend
        // image. Without normalization the field reached toUpperCase() as
        // undefined and the availability stream errored — measured live.
        let got: string | undefined;
        service.config$.subscribe((c) => (got = c.availability));
        const req = httpMock.expectOne((r) => r.url.includes('/config/site'));
        req.flush({
            site_name: 'S', site_url: 'https://s', owner_name: 'O',
            owner_headline: 'H', owner_description: 'D',
            social_links: [], analytics_id: '',
            // deliberately NO availability key
        });
        expect(got).toBe('listening');
    });

    it('normalizes an UNKNOWN state the same way (nit 8: hand-edited DB row)', () => {
        let got: string | undefined;
        service.config$.subscribe((c) => (got = c.availability));
        httpMock
            .expectOne((r) => r.url.includes('/config/site'))
            .flush({
                site_name: 'S', site_url: 'https://s', owner_name: 'O',
                owner_headline: 'H', owner_description: 'D',
                social_links: [], analytics_id: '',
                availability: 'on_vacation',
            });
        expect(got).toBe('listening');
    });
});

// --- GTM container id (#447) ---

describe('SiteConfigService — gtm_container_id (#447)', () => {
    let service: SiteConfigService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting(), SiteConfigService],
        });
        service = TestBed.inject(SiteConfigService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    it.each([
        ['GTM-ABC1234', 'GTM-ABC1234'],
        [undefined, ''], // pre-#447 backend during a deploy window
        ['', ''], // the documented OFF switch
    ])('normalizes gtm_container_id %s to %s', (wire, expected) => {
        let got: string | undefined;
        service.config$.subscribe((c) => (got = c.gtmContainerId));
        httpMock
            .expectOne((r) => r.url.includes('/config/site'))
            .flush({ ...DTO, gtm_container_id: wire });
        expect(got).toBe(expected);
    });
});
