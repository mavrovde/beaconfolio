/**
 * Config-driven `sitemap.xml` / `robots.txt` (#71).
 *
 * Both used to be STATIC files in `projects/public/public/` hardcoded to
 * `https://beaconfolio.com`, listing a fixed route set and no blog posts — wrong for
 * every forker and stale for this deployment. They are now rendered per request
 * by the SSR Express server (`src/server.ts`) from the runtime site config
 * (`SITE_URL`, #65) plus the live published-post list.
 *
 * The static files were DELETED on purpose: the frontend nginx does
 * `try_files $uri @ssr` (`frontend/nginx.conf`), so as long as
 * `/robots.txt` / `/sitemap.xml` existed in the browser bundle nginx would keep
 * serving those bytes and the Express routes would never run.
 *
 * Everything except the three-line Express wiring lives here so it is covered
 * by unit tests — `src/server.ts` is excluded from coverage as a
 * framework-generated bootstrap entry point.
 */

import { SSR_BACKEND_ORIGIN } from '../ssr-backend-origin';

/** Injected JSON fetcher, so the render functions are testable without network. */
export type JsonFetcher = (path: string) => Promise<unknown>;

/** Container-internal backend origin during SSR — same address `SsrHttpBackend` rewrites to. */
export { SSR_BACKEND_ORIGIN };

const API_PREFIX = '/api/app';
/**
 * Path of the machine-readable profile (#252). One definition for every
 * server-rendered artifact that advertises it (robots.txt, llms.txt); the
 * BROWSER-side copy is built from `environment.apiPrefix` in `SeoService`,
 * because that is the browser layer's own source of truth for the prefix.
 */
export const RESUME_PATH = `${API_PREFIX}/profile/resume.json`;
/** `page_size` is capped at 100 by the backend (`backend/app/api/posts.py`). */
const POSTS_PAGE_SIZE = 100;
/** Hard bound so a mis-reported `total_pages` can never loop the request forever. */
const MAX_POST_PAGES = 20;

/** Static public routes, mirroring `app.routes.ts` (`/blog/:slug` is expanded from the API). */
export const STATIC_ROUTES: readonly { path: string; changefreq: string; priority: string }[] = [
    { path: '/', changefreq: 'weekly', priority: '1.0' },
    { path: '/blog', changefreq: 'weekly', priority: '0.8' },
    // #92. Priority matches /blog rather than /cv: "what I built" is the
    // highest-signal surface for the recruiter this site is written for, and
    // the list page is always reachable even when the profile carries no
    // projects (it renders its own empty state).
    { path: '/projects', changefreq: 'weekly', priority: '0.8' },
    { path: '/cv', changefreq: 'monthly', priority: '0.8' },
    { path: '/llm', changefreq: 'monthly', priority: '0.5' },
];

export interface SitemapPost {
    slug: string;
    lastmod?: string;
    /** Only `llms.txt` uses it — a link list needs names, a sitemap does not. */
    title?: string;
}

/**
 * The runtime site identity the server-rendered files are built from (#65).
 *
 * Every string except `siteUrl` may legitimately be EMPTY: when the backend is
 * unreachable during SSR the files must still render, and inventing an owner
 * name would publish a lie. `siteUrl` always has a value because an absolute
 * URL is structurally required (sitemap `<loc>`, llms.txt links) — it falls
 * back to the origin the request arrived on.
 */
export interface SsrSiteConfig {
    siteUrl: string;
    siteName: string;
    ownerName: string;
    ownerHeadline: string;
    ownerDescription: string;
    availability: string;
    aiCrawlerPolicy: AiCrawlerPolicy;
}

/** #252: `allow` (default) or `deny`, from the backend's `AI_CRAWLER_POLICY`. */
export type AiCrawlerPolicy = 'allow' | 'deny';

/** Only the fields we consume; anything else on the wire is ignored. */
interface SiteConfigWire {
    site_url?: string;
    site_name?: string;
    owner_name?: string;
    owner_headline?: string;
    owner_description?: string;
    availability?: string;
    /** ABSENT on a pre-#252 backend during a deploy window — defaults to allow. */
    ai_crawler_policy?: string;
}
interface PostWire {
    slug?: string;
    created_at?: string;
    title?: string;
}
interface PostPageWire {
    items?: PostWire[];
    total_pages?: number;
}

const XML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
};

export function escapeXml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

export function stripTrailingSlash(url: string): string {
    return url.trim().replace(/\/+$/, '');
}

/**
 * The origin this request arrived on, used only as a fallback when the backend
 * (and therefore `SITE_URL`) is unreachable — a sitemap needs ABSOLUTE URLs, so
 * "no origin at all" is not an option. Behind the two nginx layers the raw
 * `Host` is the internal service name, hence the forwarded headers first.
 */
