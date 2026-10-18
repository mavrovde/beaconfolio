import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { of, Subject } from 'rxjs';
import { SeoService } from './seo.service';
import { SiteConfigService } from './site-config.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Test identity mirrors the historical branding so the assertions stay
// meaningful; production values now come from the runtime config (#65).
const MOCK_SITE_CONFIG_PROVIDER = {
    provide: SiteConfigService,
    useValue: {
        config$: of({
            siteName: 'beaconfolio.com',
            siteUrl: 'https://beaconfolio.com',
            ownerName: 'Mock Owner',
            ownerHeadline: 'Principal Software Engineer',
            ownerDescription:
                'Professional portfolio of Mock Owner, a Principal Software Engineer specialized in Cloud, AI, and Full-Stack Development.',
           
            socialLinks: [],
            analyticsId: '',
        }),
    },
};

describe('SeoService', () => {
    let service: SeoService;
    let titleService: Title;
    let metaService: Meta;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [SeoService, Title, Meta, MOCK_SITE_CONFIG_PROVIDER]
        });
        service = TestBed.inject(SeoService);
        titleService = TestBed.inject(Title);
        metaService = TestBed.inject(Meta);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should update SEO with full config', () => {
        const spy = vi.spyOn(metaService, 'updateTag');
        const titleSpy = vi.spyOn(titleService, 'setTitle');

        service.updateSeo({
            title: 'Page Title',
            description: 'Page Desc',
            keywords: 'k1, k2',
            image: '/img.jpg',
            url: '/page',
            type: 'article'
        });

        expect(titleSpy).toHaveBeenCalledWith('Page Title | Mock Owner');
        expect(spy).toHaveBeenCalledWith({ name: 'description', content: 'Page Desc' });
        expect(spy).toHaveBeenCalledWith({ name: 'keywords', content: 'k1, k2' });
        expect(spy).toHaveBeenCalledWith({ property: 'og:type', content: 'article' });
        expect(spy).toHaveBeenCalledWith({ name: 'twitter:card', content: 'summary_large_image' });
    });

    it('should use defaults when config is empty', () => {
        const titleSpy = vi.spyOn(titleService, 'setTitle');
        service.updateSeo({});

        expect(titleSpy).toHaveBeenCalledWith('Mock Owner - Principal Software Engineer');
    });

    it('should set JSON-LD schema', () => {
        const schema = { '@type': 'Person', name: 'Test' };
        service.setJsonLd(schema);

        service.jsonLdSchema$.subscribe(val => {
            expect(val).toEqual(schema);
        });
    });

    /**
     * REPLACES "should not update canonical url in server environment" (#71).
     * That test pinned the bug: the canonical link was written only on the
     * browser, so the SERVER-rendered HTML that crawlers actually read carried
     * none — an AC2 violation. The service now writes into the INJECTED
     * document, which under SSR is the per-request server document; this test
     * proves it by handing it a document that is not the ambient global.
     */
    it('writes the canonical link into the INJECTED document (so SSR HTML carries it)', () => {
        const ssrDocument = document.implementation.createHTMLDocument('ssr');
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                SeoService, Title, Meta, MOCK_SITE_CONFIG_PROVIDER,
                { provide: DOCUMENT, useValue: ssrDocument }
            ]
        });
        TestBed.inject(SeoService).updateSeo({ url: '/server-test' });

        const link = ssrDocument.querySelector("link[rel='canonical']");
        expect(link?.getAttribute('href')).toBe('https://beaconfolio.com/server-test');
    });

    /**
     * #252 AC4: an agent holding the page must not have to guess where the
     * machine-readable profile lives. Asserted on the INJECTED document for the
     * same reason as the canonical — it is the SERVER-rendered head that a
     * crawler reads.
     */
    it('advertises the JSON Resume and llms.txt from the SSR head (#252)', () => {
        const ssrDocument = document.implementation.createHTMLDocument('ssr');
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                SeoService, Title, Meta, MOCK_SITE_CONFIG_PROVIDER,
                { provide: DOCUMENT, useValue: ssrDocument }
            ]
        });
        const seo = TestBed.inject(SeoService);
        seo.updateSeo({ url: '/blog' });

        const resume = ssrDocument.querySelector("link[rel='alternate'][type='application/json']");
        expect(resume?.getAttribute('href')).toBe('https://beaconfolio.com/api/app/profile/resume.json');
        expect(resume?.getAttribute('title')).toBe('JSON Resume');
        const llms = ssrDocument.querySelector("link[rel='describedby']");
        expect(llms?.getAttribute('href')).toBe('https://beaconfolio.com/llms.txt');

        // Navigating must UPDATE the links, never append a second copy.
        seo.updateSeo({ url: '/cv' });
        expect(ssrDocument.querySelectorAll("link[rel='alternate']")).toHaveLength(1);
        expect(ssrDocument.querySelectorAll("link[rel='describedby']")).toHaveLength(1);
    });

    /**
     * #252 review, minor 3. The `noindex` meta governs indexing of THIS page's
     * body, while `rel="alternate"`/`rel="describedby"` point at other,
     * perfectly indexable documents — so an agent that followed a dead
     * recruiter link is still told, in the response it already has, where the
     * real profile is. What must NOT happen is the not-found title being
     * overwritten (#255).
     *
     * NOTE: this case alone does not pin the behaviour — the mock config is
     * `of(...)`, so it emits during construction and `updateSeo({})` has
     * already written the links before `setNotFound()` runs. The pin that can
     * fail is in the `config re-apply` block below, which reproduces the REAL
     * SSR ordering (config after the 404).
     */
    it('keeps the agent links on a not-found page, alongside noindex (#109 + #252)', () => {
        const ssrDocument = document.implementation.createHTMLDocument('ssr');
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                SeoService, Title, Meta, MOCK_SITE_CONFIG_PROVIDER,
                { provide: DOCUMENT, useValue: ssrDocument }
            ]
        });
        TestBed.inject(SeoService).setNotFound();

        expect(
            ssrDocument.querySelector("link[rel='alternate']")?.getAttribute('href'),
        ).toBe('https://beaconfolio.com/api/app/profile/resume.json');
        expect(
            ssrDocument.querySelector("link[rel='describedby']")?.getAttribute('href'),
        ).toBe('https://beaconfolio.com/llms.txt');
        expect(TestBed.inject(Meta).getTag('name="robots"')?.content).toBe('noindex');
        expect(TestBed.inject(Title).getTitle()).toContain('not found');
    });
});

