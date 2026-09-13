import { Injectable, Inject, DOCUMENT } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { SiteConfigService, SiteConfig, DEFAULT_SITE_CONFIG } from './site-config.service';
import { environment } from '../../environments/environment';

export interface SeoData {
    title?: string;
    description?: string;
    image?: string;
    url?: string;
    type?: string;
    keywords?: string;
    twitterCard?: string;
}

/** A schema.org JSON-LD node, serialized verbatim into a `<script type="application/ld+json">`. */
export type JsonLd = Record<string, unknown>;

/**
 * Path of the bundled social-share card, relative to the configured site URL
 * (#71). The asset physically exists at
 * `projects/public/src/assets/og-image.png` — before #71 this default pointed
 * at a file that was never in the repo, so every share advertised a 404.
 * Final branded artwork is owned by #311; this is the neutral fallback.
 */
export const OG_IMAGE_PATH = '/assets/og-image.png';

@Injectable({
    providedIn: 'root'
})
export class SeoService {
    // Identity comes from the runtime site config (#65); these derived fields
    // start at the neutral defaults and update when the config arrives, at
    // which point the last-applied SEO data is re-applied so no page keeps
    // placeholder branding.
    private site: SiteConfig = DEFAULT_SITE_CONFIG;
    private lastSeoData: SeoData | null = null;
    // The not-found state must survive a config arrival: naively re-applying
    // lastSeoData would overwrite the #109 not-found title with the page
    // branding (#255 review round 1).
    private notFound = false;
    private notFoundSubject = 'Post';
    // Same reasoning for a deliberately unlisted page (#250's /for/:slug): its
    // `noindex` must survive the config arrival that re-applies the SEO data.
    private noIndex = false;

    public jsonLdSchema$ = new BehaviorSubject<JsonLd | null>(null);

    constructor(
        private titleService: Title,
        private metaService: Meta,
        @Inject(DOCUMENT) private document: Document,
        siteConfig: SiteConfigService
    ) {
        // cd-safety-ok: writes go to the Title/Meta DOM services, never to a template-bound property — no repaint needed.
        siteConfig.config$.subscribe((cfg) => {
            this.site = cfg;
            // Re-brand whatever the current page already applied. Title/Meta
            // are DOM-level services, not change-detection consumers, so this
            // is zoneless-safe by construction. A not-found page re-applies
            // its not-found title (with the fresh owner name), never the
            // regular branding.
            if (this.notFound) {
                const wasNoIndex = this.noIndex;
                this.setNotFound(this.notFoundSubject);
                // `setNotFound` writes the bare `noindex` every not-found body
                // carries; a page that additionally asked for `nofollow` (the
                // #324 wildcard 404) has to re-assert it, exactly like the
                // regular branch below.
                if (wasNoIndex) {
                    this.setNoIndex();
                }
            } else {
                // updateSeo clears the robots meta (see there), so a page that
                // asked to stay unlisted has to re-assert it afterwards.
                const wasNoIndex = this.noIndex;
                this.updateSeo(this.lastSeoData ?? {});
                if (wasNoIndex) {
                    this.setNoIndex();
                }
            }
        });
    }

    private get baseTitle(): string {
        return `${this.site.ownerName} | ${this.site.ownerHeadline}`;
    }
    private get defaultDescription(): string {
        return this.site.ownerDescription;
    }
    private get baseUrl(): string {
        return this.site.siteUrl;
    }

