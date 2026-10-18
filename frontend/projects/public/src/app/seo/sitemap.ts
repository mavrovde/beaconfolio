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
import { fullPostTitle, trimTrailingSlashes } from './text';

/** Injected JSON fetcher, so the render functions are testable without network. */
export type JsonFetcher = (path: string) => Promise<unknown>;

/** Container-internal backend origin during SSR — same address `SsrHttpBackend` rewrites to. */
export { SSR_BACKEND_ORIGIN };

export const API_PREFIX = '/api/app';
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

/**
 * What a static route's `<lastmod>` is derived from — never the request time.
 *
 * `profile` = the active profile's own timestamp (JSON Resume
 * `meta.lastModified`); `posts` = the newest post's publication date; `both`
 * = whichever is newer (the home page renders both). A route whose source is
 * unknown simply carries no `<lastmod>`: a date that changes on every request
 * teaches crawlers to ignore the field for the whole site.
 */
export type LastmodSource = 'profile' | 'posts' | 'both';

/** Static public routes, mirroring `app.routes.ts` (`/blog/:slug` is expanded from the API). */
export const STATIC_ROUTES: readonly {
    path: string;
    changefreq: string;
    priority: string;
    lastmod: LastmodSource;
}[] = [
    { path: '/', changefreq: 'weekly', priority: '1.0', lastmod: 'both' },
    { path: '/blog', changefreq: 'weekly', priority: '0.8', lastmod: 'posts' },
    // #92. Priority matches /blog rather than /cv: "what I built" is the
    // highest-signal surface for the recruiter this site is written for, and
    // the list page is always reachable even when the profile carries no
    // projects (it renders its own empty state).
    { path: '/projects', changefreq: 'weekly', priority: '0.8', lastmod: 'profile' },
    { path: '/cv', changefreq: 'monthly', priority: '0.8', lastmod: 'profile' },
    { path: '/llm', changefreq: 'monthly', priority: '0.5', lastmod: 'profile' },
];

export interface SitemapPost {
    slug: string;
    /**
     * `YYYY-MM-DD` of the last change: `updated_at`, else the publication date
     * (`posted_at`, else `created_at`) — the backend contract of #493.
     */
    lastmod?: string;
    /** Full ISO publication date (`posted_at ?? created_at`) — the sort key and the llms.txt date. */
    published?: string;
    /** The full headline (an importer's `…` cut undone) — for `llms.txt`. */
    title?: string;
    /** Site-relative or absolute image URL, for `<image:image>`. */
    image?: string;
    /** Raw post body/summary — only `llms-full.txt` reads them. */
    content?: string;
    summary?: string;
    language?: string;
}

/** The dates static `<lastmod>`s are derived from (see `LastmodSource`). */
export interface SitemapDates {
    profile?: string;
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

/**
 * #252: `allow` (default) or `deny`, from the backend's `AI_CRAWLER_POLICY`;
 * plus `search-only` — answer-engine SEARCH and on-behalf-of-a-USER fetchers
 * allowed, model-TRAINING crawlers refused. See `AI_CRAWLERS`.
 */
export type AiCrawlerPolicy = 'allow' | 'deny' | 'search-only';

/** Wire value → policy. Unknown/absent means allow (never deindex by typo). */
export function normalizeAiCrawlerPolicy(value: string | undefined): AiCrawlerPolicy {
    const policy = (value ?? '').trim().toLowerCase().replace('_', '-');
    return policy === 'deny' || policy === 'search-only' ? policy : 'allow';
}

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
    /** The original publication date — ABSENT on a backend that predates it. */
    posted_at?: string | null;
    /** Last edit of the post (list payload, #493). */
    updated_at?: string | null;
    title?: string;
    image_url?: string | null;
    content?: string;
    summary?: string | null;
    language?: string;
}
/** The slice of the JSON Resume document (#252) the sitemap reads. */
interface ResumeWire {
    meta?: { lastModified?: string | null };
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
    return trimTrailingSlashes(url.trim());
}

