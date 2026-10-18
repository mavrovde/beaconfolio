import { Injectable, DOCUMENT, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { SiteConfigService, SiteConfig, DEFAULT_SITE_CONFIG } from './site-config.service';
import { environment } from '../../environments/environment';
import { buildHomeTitle, buildKeywords, buildPageTitle } from '../seo/identity';
import { toMetaDescription, toPlainText } from '../seo/text';

/** Open Graph `article:*` facts for a blog post (og:type=article). */
export interface SeoArticle {
    /** ISO 8601. The ORIGINAL publication date (`posted_at`), not the import. */
    publishedTime: string;
    modifiedTime?: string;
    tags?: string[];
}

export interface SeoData {
    /** The page's own name; the `<title>` becomes `"{title} | {owner}"` when that fits. */
    title?: string;
    /** A complete `<title>`, used verbatim (the composed home title). */
    fullTitle?: string;
    description?: string;
    image?: string;
    /** Alt text for the share card; defaults to the social title. */
    imageAlt?: string;
    url?: string;
    type?: string;
    keywords?: string;
    twitterCard?: string;
    /** Content language when it differs from the UI language (a German post). */
    locale?: string;
    article?: SeoArticle;
}

/**
 * The bundled card's REAL pixel size — measured on the committed file
 * (`sips -g pixelWidth -g pixelHeight projects/public/src/assets/og-image.png`
 * → 1200 × 630), and pinned by a spec that reads the PNG header. Emitted only
 * for that file: a configured or per-page image has dimensions this app does
 * not know, and a wrong `og:image:width` is worse than none.
 */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** The robots directive every INDEXABLE page carries (noindex pages override it). */
export const INDEXABLE_ROBOTS =
    'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

/** UI/content language → Open Graph locale. Unknown languages fall back to English. */
const OG_LOCALES: Record<string, string> = { en: 'en_US', de: 'de_DE' };

export function ogLocale(lang: string | undefined): string {
    return OG_LOCALES[(lang ?? '').slice(0, 2).toLowerCase()] ?? OG_LOCALES['en'];
}

/** A schema.org JSON-LD node, serialized verbatim into a `<script type="application/ld+json">`. */
export type JsonLd = Record<string, unknown>;

/**
 * Path of the bundled social-share card, relative to the configured site URL
 * (#71). The asset physically exists at
 * `projects/public/src/assets/og-image.png` — before #71 this default pointed
 * at a file that was never in the repo, so every share advertised a 404.
 * Final branded artwork is owned by #311; this is the neutral fallback.
 *
 * Since #67 it is the LAST resort, not the only option: a deployment that sets
 * `BEACONFOLIO_BRAND_OG_IMAGE_URL` has its own card served from the site config
 * — see `resolveCard` below for the three-step precedence.
 */
export const OG_IMAGE_PATH = '/assets/og-image.png';

@Injectable({
    providedIn: 'root'
})
export class SeoService {
    private titleService = inject(Title);
    private metaService = inject(Meta);
    private document = inject<Document>(DOCUMENT);

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
    /** The rendered UI language, pushed in by `setLanguage` (AppComponent). */
    private lang = 'en';

    public jsonLdSchema$ = new BehaviorSubject<JsonLd | null>(null);

    constructor() {
        const siteConfig = inject(SiteConfigService);

        siteConfig.config$.subscribe((cfg) => {
            // eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: writes go to the Title/Meta DOM services, never to a template-bound property — no repaint needed.
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

    /** A page with no title of its own: the composed identity title, from config alone. */
    private get baseTitle(): string {
        return buildHomeTitle(
            { name: this.site.ownerName, headline: this.site.ownerHeadline },
            this.site,
        );
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
        // indexable page. Declaring a normal page REPLACES it with the
        // indexable directive; pages that must stay unlisted call
        // `setNoIndex()` right after (#250), which overwrites the same tag.
        this.noIndex = false;
        this.metaService.updateTag({ name: 'robots', content: INDEXABLE_ROBOTS });
        const pageName = toPlainText(data.title);
        const fullTitle = data.fullTitle
            ? data.fullTitle
            : pageName
              ? buildPageTitle(pageName, this.site.ownerName)
              : this.baseTitle;
        // The share title is the page's OWN name, untruncated: the brand
        // travels in og:site_name, and a social card has room a SERP lacks.
        const socialTitle = data.fullTitle || pageName || fullTitle;
        // Plain text, word-cut, entity-decoded: the profile's `about` arrives
        // HTML-escaped (`&amp;`) and Meta escapes once more (the live head read
        // `&amp;amp;`) — see `seo/text.ts`.
        const description = toMetaDescription(data.description || this.defaultDescription);
        // Absolute URLs need a configured site URL. Until the runtime config
        // arrives (or when the backend is unreachable and the neutral default
        // with its empty siteUrl applies) we emit NO og:url / og:image /
        // canonical at all: a relative `og:image` or an empty `og:url` is
        // invalid for every crawler, and a wrong canonical is worse than a
        // missing one. The config subscription re-applies this data the moment
        // the real siteUrl lands, so the SSR head still carries them (#71).
        const image = this.resolveCard(data.image);
        // `data.url || '/'`: the home page's canonical must be `https://site/`,
        // byte-identical to its `<loc>` in the generated sitemap — a canonical
        // and a sitemap entry that differ by a trailing slash are two URL
        // strings for one page.
        const url = this.baseUrl ? `${this.baseUrl}${data.url || '/'}` : '';
        const type = data.type || 'website';
        const keywords =
            data.keywords ||
            buildKeywords({ name: this.site.ownerName, headline: this.site.ownerHeadline }, this.site);

        this.titleService.setTitle(fullTitle);

        // Standard Meta
        this.metaService.updateTag({ name: 'description', content: description });
        this.upsertOrRemove({ name: 'keywords' }, keywords);
        this.upsertOrRemove({ name: 'author' }, this.site.ownerName);
        // Search-engine ownership (Search Console / Bing Webmaster Tools).
        // Optional site-config fields; absent or '' = no tag at all.
        this.upsertOrRemove({ name: 'google-site-verification' }, this.site.googleSiteVerification);
        this.upsertOrRemove({ name: 'msvalidate.01' }, this.site.bingSiteVerification);

        // Open Graph
        this.metaService.updateTag({ property: 'og:title', content: socialTitle });
        this.metaService.updateTag({ property: 'og:description', content: description });
        this.metaService.updateTag({ property: 'og:type', content: type });
        this.upsertOrRemove({ property: 'og:site_name' }, this.site.siteName || this.site.ownerName);
        this.metaService.updateTag({ property: 'og:locale', content: ogLocale(data.locale ?? this.lang) });
        this.applyArticle(type === 'article' ? data.article : undefined);

        // Twitter
        this.metaService.updateTag({ name: 'twitter:card', content: data.twitterCard || 'summary_large_image' });
        this.metaService.updateTag({ name: 'twitter:title', content: socialTitle });
        this.metaService.updateTag({ name: 'twitter:description', content: description });

        const imageAlt = toPlainText(data.imageAlt) || socialTitle;
        if (image) {
            this.metaService.updateTag({ property: 'og:image', content: image });
            this.metaService.updateTag({ property: 'og:image:alt', content: imageAlt });
            this.metaService.updateTag({ name: 'twitter:image', content: image });
            this.metaService.updateTag({ name: 'twitter:image:alt', content: imageAlt });
        }
        const bundledCard = image !== '' && image === this.bundledCardUrl();
        this.upsertOrRemove({ property: 'og:image:width' }, bundledCard ? String(OG_IMAGE_WIDTH) : '');
        this.upsertOrRemove({ property: 'og:image:height' }, bundledCard ? String(OG_IMAGE_HEIGHT) : '');

        if (url) {
            this.metaService.updateTag({ property: 'og:url', content: url });
            this.updateCanonicalUrl(url);
            this.updateAgentLinks();
        }
    }

    /**
     * Push the rendered UI language. Language is a CLIENT toggle on the same
     * URLs — there are no `/de/...` routes — so the honest signals are
     * `<html lang>` and `og:locale` for what was rendered, and NOT `hreflang`
     * alternates, which would claim distinct per-language URLs that do not
     * exist.
     */
    setLanguage(lang: string): void {
        this.lang = lang;
        this.document.documentElement.setAttribute('lang', lang);
        this.metaService.updateTag({
            property: 'og:locale',
            content: ogLocale(this.lastSeoData?.locale ?? lang),
        });
    }

    /** The URL the bundled card resolves to, for the width/height decision. */
    private bundledCardUrl(): string {
        return `${this.baseUrl}${OG_IMAGE_PATH}`;
    }

    /** `article:*` for a post; every one of them REMOVED on any other page. */
    private applyArticle(article: SeoArticle | undefined): void {
        for (const property of ['article:published_time', 'article:modified_time', 'article:author']) {
            this.metaService.removeTag(`property='${property}'`);
        }
        for (const tag of this.metaService.getTags("property='article:tag'")) {
            this.metaService.removeTagElement(tag);
        }
        if (!article) {
            return;
        }
        this.metaService.addTag({ property: 'article:published_time', content: article.publishedTime });
        this.metaService.addTag({
            property: 'article:modified_time',
            content: article.modifiedTime || article.publishedTime,
        });
        // The author's profile URL (Open Graph wants a profile), else the name.
        const author = this.baseUrl ? `${this.baseUrl}/` : this.site.ownerName;
        this.metaService.addTag({ property: 'article:author', content: author });
        this.metaService.addTags(
            (article.tags ?? []).map((tag) => ({ property: 'article:tag', content: tag })),
        );
    }

    /** Write a meta tag when `content` is non-empty, remove it otherwise. */
    private upsertOrRemove(key: { name: string } | { property: string }, content: string | undefined): void {
        const value = (content ?? '').trim();
        if (value) {
            this.metaService.updateTag({ ...key, content: value });
        } else {
            this.metaService.removeTag('name' in key ? `name='${key.name}'` : `property='${key.property}'`);
        }
    }

    /**
     * The absolute `og:image` / `twitter:image` URL, or `''` for none (#67).
     *
     * Three sources, most specific first: what the PAGE asked for, then the
     * deployment's configured card, then the bundled one. The forker's knob
     * therefore rebrands every share preview at once without reaching any page
     * that legitimately ships its own artwork.
     *
     * A configured value may be an absolute URL on a CDN, in which case it is
     * emitted as-is and does not need `siteUrl` at all. A relative one still
     * does: a relative `og:image` is invalid for every crawler, so while the
     * runtime config is in flight (or the backend is unreachable and the
     * neutral default's empty `siteUrl` applies) we emit NO card rather than a
     * broken one — the config subscription re-applies this data the moment the
     * real `siteUrl` lands, so the SSR head still carries it (#71).
     */
    private resolveCard(pageImage: string | undefined): string {
        const card = pageImage || this.site.ogImageUrl || OG_IMAGE_PATH;
        if (/^https?:\/\//i.test(card)) {
            return card;
        }
        if (!this.baseUrl) {
            return '';
        }
        // A hand-written config value may well omit the leading slash; joining
        // it raw would produce `https://exampleassets/card.png`.
        return `${this.baseUrl}${card.startsWith('/') ? '' : '/'}${card}`;
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
        // A 404 body carries no structured data: the previous page's graph
        // (a client-side navigation keeps it) would describe a page this is not.
        this.jsonLdSchema$.next(null);
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
