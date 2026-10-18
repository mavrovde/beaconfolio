import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
    INDEXABLE_ROBOTS,
    OG_IMAGE_HEIGHT,
    OG_IMAGE_PATH,
    OG_IMAGE_WIDTH,
    SeoService,
    ogLocale,
} from './seo.service';
import { DEFAULT_SITE_CONFIG, SiteConfig, SiteConfigService } from './site-config.service';

/**
 * The SEO pass on the head (#71 follow-up): Open Graph / Twitter completeness,
 * search-engine ownership meta, the indexable robots directive, language, and
 * titles that are never cut with an ellipsis. Asserted on the INJECTED
 * document, which during SSR is the per-request server document.
 */
const SITE: SiteConfig = {
    ...DEFAULT_SITE_CONFIG,
    siteName: 'Jane Doe',
    siteUrl: 'https://example.com',
    ownerName: 'Jane Doe',
    ownerHeadline: 'Staff Engineer @ Acme',
};

describe('SeoService — head completeness', () => {
    let config$: BehaviorSubject<SiteConfig>;
    let seo: SeoService;
    let doc: Document;

    beforeEach(() => {
        doc = document.implementation.createHTMLDocument('ssr');
        config$ = new BehaviorSubject<SiteConfig>(SITE);
        TestBed.configureTestingModule({
            providers: [
                SeoService,
                Title,
                Meta,
                { provide: DOCUMENT, useValue: doc },
                { provide: SiteConfigService, useValue: { config$ } },
            ],
        });
        seo = TestBed.inject(SeoService);
    });

    const meta = (selector: string) => doc.head.querySelector(`meta[${selector}]`)?.getAttribute('content') ?? null;
    const prop = (name: string) => meta(`property="${name}"`);
    const named = (name: string) => meta(`name="${name}"`);

    it('writes og:site_name, og:locale, author and the indexable robots directive', () => {
        seo.updateSeo({ title: 'Blog', url: '/blog' });
        expect(prop('og:site_name')).toBe('Jane Doe');
        expect(prop('og:locale')).toBe('en_US');
        expect(named('author')).toBe('Jane Doe');
        expect(named('robots')).toBe(INDEXABLE_ROBOTS);
        expect(INDEXABLE_ROBOTS).toContain('max-image-preview:large');
    });

    it('falls back to the owner name for og:site_name and drops it when both are empty', () => {
        config$.next({ ...SITE, siteName: '' });
        expect(prop('og:site_name')).toBe('Jane Doe');
        config$.next({ ...SITE, siteName: '', ownerName: '' });
        expect(prop('og:site_name')).toBeNull();
        expect(named('author')).toBeNull();
    });

    it('emits the bundled card WITH its real dimensions and an alt text', () => {
        seo.updateSeo({ title: 'Blog' });
        expect(prop('og:image')).toBe(`https://example.com${OG_IMAGE_PATH}`);
        expect(prop('og:image:width')).toBe('1200');
        expect(prop('og:image:height')).toBe('630');
        expect(prop('og:image:alt')).toBe('Blog');
        expect(named('twitter:image:alt')).toBe('Blog');
    });

    it('drops width/height for an image whose size it does not know', () => {
        seo.updateSeo({ title: 'Blog' });
        seo.updateSeo({ title: 'Post', image: 'https://cdn.example/p.png', imageAlt: 'A &amp; B' });
        expect(prop('og:image')).toBe('https://cdn.example/p.png');
        expect(prop('og:image:width')).toBeNull();
        expect(prop('og:image:height')).toBeNull();
        expect(prop('og:image:alt')).toBe('A & B');
    });

    it('pins the declared card size to the committed PNG header', () => {
        // Bytes 16-23 of a PNG are the IHDR width and height, big-endian.
        const png = readFileSync(resolve(__dirname, '../../assets/og-image.png'));
        expect(png.readUInt32BE(16)).toBe(OG_IMAGE_WIDTH);
        expect(png.readUInt32BE(20)).toBe(OG_IMAGE_HEIGHT);
    });

    it('emits the verification tokens only when configured', () => {
        seo.updateSeo({});
        expect(named('google-site-verification')).toBeNull();
        expect(named('msvalidate.01')).toBeNull();

        config$.next({ ...SITE, googleSiteVerification: 'g-token', bingSiteVerification: 'b-token' });
        expect(named('google-site-verification')).toBe('g-token');
        expect(named('msvalidate.01')).toBe('b-token');

        // A config without the optional fields at all (older backend).
        const { googleSiteVerification: _g, bingSiteVerification: _b, ...older } = SITE;
        config$.next(older as SiteConfig);
        expect(named('google-site-verification')).toBeNull();
    });

    it('uses a full title verbatim and the page name as the share title', () => {
        seo.updateSeo({ fullTitle: 'Jane Doe - Staff Engineer | Berlin' });
        expect(doc.title).toBe('Jane Doe - Staff Engineer | Berlin');
        expect(prop('og:title')).toBe('Jane Doe - Staff Engineer | Berlin');

        const headline = 'Are Heavy Frameworks Still the Default Choice in the AI Era? A Field Report';
        seo.updateSeo({ title: headline });
        expect(doc.title).toBe('Are Heavy Frameworks Still the Default Choice in the AI Era?');
        expect(doc.title.length).toBeLessThanOrEqual(60);
        // og:title keeps the whole headline and NEVER gains an ellipsis.
        expect(prop('og:title')).toBe(headline);
        expect(prop('og:title')).not.toContain('…');
        expect(named('twitter:title')).toBe(headline);
    });

    it('composes the default title from the configured identity', () => {
        seo.updateSeo({});
        expect(doc.title).toBe('Jane Doe - Staff Engineer');
    });

    it('decodes and bounds the description, and composes default keywords from the role', () => {
        seo.updateSeo({ description: `Engineer &amp; Architect. ${'word '.repeat(60)}` });
        const description = named('description')!;
        expect(description.startsWith('Engineer & Architect.')).toBe(true);
        expect(description.length).toBeLessThanOrEqual(155);
        expect(named('keywords')).toBe('Staff Engineer');
    });

    it('removes the keywords tag when nothing composes', () => {
        config$.next({ ...SITE, ownerHeadline: '' });
        seo.updateSeo({});
        expect(named('keywords')).toBeNull();
    });

    it('writes article:* for a post — one tag per article:tag — and clears them on the next page', () => {
        seo.updateSeo({
            title: 'Post',
            type: 'article',
            locale: 'de',
            article: { publishedTime: '2025-03-04T09:00:00Z', tags: ['a', 'b'] },
        });
        expect(prop('og:type')).toBe('article');
        expect(prop('og:locale')).toBe('de_DE');
        expect(prop('article:published_time')).toBe('2025-03-04T09:00:00Z');
        expect(prop('article:modified_time')).toBe('2025-03-04T09:00:00Z');
        expect(prop('article:author')).toBe('https://example.com/');
        expect(Array.from(doc.head.querySelectorAll('meta[property="article:tag"]')).map((m) => m.getAttribute('content'))).toEqual(['a', 'b']);

        // Re-applying does not duplicate the tags.
        seo.updateSeo({
            title: 'Post',
            type: 'article',
            article: { publishedTime: '2025-03-04T09:00:00Z', modifiedTime: '2025-04-01T00:00:00Z' },
        });
        expect(doc.head.querySelectorAll('meta[property="article:tag"]')).toHaveLength(0);
        expect(prop('article:modified_time')).toBe('2025-04-01T00:00:00Z');

        seo.updateSeo({ title: 'Blog' });
        expect(prop('article:published_time')).toBeNull();
        expect(prop('og:type')).toBe('website');
    });

    it('names the author by name when no site URL is known', () => {
        config$.next({ ...SITE, siteUrl: '' });
        seo.updateSeo({ title: 'Post', type: 'article', article: { publishedTime: '2025-03-04' } });
        expect(prop('article:author')).toBe('Jane Doe');
        // And without a site URL there is no card to size.
        expect(prop('og:image:width')).toBeNull();
    });

    it('sets <html lang> and og:locale from the rendered language', () => {
        seo.updateSeo({ title: 'Blog' });
        seo.setLanguage('de');
        expect(doc.documentElement.getAttribute('lang')).toBe('de');
        expect(prop('og:locale')).toBe('de_DE');
        // A page that declared its own content language keeps it.
        seo.updateSeo({ title: 'Post', locale: 'en' });
        seo.setLanguage('de');
        expect(prop('og:locale')).toBe('en_US');
    });

    it('sets the locale before any page declared itself', () => {
        seo.setLanguage('de');
        expect(prop('og:locale')).toBe('de_DE');
    });

    it('clears the previous page graph on a not-found', () => {
        seo.setJsonLd({ '@type': 'Person' });
        seo.setNotFound('Page');
        expect(seo.jsonLdSchema$.value).toBeNull();
    });

    it.each([
        ['en', 'en_US'],
        ['de', 'de_DE'],
        ['DE-at', 'de_DE'],
        ['fr', 'en_US'],
        [undefined, 'en_US'],
    ])('maps %j to %s', (lang, expected) => {
        expect(ogLocale(lang)).toBe(expected);
    });
});