/**
 * A `Host` value safe to echo into a generated file: a DNS name or bracketed
 * IPv6 literal, optional port. Labels are dot-separated runs, so the pattern
 * has no overlapping quantifiers (linear on any input).
 */
const HOST_PATTERN = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/**
 * The origin this request arrived on, used only as a fallback when the backend
 * (and therefore `SITE_URL`) is unreachable — a sitemap needs ABSOLUTE URLs, so
 * "no origin at all" is not an option. Behind the two nginx layers the raw
 * `Host` is the internal service name, hence the forwarded headers first.
 *
 * Both halves are CLIENT-controlled headers that end up in a response body
 * (Sonar `tssecurity:S5131`), so neither is echoed unvalidated: the scheme is
 * `http` or `https` and nothing else, and a host that is not a plain
 * hostname[:port] degrades to `localhost` — the same value a request with no
 * host at all gets.
 */
export function requestOrigin(
    headers: Readonly<Record<string, string | string[] | undefined>>,
    protocol: string,
): string {
    const first = (value: string | string[] | undefined): string =>
        (Array.isArray(value) ? value[0] : value) ?? '';
    const scheme = (value: string): string | undefined => {
        const lowered = value.trim().toLowerCase();
        return lowered === 'http' || lowered === 'https' ? lowered : undefined;
    };
    const proto =
        scheme(first(headers['x-forwarded-proto']).split(',')[0]) ?? scheme(protocol) ?? 'http';
    const candidate =
        first(headers['x-forwarded-host']).split(',')[0].trim() || first(headers['host']).trim();
    const host = HOST_PATTERN.test(candidate) ? candidate : 'localhost';
    return `${proto}://${host}`;
}

/**
 * The configured `SITE_URL`, normalized through the WHATWG URL parser, or ''
 * when it is not an absolute http(s) URL. The value is written into every
 * generated file, so it is parsed rather than trusted as text: the parser
 * percent-encodes anything markup-shaped in a path, and a non-web scheme
 * (`javascript:`, `data:`) never passes.
 */
export function normalizeSiteUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return '';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return '';
    }
    return stripTrailingSlash(url.href);
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
        siteUrl: normalizeSiteUrl(text(wire?.site_url)) || stripTrailingSlash(fallbackOrigin),
        siteName: text(wire?.site_name),
        ownerName: text(wire?.owner_name),
        ownerHeadline: text(wire?.owner_headline),
        ownerDescription: text(wire?.owner_description),
        availability: text(wire?.availability),
        // Unknown/absent means allow: being read by recruiter-side AI is the
        // product's purpose, and a deploy-window skew must never deindex a
        // portfolio by accident (the backend normalizes the same way).
        aiCrawlerPolicy: normalizeAiCrawlerPolicy(wire?.ai_crawler_policy),
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
                `${API_PREFIX}/posts?published_only=true&page=${page}&page_size=${pageSize}` +
                    // Newest ORIGINAL publication first, so a bounded read
                    // (llms.txt) gets the newest posts. A backend predating
                    // the `published_at` key ignores it; the result is
                    // re-sorted below either way.
                    `&sort_by=published_at&sort_order=desc`,
            )) as PostPageWire | null;
            for (const item of wire?.items ?? []) {
                if (item.slug) {
                    posts.push(toSitemapPost(item as PostWire & { slug: string }));
                }
            }
            if (limit !== undefined && posts.length >= limit) {
                return newestFirst(posts).slice(0, limit);
            }
            totalPages = typeof wire?.total_pages === 'number' ? wire.total_pages : 1;
        }
    } catch {
        // A sitemap listing the static routes beats a 500 on /sitemap.xml.
    }
    return newestFirst(posts);
}

/** Stable newest-first by publication date (`posted_at ?? created_at`); undated last. */
function newestFirst(posts: SitemapPost[]): SitemapPost[] {
    return posts
        .map((post, index) => ({ post, index }))
        .sort(
            (a, b) =>
                (b.post.published ?? '').localeCompare(a.post.published ?? '') || a.index - b.index,
        )
        .map(({ post }) => post);
}

