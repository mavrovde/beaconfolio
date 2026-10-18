import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { describe, it, expect, beforeEach } from 'vitest';
import { SeoService } from './seo.service';
import { DEFAULT_SITE_CONFIG, SiteConfig, SiteConfigService } from './site-config.service';

/**
 * The page's JSON-LD block: ONE `<script type="application/ld+json">` in the
 * INJECTED document's <head> (the per-request server document during SSR).
 *
 * It used to be an `[innerHTML]` binding in AppComponent fed by
 * `bypassSecurityTrustHtml` (Sonar `typescript:S6268`); these cases migrated
 * from that component's spec and now pin the DOM write instead.
 */
describe('SeoService — JSON-LD block in <head>', () => {
    let seo: SeoService;
    let doc: Document;

    beforeEach(() => {
        doc = document.implementation.createHTMLDocument('ssr');
        TestBed.configureTestingModule({
            providers: [
                SeoService,
                Title,
                Meta,
                { provide: DOCUMENT, useValue: doc },
                {
                    provide: SiteConfigService,
                    useValue: { config$: new BehaviorSubject<SiteConfig>(DEFAULT_SITE_CONFIG) },
                },
            ],
        });
        seo = TestBed.inject(SeoService);
    });

    const blocks = () => doc.head.querySelectorAll('script[type="application/ld+json"]');

    it('writes nothing while no schema is set', () => {
        expect(blocks()).toHaveLength(0);
    });

    it('writes the schema as one parseable block', () => {
        seo.setJsonLd({ '@type': 'Person', name: 'Test' });

        expect(blocks()).toHaveLength(1);
        expect(blocks()[0].textContent).toContain('"name": "Test"');
        expect(JSON.parse(blocks()[0].textContent ?? '')).toEqual({ '@type': 'Person', name: 'Test' });
    });

    // The exact opening tag the server-rendered E2E (`seo-ssr.spec.ts`) matches.
    it('serializes with the bare type attribute crawlers and the E2E read', () => {
        seo.setJsonLd({ '@type': 'Person' });
        expect(doc.head.innerHTML).toContain('<script type="application/ld+json">');
    });

    it('replaces the block in place on the next page, never adding a second', () => {
        seo.setJsonLd({ '@type': 'Person', name: 'A' });
        const first = blocks()[0];
        seo.setJsonLd({ '@type': 'BlogPosting', headline: 'B' });

        expect(blocks()).toHaveLength(1);
        expect(blocks()[0]).toBe(first);
        expect(JSON.parse(first.textContent ?? '').headline).toBe('B');
    });

    // A 404 carries no structured data (setNotFound pushes null).
    it('removes the block when the schema is cleared', () => {
        seo.setJsonLd({ '@type': 'Person' });
        seo.setNotFound('Post');
        expect(blocks()).toHaveLength(0);
    });

    // The WIRING, not just the helper: reverting the writer to a bare
    // `JSON.stringify` must turn this red. The serialized head is re-parsed the
    // way a browser reads the server's bytes — a post title is the realistic
    // carrier, it reaches this schema through `blog-post.component`.
    it('never lets a value close the script element in the serialized head', () => {
        const headline = 'Post </scr' + 'ipt><img src=x onerror=alert(1)>';
        seo.setJsonLd({ '@type': 'BlogPosting', headline });

        const reparsed = document.implementation.createHTMLDocument('browser');
        reparsed.head.innerHTML = doc.head.innerHTML + '<meta id="after">';

        expect(reparsed.querySelector('img'), 'no element may be built from the schema').toBeNull();
        expect(reparsed.getElementById('after')).not.toBeNull();
        const parsed = reparsed.head.querySelectorAll('script[type="application/ld+json"]');
        expect(parsed).toHaveLength(1);
        expect(JSON.parse(parsed[0].textContent ?? '').headline).toBe(headline);
    });
});