    updateSeo(data: SeoData): void {
        this.lastSeoData = data;
        this.notFound = false;
        // A `robots: noindex` written by a PREVIOUS page (a not-found body, or
        // an unlisted /for/ link) lives in the document, not in the route, so a
        // client-side navigation used to carry it onto the next, perfectly
        // indexable page. Declaring a normal page clears it; pages that must
        // stay unlisted call `setNoIndex()` right after (#250).
        this.noIndex = false;
        this.metaService.removeTag("name='robots'");
        const fullTitle = data.title ? `${data.title} | ${this.site.ownerName}` : this.baseTitle;
        const description = data.description || this.defaultDescription;
        // Absolute URLs need a configured site URL. Until the runtime config
        // arrives (or when the backend is unreachable and the neutral default
        // with its empty siteUrl applies) we emit NO og:url / og:image /
        // canonical at all: a relative `og:image` or an empty `og:url` is
        // invalid for every crawler, and a wrong canonical is worse than a
        // missing one. The config subscription re-applies this data the moment
        // the real siteUrl lands, so the SSR head still carries them (#71).
        const image = this.baseUrl ? `${this.baseUrl}${data.image || OG_IMAGE_PATH}` : '';
        // `data.url || '/'`: the home page's canonical must be `https://site/`,
        // byte-identical to its `<loc>` in the generated sitemap — a canonical
        // and a sitemap entry that differ by a trailing slash are two URL
        // strings for one page.
        const url = this.baseUrl ? `${this.baseUrl}${data.url || '/'}` : '';
        const type = data.type || 'website';
        const keywords = data.keywords || 'Software Engineering, Angular, Python, AI, Cloud Architecture';

        this.titleService.setTitle(fullTitle);

        // Standard Meta
        this.metaService.updateTag({ name: 'description', content: description });
        this.metaService.updateTag({ name: 'keywords', content: keywords });

        // Open Graph
        this.metaService.updateTag({ property: 'og:title', content: fullTitle });
        this.metaService.updateTag({ property: 'og:description', content: description });
        this.metaService.updateTag({ property: 'og:type', content: type });

        // Twitter
        this.metaService.updateTag({ name: 'twitter:card', content: data.twitterCard || 'summary_large_image' });
        this.metaService.updateTag({ name: 'twitter:title', content: fullTitle });
        this.metaService.updateTag({ name: 'twitter:description', content: description });

        if (image) {
            this.metaService.updateTag({ property: 'og:image', content: image });
            this.metaService.updateTag({ name: 'twitter:image', content: image });
        }

        if (url) {
            this.metaService.updateTag({ property: 'og:url', content: url });
            this.updateCanonicalUrl(url);
            this.updateAgentLinks();
        }
    }

    /**
     * Advertise the machine-readable surfaces from the HTML head (#252).
     *
     * An agent that already has the page does not need to guess a URL: `link
     * rel="alternate" type="application/json"` points at the JSON Resume
     * document, and `rel="describedby"` at `/llms.txt` — the two relations
     * llmstxt.org names for exactly this. Emitted only once the runtime site
     * URL is known, for the same reason as the canonical: a relative or empty
     * `href` is worse than none. Both are written into the INJECTED document,
     * so they are present in the SERVER-rendered HTML a crawler reads.
     */
    private updateAgentLinks(): void {
        // The prefix comes from the browser layer's own config; the SSR copy of
        // this path lives in `seo/sitemap.ts` (`RESUME_PATH`).
        this.updateLink(
            "link[rel='alternate'][type='application/json']",
            { rel: 'alternate', type: 'application/json', title: 'JSON Resume' },
            `${this.baseUrl}${environment.apiPrefix}/profile/resume.json`
        );
        this.updateLink(
            "link[rel='describedby']",
            { rel: 'describedby', type: 'text/plain' },
            `${this.baseUrl}/llms.txt`
        );
    }

    setJsonLd(schema: JsonLd): void {
        this.jsonLdSchema$.next(schema);
    }