/** One API post → the facts the generated files need. */
function toSitemapPost(item: PostWire & { slug: string }): SitemapPost {
    const post: SitemapPost = { slug: item.slug };
    // The ORIGINAL publication date: for an imported post `created_at` is the
    // import run — the live sitemap dated every post to the same afternoon.
    const published = item.posted_at || item.created_at || '';
    if (published) {
        post.published = published;
    }
    const lastmod = (item.updated_at || published).slice(0, 10);
    if (lastmod) {
        post.lastmod = lastmod;
    }
    const title = fullPostTitle(item.title ?? '', item.content);
    if (title) {
        post.title = title;
    }
    const image = (item.image_url ?? '').trim();
    if (image) {
        post.image = image;
    }
    if (item.content) {
        post.content = item.content;
    }
    if (item.summary) {
        post.summary = item.summary;
    }
    if (item.language) {
        post.language = item.language;
    }
    return post;
}

/** The profile's own last-modified date (`YYYY-MM-DD`), or undefined. */
export async function fetchProfileLastmod(fetchJson: JsonFetcher): Promise<string | undefined> {
    try {
        const resume = (await fetchJson(RESUME_PATH)) as ResumeWire | null;
        return (resume?.meta?.lastModified ?? '').slice(0, 10) || undefined;
    } catch {
        // No date is better than a wrong one; the sitemap still renders.
        return undefined;
    }
}

/** The newest of the given `YYYY-MM-DD` dates (ISO dates sort as strings). */
function newest(dates: readonly (string | undefined)[]): string | undefined {
    let latest: string | undefined;
    for (const date of dates) {
        if (date && (latest === undefined || date > latest)) {
            latest = date;
        }
    }
    return latest;
}

function staticLastmod(
    source: LastmodSource,
    dates: SitemapDates,
    posts: readonly SitemapPost[],
): string | undefined {
    const newestPost = newest(posts.map((post) => post.lastmod));
    if (source === 'posts') {
        return newestPost;
    }
    return source === 'profile' ? dates.profile : newest([dates.profile, newestPost]);
}

function absolute(base: string, url: string): string {
    if (/^https?:\/\//i.test(url)) {
        return url;
    }
    const separator = url.startsWith('/') ? '' : '/';
    return `${base}${separator}${url}`;
}