export function requestOrigin(
    headers: Readonly<Record<string, string | string[] | undefined>>,
    protocol: string,
): string {
    const first = (value: string | string[] | undefined): string =>
        (Array.isArray(value) ? value[0] : value) ?? '';
    const proto = first(headers['x-forwarded-proto']).split(',')[0].trim() || protocol;
    const host =
        first(headers['x-forwarded-host']).split(',')[0].trim() || first(headers['host']) || 'localhost';
    return `${proto}://${host}`;
}

/**
 * Per-request bound on the SSR→backend reads below.
 *
 * A REFUSED backend rejects instantly, but a HUNG one has no bound of its own:
 * `/robots.txt` and `/sitemap.xml` would then block until nginx's
 * `proxy_read_timeout 300` (`frontend/nginx.conf`) instead of degrading to the
 * routes-only file that `resolveSiteUrl`/`fetchPublishedPosts` already fall back
 * to — the module's "degrade, never 500" contract would hold in principle and
 * fail in practice.
 *
 * 5s matches the house convention for the mirror-image call: the backend reads
 * profile JSON out of the frontend container with
 * `profile_data_timeout_seconds` (`backend/app/config.py:238`, default 5.0,
 * applied at `backend/app/api/years.py:57`). Kept a module constant rather than
 * an env knob because it bounds a container-to-container hop on the compose
 * network, where the deployment has no reason to tune it per-host.
 */
export const SSR_FETCH_TIMEOUT_MS = 5000;

/** A `fetch`-backed JSON fetcher for API paths (`/api/app/...`). */
export function createJsonFetcher(origin: string = SSR_BACKEND_ORIGIN): JsonFetcher {
    return async (path: string) => {
        const response = await fetch(`${origin}${path}`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(SSR_FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
            throw new Error(`GET ${path} failed with ${response.status}`);
        }
        return response.json();
    };
}

/**
 * The runtime site config, normalized. A failure — or a field the backend does
 * not send — degrades to an empty string, never to a hardcoded identity: the
 * file still renders, it just claims less. Same contract as SiteConfigService.
 */
export async function resolveSiteConfig(
    fetchJson: JsonFetcher,
    fallbackOrigin: string,
): Promise<SsrSiteConfig> {
    let wire: SiteConfigWire | null = null;
    try {
        wire = (await fetchJson(`${API_PREFIX}/config/site`)) as SiteConfigWire | null;
    } catch {
        // Identity degrades, the file never 500s — same contract as SiteConfigService.
    }
    const text = (value: string | undefined): string => (value ?? '').trim();
    return {
        siteUrl: stripTrailingSlash(text(wire?.site_url) || fallbackOrigin),
        siteName: text(wire?.site_name),
        ownerName: text(wire?.owner_name),
        ownerHeadline: text(wire?.owner_headline),
        ownerDescription: text(wire?.owner_description),
        availability: text(wire?.availability),
        // Unknown/absent means allow: being read by recruiter-side AI is the
        // product's purpose, and a deploy-window skew must never deindex a
        // portfolio by accident (the backend normalizes the same way).
        aiCrawlerPolicy: text(wire?.ai_crawler_policy).toLowerCase() === 'deny' ? 'deny' : 'allow',
    };
}

/** Configured `SITE_URL`, falling back to the request's own origin. */
export async function resolveSiteUrl(
    fetchJson: JsonFetcher,
    fallbackOrigin: string,
): Promise<string> {
    return (await resolveSiteConfig(fetchJson, fallbackOrigin)).siteUrl;
}

/**
 * Published posts, paged. A failure yields the routes-only sitemap, never an
 * error page.
 *
 * `limit` bounds the read for callers that only show the newest handful:
 * `llms.txt` names 25 posts, and paging a 400-post blog in 100-post requests to
 * throw 375 of them away is four SSR→backend round trips per request for
 * nothing (#252 review, minor 1). `sitemap.xml` passes no limit — it must list
 * everything — so its behaviour is unchanged.
 */
export async function fetchPublishedPosts(
    fetchJson: JsonFetcher,
    limit?: number,
): Promise<SitemapPost[]> {
    const posts: SitemapPost[] = [];
    const pageSize = limit && limit < POSTS_PAGE_SIZE ? limit : POSTS_PAGE_SIZE;
    try {
        let totalPages = 1;
        for (let page = 1; page <= totalPages && page <= MAX_POST_PAGES; page++) {
            const wire = (await fetchJson(
                `${API_PREFIX}/posts?published_only=true&page=${page}&page_size=${pageSize}`,
            )) as PostPageWire | null;
            for (const item of wire?.items ?? []) {
                if (item.slug) {
                    const post: SitemapPost = { slug: item.slug };
                    const lastmod = (item.created_at ?? '').slice(0, 10);
                    if (lastmod) {
                        post.lastmod = lastmod;
                    }
                    const title = (item.title ?? '').trim();
                    if (title) {
                        post.title = title;
                    }
                    posts.push(post);
                }
            }
            if (limit !== undefined && posts.length >= limit) {
                return posts.slice(0, limit);
            }
            totalPages = typeof wire?.total_pages === 'number' ? wire.total_pages : 1;
        }
    } catch {
        // A sitemap listing the static routes beats a 500 on /sitemap.xml.
    }
    return posts;
}

export function buildSitemapXml(siteUrl: string, posts: readonly SitemapPost[]): string {
    const base = stripTrailingSlash(siteUrl);
    const urls = [
        ...STATIC_ROUTES.map(
            (route) =>
                `  <url>\n` +
                `    <loc>${escapeXml(`${base}${route.path}`)}</loc>\n` +
                `    <changefreq>${route.changefreq}</changefreq>\n` +
                `    <priority>${route.priority}</priority>\n` +
                `  </url>`,
        ),
        ...posts.map(
            (post) =>
                `  <url>\n` +
                `    <loc>${escapeXml(`${base}/blog/${post.slug}`)}</loc>\n` +
                (post.lastmod ? `    <lastmod>${escapeXml(post.lastmod)}</lastmod>\n` : '') +
                `    <changefreq>monthly</changefreq>\n` +
                `    <priority>0.6</priority>\n` +
                `  </url>`,
        ),
    ];
    return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `${urls.join('\n')}\n` +
        `</urlset>\n`
    );
}