    /**
     * Mark the current page as a genuine "not found": a not-found <title> plus a
     * `robots: noindex` meta so crawlers never index a 404 body. Rendered into the
     * SSR HTML (alongside the real 404 status set by the component) and kept after
     * hydration (#109).
     *
     * The #252 agent links are written here TOO, and deliberately so: `noindex`
     * governs indexing of THIS page's body, while `rel="alternate"` and
     * `rel="describedby"` point at other, perfectly indexable documents — so an
     * agent that followed a dead recruiter link is still told where the real
     * profile is, in the response it already has (#252 review, minor 3).
     *
     * It cannot be left to `updateSeo`'s call, because that call is ordering-
     * dependent: when the component marks the route missing BEFORE the runtime
     * config response lands, the subscription above re-enters this method and
     * `updateSeo` never runs for the request. Measured on a served stack at
     * `/blog/<unknown-slug>` (the route that actually reaches this code and
     * returns a real 404), delaying `/config/site` by 1.2s so config lands
     * last: WITHOUT this write the 404 carried no `alternate`/`describedby`
     * and no canonical; WITH it, both links are present. When config wins the
     * race instead — the common case — `updateSeo` has already written them and
     * the two states are indistinguishable, so this is defence for the slow-
     * config ordering, not for every 404.
     *
     * NOTE for the next reader: since #324 `/does-not-exist` reaches this path
     * too — the app declares a `**` route rendering `NotFoundComponent`, so an
     * unknown top-level URL is a branded, head-carrying 404 instead of Express's
     * bare `Cannot GET` page.
     *
     * The links are still omitted while `siteUrl` is unknown, the same rule the
     * canonical follows: a relative or empty `href` is worse than none.
     *
     * **The canonical is REMOVED here (#324).** When the runtime config lands
     * BEFORE the component marks the route missing — the common ordering — the
     * re-apply in the constructor has already run `updateSeo({})`, whose
     * `data.url || '/'` default wrote `<link rel="canonical" href="{site}/">`
     * into the head. A 404 body that names the home page as its canonical tells
     * a crawler this response IS the home page. A not-found page gets no
     * canonical at all.
     */
    setNotFound(subject: string = 'Post'): void {
        this.notFound = true;
        this.notFoundSubject = subject;
        this.titleService.setTitle(`${subject} not found | ${this.site.ownerName}`);
        this.metaService.updateTag({ name: 'robots', content: 'noindex' });
        this.removeCanonicalUrl();
        if (this.baseUrl) {
            this.updateAgentLinks();
        }
    }

    /**
     * Keep this page out of every index without calling it a 404 (#250).
     *
     * A tailored application link (`/for/:slug`) is a REAL page — it returns
     * 200 and renders the portfolio — that is shared with exactly one
     * recipient. `robots.txt` disallows `/for/` too, but robots.txt is a
     * request to well-behaved crawlers; the meta tag is what a page that has
     * already been fetched carries with it. Written into the INJECTED document
     * via Angular's Meta service, so it is present in the SERVER-rendered HTML.
     */
    setNoIndex(): void {
        this.noIndex = true;
        this.metaService.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    }

    /**
     * Write `<link rel="canonical">` into the head of the INJECTED document.
     *
     * Deliberately NOT guarded by `isPlatformBrowser` (#71): the guard is for
     * the ambient `window`/`document` globals, which do not exist under SSR.
     * The injected `DOCUMENT` is the per-request server document during SSR and
     * the real one in the browser, so writing to it is SSR-safe by construction
     * — exactly how Angular's own Title/Meta services work. With the old
     * browser-only guard the canonical link existed only AFTER hydration, so it
     * was absent from the server-rendered HTML that crawlers actually read.
     */
    private updateCanonicalUrl(url: string): void {
        this.updateLink("link[rel='canonical']", { rel: 'canonical' }, url);
    }

    /**
     * Drop the `<link rel="canonical">` from the injected document (#324).
     *
     * A client-side navigation keeps the previous page's head, so a canonical
     * written by a real page would otherwise survive onto the 404 that follows
     * it — the same "the document outlives the route" problem the robots meta
     * has. `updateSeo` re-creates the element when a real page is rendered
     * next, so removing it is safe in both directions.
     */
    private removeCanonicalUrl(): void {
        this.document.querySelector("link[rel='canonical']")?.remove();
    }

    /** Upsert one `<link>` in the injected document's head, by selector. */
    private updateLink(selector: string, attributes: Record<string, string>, href: string): void {
        let link: HTMLLinkElement | null = this.document.querySelector(selector);
        if (!link) {
            link = this.document.createElement('link');
            for (const [name, value] of Object.entries(attributes)) {
                link.setAttribute(name, value);
            }
            this.document.head.appendChild(link);
        }
        link.setAttribute('href', href);
    }
}
