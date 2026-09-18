import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
    HttpTestingController,
    provideHttpClientTesting,
} from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SiteConfigService, DEFAULT_SITE_CONFIG, SiteConfig } from './site-config.service';
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
        });
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