/**
 * The AI crawlers this file names EXPLICITLY (#252).
 *
 * Naming them is the whole point: `User-agent: *` already permits them, but an
 * explicit block is what makes the policy legible — and what makes a `deny`
 * switch expressible without also deindexing Google. The list is the set of
 * agents that (a) publish a stable token and (b) feed an answer engine a
 * recruiter might use.
 */
const AI_CRAWLERS = [
    'GPTBot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'ClaudeBot',
    'Claude-Web',
    'anthropic-ai',
    'Google-Extended',
    'PerplexityBot',
    'Applebot-Extended',
    'meta-externalagent',
    'CCBot',
    'YouBot',
];

/**
 * Paths no crawler may index, AI or classic (#252 AC3).
 *
 * `/for/` is the tailored-recruiter-link space reserved by #250: those URLs are
 * shared with ONE recipient and must never surface in a search index or an
 * answer engine, so the exclusion ships BEFORE the feature rather than after
 * the first leak. `/admin` is the operator surface (its own app, also reachable
 * on the admin host).
 *
 * Both entries are PREFIXES — robots.txt has no exact-match form, so `/admin`
 * also covers `/admin/`, `/admin-preview`, … and `/for/` covers every tailored
 * link below it. That over-reach is deliberate: this app has no public route
 * starting with either string, and for a surface whose failure mode is "a
 * private link got indexed", excluding one route too many is the safe error
 * (#252 review, minor 2).
 */
const DISALLOWED_PATHS = ['/for/', '/admin'];

export function buildRobotsTxt(site: SsrSiteConfig): string {
    const base = stripTrailingSlash(site.siteUrl);
    const deny = site.aiCrawlerPolicy === 'deny';
    const blocks = [
        'User-agent: *',
        'Allow: /',
        ...DISALLOWED_PATHS.map((path) => `Disallow: ${path}`),
        '',
        deny
            ? '# AI crawlers are DENIED by this deployment (AI_CRAWLER_POLICY=deny)'
            : '# AI crawlers are explicitly welcome (AI_CRAWLER_POLICY=allow)',
        ...AI_CRAWLERS.flatMap((agent) =>
            deny
                ? [`User-agent: ${agent}`, 'Disallow: /', '']
                : [
                      `User-agent: ${agent}`,
                      'Allow: /',
                      ...DISALLOWED_PATHS.map((path) => `Disallow: ${path}`),
                      '',
                  ],
        ),
        `Sitemap: ${base}/sitemap.xml`,
        // Not a robots.txt directive — a comment, which every parser ignores —
        // but the conventional breadcrumb to the agent-facing site map (#252).
        //
        // Dropped under `deny`: robots.txt is the CRAWLER-facing document, and
        // pointing crawlers at a map in the same breath as refusing them is
        // incoherent. `/llms.txt` itself keeps being served either way — it is
        // not a crawl permission but an on-demand map an assistant reads while
        // helping a user, which llmstxt.org calls out as a different purpose
        // from robots.txt, and which an owner who bars bulk training crawlers
        // may still welcome (#252 review, minor 4).
        ...(deny ? [] : [`# llms.txt: ${base}/llms.txt`]),
    ];
    return `${blocks.join('\n')}\n`;
}

export async function renderRobotsTxt(
    fetchJson: JsonFetcher,
    fallbackOrigin: string,
): Promise<string> {
    return buildRobotsTxt(await resolveSiteConfig(fetchJson, fallbackOrigin));
}

export async function renderSitemapXml(
    fetchJson: JsonFetcher,
    fallbackOrigin: string,
): Promise<string> {
    const [siteUrl, posts] = await Promise.all([
        resolveSiteUrl(fetchJson, fallbackOrigin),
        fetchPublishedPosts(fetchJson),
    ]);
    return buildSitemapXml(siteUrl, posts);
}