describe('SeoService config re-apply (#255 review pins)', () => {
    let subject: Subject<any>;
    let titleService: Title;
    let service: SeoService;

    const CFG = {
        siteName: 'beaconfolio.com', siteUrl: 'https://real.example',
        ownerName: 'Real Owner', ownerHeadline: 'Real Headline',
        ownerDescription: 'Real description.', socialLinks: [], analyticsId: '',
    };

    beforeEach(() => {
        subject = new Subject<any>();
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                SeoService, Title, Meta,
                { provide: SiteConfigService, useValue: { config$: subject.asObservable() } },
            ],
        });
        service = TestBed.inject(SeoService);
        titleService = TestBed.inject(Title);
    });

    it('re-applies the last SEO data when the config arrives (placeholder never sticks)', () => {
        service.updateSeo({ title: 'Blog' });
        expect(titleService.getTitle()).toBe('Blog | Portfolio Owner'); // neutral default first

        subject.next(CFG);
        // Mutation pin: deleting the constructor re-apply leaves the
        // placeholder in the SSR head — this asserts the re-brand happened.
        expect(titleService.getTitle()).toBe('Blog | Real Owner');
    });

    it('a not-found page re-applies its NOT-FOUND title, never the page branding (#109)', () => {
        service.updateSeo({ title: 'Some Post' });
        service.setNotFound();
        expect(titleService.getTitle()).toBe('Post not found | Portfolio Owner');

        subject.next(CFG);
        expect(titleService.getTitle()).toBe('Post not found | Real Owner');
    });

    /**
     * #252 review, minor 3 — the pin that can actually fail.
     *
     * The ordering this pins: the component marks the route missing, and the
     * runtime config HTTP response lands AFTER. The subscription then re-enters
     * `setNotFound()`, so `updateSeo` never runs for this request and nothing
     * else would write the links.
     *
     * Confirmed on a served stack, not just here: at `/blog/<unknown-slug>`
     * with `/config/site` delayed 1.2s, the built app emitted NO
     * `alternate`/`describedby` without `setNotFound()`'s write and both with
     * it. Without the delay config wins the race, `updateSeo` writes them
     * first, and the two builds are indistinguishable — so this ordering is the
     * only one where the behaviour is observable.
     *
     * (The reviewer's round-1 note measured `/does-not-exist`, which is a
     * different thing: no `**` route exists, so Express answers it and Angular
     * never runs. See `seo.service.ts:setNotFound`.)
     */
    it('writes the agent links on a 404 whose config arrives after the route (#252)', () => {
        const ssrDocument = document.implementation.createHTMLDocument('ssr');
        const late = new Subject<any>();
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                SeoService, Title, Meta,
                { provide: DOCUMENT, useValue: ssrDocument },
                { provide: SiteConfigService, useValue: { config$: late.asObservable() } },
            ],
        });
        const seo = TestBed.inject(SeoService);

        seo.setNotFound();
        // siteUrl is still unknown: no link is better than an empty href.
        expect(ssrDocument.querySelector("link[rel='alternate']")).toBeNull();
        expect(ssrDocument.querySelector("link[rel='describedby']")).toBeNull();

        late.next(CFG);

        expect(
            ssrDocument.querySelector("link[rel='alternate']")?.getAttribute('href'),
        ).toBe('https://real.example/api/app/profile/resume.json');
        expect(
            ssrDocument.querySelector("link[rel='describedby']")?.getAttribute('href'),
        ).toBe('https://real.example/llms.txt');
        expect(TestBed.inject(Title).getTitle()).toBe('Post not found | Real Owner');
    });

    it('updateSeo after a not-found clears the flag (normal navigation resumes)', () => {
        service.setNotFound();
        service.updateSeo({ title: 'Home' });
        subject.next(CFG);
        expect(titleService.getTitle()).toBe('Home | Real Owner');
    });
});