export function buildSitemapXml(
    siteUrl: string,
    posts: readonly SitemapPost[],
    dates: SitemapDates = {},
): string {
    const base = stripTrailingSlash(siteUrl);
    const lastmodLine = (date: string | undefined) =>
        date ? `    <lastmod>${escapeXml(date)}</lastmod>\n` : '';
    const urls = [
        ...STATIC_ROUTES.map(
            (route) =>
                `  <url>\n` +
                `    <loc>${escapeXml(`${base}${route.path}`)}</loc>\n` +
                lastmodLine(staticLastmod(route.lastmod, dates, posts)) +
                `    <changefreq>${route.changefreq}</changefreq>\n` +
                `    <priority>${route.priority}</priority>\n` +
                `  </url>`,
        ),
        ...posts.map(
            (post) =>
                `  <url>\n` +
                `    <loc>${escapeXml(`${base}/blog/${post.slug}`)}</loc>\n` +
                lastmodLine(post.lastmod) +
                `    <changefreq>monthly</changefreq>\n` +
                `    <priority>0.6</priority>\n` +
                // Google's image-sitemap extension: the post's picture is
                // otherwise discoverable only by rendering the page.
                (post.image
                    ? `    <image:image>\n` +
                      `      <image:loc>${escapeXml(absolute(base, post.image))}</image:loc>\n` +
                      `    </image:image>\n`
                    : '') +
                `  </url>`,
        ),
    ];
    return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
        `xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
        `${urls.join('\n')}\n` +
        `</urlset>\n`
    );
}

/** What an AI user-agent fetches FOR — the axis the `search-only` policy splits on. */
export type CrawlerPurpose = 'training' | 'search' | 'user';

/**
 * The AI crawlers this file names EXPLICITLY (#252), each with its purpose.
 *
 * Naming them is the whole point: `User-agent: *` already permits them, but an
 * explicit block is what makes the policy legible — and what makes a `deny`
 * or `search-only` switch expressible without also deindexing Google. The
 * list is the set of agents that publish a stable token and feed an answer
 * engine or a model a recruiter might use. Purposes follow each operator's
 * own documentation: `training` crawls corpora for model training, `search`
 * builds an answer-engine index, `user` fetches a page because a person asked
 * an assistant to. Googlebot and Bingbot are deliberately absent — classic
 * search is governed by `User-agent: *` alone and no policy here touches it.
 */
export const AI_CRAWLERS: readonly { agent: string; purpose: CrawlerPurpose }[] = [
    { agent: 'GPTBot', purpose: 'training' },
    { agent: 'OAI-SearchBot', purpose: 'search' },
    { agent: 'ChatGPT-User', purpose: 'user' },
    { agent: 'ClaudeBot', purpose: 'training' },
    { agent: 'Claude-SearchBot', purpose: 'search' },
    { agent: 'Claude-User', purpose: 'user' },
    { agent: 'Claude-Web', purpose: 'user' },
    { agent: 'anthropic-ai', purpose: 'training' },
    { agent: 'Google-Extended', purpose: 'training' },
    { agent: 'PerplexityBot', purpose: 'search' },
    { agent: 'Perplexity-User', purpose: 'user' },
    { agent: 'Applebot-Extended', purpose: 'training' },
    { agent: 'meta-externalagent', purpose: 'training' },
    { agent: 'Meta-ExternalFetcher', purpose: 'user' },
    { agent: 'CCBot', purpose: 'training' },
    { agent: 'YouBot', purpose: 'search' },
    { agent: 'DuckAssistBot', purpose: 'search' },
    { agent: 'Amazonbot', purpose: 'training' },
    { agent: 'MistralAI-User', purpose: 'user' },
    { agent: 'Bytespider', purpose: 'training' },
    { agent: 'cohere-ai', purpose: 'training' },
];

/** Whether `policy` lets an agent of `purpose` read the site. */
export function crawlerAllowed(policy: AiCrawlerPolicy, purpose: CrawlerPurpose): boolean {
    if (policy === 'deny') {
        return false;
    }
    return policy === 'allow' || purpose !== 'training';
}

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
    const policy = site.aiCrawlerPolicy;
    const deny = policy === 'deny';
    const headline: Record<AiCrawlerPolicy, string> = {
        allow: '# AI crawlers are explicitly welcome (AI_CRAWLER_POLICY=allow)',
        deny: '# AI crawlers are DENIED by this deployment (AI_CRAWLER_POLICY=deny)',
        'search-only':
            '# AI search and user-requested fetches are welcome; model-training crawlers are not (AI_CRAWLER_POLICY=search-only)',
    };
    const blocks = [
        'User-agent: *',
        'Allow: /',
        ...DISALLOWED_PATHS.map((path) => `Disallow: ${path}`),
        '',
        headline[policy],
        ...AI_CRAWLERS.flatMap(({ agent, purpose }) =>
            crawlerAllowed(policy, purpose)
                ? [
                      `User-agent: ${agent}`,
                      'Allow: /',
                      ...DISALLOWED_PATHS.map((path) => `Disallow: ${path}`),
                      '',
                  ]
                : [`User-agent: ${agent}`, 'Disallow: /', ''],
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
    const [siteUrl, posts, profile] = await Promise.all([
        resolveSiteUrl(fetchJson, fallbackOrigin),
        fetchPublishedPosts(fetchJson),
        fetchProfileLastmod(fetchJson),
    ]);
    return buildSitemapXml(siteUrl, posts, { profile });
}
