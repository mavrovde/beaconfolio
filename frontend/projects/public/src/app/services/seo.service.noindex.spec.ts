import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { INDEXABLE_ROBOTS, SeoService } from './seo.service';
import { DEFAULT_SITE_CONFIG, SiteConfig, SiteConfigService } from './site-config.service';

/**
 * `robots` handling around the unlisted `/for/:slug` pages (#250).
 *
 * Lives beside the main spec rather than inside it so the two SEO efforts in
 * flight (#252's agent links, this) do not collide in one file.
 */
describe('SeoService — noindex for unlisted pages', () => {
    const SITE: SiteConfig = {
        ...DEFAULT_SITE_CONFIG,
        siteUrl: 'https://example.com',
        ownerName: 'Mock Owner',
    };
    let config$: BehaviorSubject<SiteConfig>;
    let seo: SeoService;
    let meta: Meta;

    beforeEach(() => {
        config$ = new BehaviorSubject<SiteConfig>(SITE);
        TestBed.configureTestingModule({
            providers: [
                Title,
                Meta,
                SeoService,
                { provide: SiteConfigService, useValue: { config$ } },
            ],
        });
        seo = TestBed.inject(SeoService);
        meta = TestBed.inject(Meta);
    });

    afterEach(() => {
        meta.removeTag("name='robots'");
    });

    function robots(): string | null {
        return meta.getTag("name='robots'")?.getAttribute('content') ?? null;
    }

    it('marks a tailored page noindex without calling it a 404', () => {
        seo.updateSeo({ title: 'For Acme', url: '/for/acme-staff-eng' });
        seo.setNoIndex();

        expect(robots()).toBe('noindex, nofollow');
        // Still a real, branded page — a noindex is not a not-found.
        expect(TestBed.inject(Title).getTitle()).toBe('For Acme | Mock Owner');
    });

    it('keeps the noindex when the runtime site config arrives late', () => {
        seo.updateSeo({ title: 'For Acme', url: '/for/acme-staff-eng' });
        seo.setNoIndex();

        config$.next({ ...SITE, ownerName: 'Real Owner' });

        // The config subscription re-applies the SEO data; without the
        // noIndex flag that re-application would silently publish the page.
        expect(robots()).toBe('noindex, nofollow');
        expect(TestBed.inject(Title).getTitle()).toBe('For Acme | Real Owner');
    });

    it('drops a stale noindex when the next page is a normal one', () => {
        seo.setNoIndex();
        expect(robots()).toBe('noindex, nofollow');

        // A client-side navigation to an indexable page: meta tags live in the
        // document, not in the route, so the tag has to be REPLACED explicitly
        // with the indexable directive.
        seo.updateSeo({ title: 'Home', url: '/' });

        expect(robots()).toBe(INDEXABLE_ROBOTS);
    });

    it('drops a stale noindex left by a not-found page', () => {
        seo.setNotFound();
        expect(robots()).toBe('noindex');

        seo.updateSeo({ title: 'Home', url: '/' });

        expect(robots()).toBe(INDEXABLE_ROBOTS);
    });

    it('names the missing subject in the not-found title', () => {
        seo.setNotFound('Page');
        expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Mock Owner');

        // The subject survives a late config arrival, like the state itself.
        config$.next({ ...SITE, ownerName: 'Real Owner' });
        expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Real Owner');
    });

    it('still defaults to the blog wording for existing callers', () => {
        seo.setNotFound();
        expect(TestBed.inject(Title).getTitle()).toBe('Post not found | Mock Owner');
    });

    it('writes the canonical of a tailored page, unlisted but self-declaring', () => {
        const spy = vi.spyOn(TestBed.inject(Meta), 'updateTag');
        seo.updateSeo({ title: 'For Acme', url: '/for/acme-staff-eng' });

        expect(spy).toHaveBeenCalledWith({
            property: 'og:url',
            content: 'https://example.com/for/acme-staff-eng',
        });
        expect(document.querySelector("link[rel='canonical']")?.getAttribute('href')).toBe(
            'https://example.com/for/acme-staff-eng',
        );
    });
});
