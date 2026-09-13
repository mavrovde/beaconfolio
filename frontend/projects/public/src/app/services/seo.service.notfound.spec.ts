import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { Subject, of } from 'rxjs';
import { describe, it, expect, beforeEach } from 'vitest';

import { SeoService } from './seo.service';
import { SiteConfigService } from './site-config.service';

/**
 * #324 — the canonical a not-found page must NOT carry, and the `nofollow` it
 * must not lose.
 *
 * Measured before the fix on a served stack: `/blog/<unknown-slug>` answered 404
 * with `<link rel="canonical" href="{site}/">` in the head — a 404 body naming
 * the home page as its canonical. The canonical comes from the config re-apply
 * (`updateSeo({})` → `data.url || '/'`), not from the component, so the fix is
 * in this service.
 */
const CONFIG = {
    siteName: 'beaconfolio.com',
    siteUrl: 'https://beaconfolio.com',
    ownerName: 'Real Owner',
    ownerHeadline: 'Principal Software Engineer',
    ownerDescription: 'Desc.',
    socialLinks: [],
    analyticsId: '',
    availability: 'open',
    aiCrawlerPolicy: 'allow',
};

function canonicalHref(doc: Document): string | null {
    return doc.querySelector("link[rel='canonical']")?.getAttribute('href') ?? null;
}

describe('SeoService — not-found head (#324)', () => {
    let doc: Document;

    function build(config$: any): SeoService {
        doc = document.implementation.createHTMLDocument('ssr');
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                SeoService,
                Title,
                Meta,
                { provide: DOCUMENT, useValue: doc },
                { provide: SiteConfigService, useValue: { config$ } },
            ],
        });
        return TestBed.inject(SeoService);
    }

    function robots(): string | null {
        return TestBed.inject(Meta).getTag("name='robots'")?.getAttribute('content') ?? null;
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
    });

    it('drops the canonical the config re-apply left pointing at the home page', () => {
        const service = build(of(CONFIG));
        // The ordering that produced the bug: the runtime config lands first, so
        // `updateSeo({})` has already written the home canonical.
        expect(canonicalHref(doc)).toBe('https://beaconfolio.com/');

        service.setNotFound('Page');

        expect(canonicalHref(doc)).toBeNull();
    });

    it('drops a canonical written by the page the visitor came FROM (client-side navigation)', () => {
        const service = build(of(CONFIG));
        service.updateSeo({ title: 'Blog', url: '/blog' });
        expect(canonicalHref(doc)).toBe('https://beaconfolio.com/blog');

        service.setNotFound('Page');

        expect(canonicalHref(doc)).toBeNull();
    });

    it('re-creates the canonical when a real page is rendered next', () => {
        const service = build(of(CONFIG));
        service.setNotFound('Page');
        expect(canonicalHref(doc)).toBeNull();

        service.updateSeo({ title: 'Request CV', url: '/cv' });

        expect(canonicalHref(doc)).toBe('https://beaconfolio.com/cv');
    });

    it('keeps `noindex, nofollow` (and adds no canonical) when the config arrives LATE', () => {
        const config$ = new Subject<any>();
        const service = build(config$);

        // What NotFoundComponent does, before the /config/site response lands.
        service.setNotFound('Page');
        service.setNoIndex();
        expect(robots()).toBe('noindex, nofollow');

        config$.next(CONFIG);

        // The re-apply must not downgrade the robots directive to a bare
        // `noindex`, and must not resurrect the home canonical.
        expect(robots()).toBe('noindex, nofollow');
        expect(canonicalHref(doc)).toBeNull();
        // ...and the title is re-branded with the identity that just arrived.
        expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Real Owner');
    });

    it('leaves a plain not-found page (no setNoIndex) on the bare `noindex` — /blog/:slug is unchanged', () => {
        const config$ = new Subject<any>();
        const service = build(config$);

        service.setNotFound();
        config$.next(CONFIG);

        expect(robots()).toBe('noindex');
        expect(TestBed.inject(Title).getTitle()).toBe('Post not found | Real Owner');
        expect(canonicalHref(doc)).toBeNull();
    });
});
