import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    buildRobotsTxt,
    buildSitemapXml,
    createJsonFetcher,
    escapeXml,
    fetchPublishedPosts,
    JsonFetcher,
    renderRobotsTxt,
    renderSitemapXml,
    requestOrigin,
    resolveSiteConfig,
    resolveSiteUrl,
    SsrSiteConfig,
    SSR_BACKEND_ORIGIN,
    SSR_FETCH_TIMEOUT_MS,
    stripTrailingSlash,
} from './sitemap';

const CONFIG_PATH = '/api/app/config/site';
const postsPath = (page: number) =>
    `/api/app/posts?published_only=true&page=${page}&page_size=100&sort_by=published_at&sort_order=desc`;

/** A fetcher answering from a path→payload map; unmapped paths reject like a 404 would. */
const fetcherFor = (routes: Record<string, unknown>): JsonFetcher =>
    vi.fn(async (path: string) => {
        if (!(path in routes)) {
            throw new Error(`unexpected ${path}`);
        }
        return routes[path];
    });

/** A resolved SSR site config, overridable per case. */
const siteConfig = (overrides: Partial<SsrSiteConfig> = {}): SsrSiteConfig => ({
    siteUrl: 'https://example.com',
    siteName: '',
    ownerName: '',
    ownerHeadline: '',
    ownerDescription: '',
    availability: '',
    aiCrawlerPolicy: 'allow',
    ...overrides,
});

describe('escapeXml / stripTrailingSlash', () => {
    it('escapes every XML metacharacter', () => {
        expect(escapeXml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
    });

    it('strips trailing slashes and surrounding whitespace', () => {
        expect(stripTrailingSlash('  https://example.com//  ')).toBe('https://example.com');
        expect(stripTrailingSlash('https://example.com')).toBe('https://example.com');
    });
});

describe('requestOrigin', () => {
    it('prefers the forwarded proto/host injected by the proxy', () => {
        expect(
            requestOrigin(
                {
                    'x-forwarded-proto': 'https',
                    'x-forwarded-host': 'proxied.example',
                    host: 'frontend',
                },
                'http',
            ),
        ).toBe('https://proxied.example');
    });

    it('takes the first hop when a header carries a chain', () => {
        expect(
            requestOrigin(
                { 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'outer.example, frontend' },
                'http',
            ),
        ).toBe('https://outer.example');
    });

    it('unwraps repeated headers delivered as arrays', () => {
        expect(
            requestOrigin({ 'x-forwarded-proto': ['https'], 'x-forwarded-host': ['a.example'] }, 'http'),
        ).toBe('https://a.example');
    });

    it('falls back to the express protocol and Host header', () => {
        expect(requestOrigin({ host: 'localhost:4000' }, 'http')).toBe('http://localhost:4000');
    });

    it('falls back to localhost when there is no host at all', () => {
        expect(requestOrigin({}, 'http')).toBe('http://localhost');
    });
});

describe('createJsonFetcher', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('requests the backend origin and returns the parsed body', async () => {
        const json = vi.fn().mockResolvedValue({ site_url: 'https://example.com' });
        const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json });
        vi.stubGlobal('fetch', fetchSpy);

        await expect(createJsonFetcher()(CONFIG_PATH)).resolves.toEqual({
            site_url: 'https://example.com',
        });
        expect(fetchSpy).toHaveBeenCalledWith(`${SSR_BACKEND_ORIGIN}${CONFIG_PATH}`, {
            headers: { accept: 'application/json' },
            signal: expect.any(AbortSignal),
        });
    });

    it('rejects on a non-2xx response so the caller can degrade', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: vi.fn() }));

        await expect(createJsonFetcher('http://other:9000')(CONFIG_PATH)).rejects.toThrow('503');
    });

    // A HUNG backend (as opposed to a refused one) is the case with no natural
    // bound: without this signal the request would sit until nginx's 300s
    // instead of degrading. Fake timers cannot drive `AbortSignal.timeout` — it
    // runs on a Node-internal timer — so the bound is pinned at the call.
    it('bounds every request with the 5s SSR fetch timeout', async () => {
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
        const json = vi.fn().mockResolvedValue({});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json }));

        await createJsonFetcher()(CONFIG_PATH);

        expect(timeoutSpy).toHaveBeenCalledWith(SSR_FETCH_TIMEOUT_MS);
        expect(SSR_FETCH_TIMEOUT_MS).toBe(5000);
    });

    it('surfaces a timed-out request as a rejection the callers degrade on', async () => {
        const aborted = Object.assign(new Error('The operation was aborted due to timeout'), {
            name: 'TimeoutError',
        });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(aborted));
        const fetchJson = createJsonFetcher();

        await expect(fetchJson(CONFIG_PATH)).rejects.toThrow('timeout');
        // Both consumers turn that into the graceful degrade, not a 500.
        await expect(resolveSiteUrl(fetchJson, 'https://forked.example')).resolves.toBe(
            'https://forked.example',
        );
        await expect(fetchPublishedPosts(fetchJson)).resolves.toEqual([]);
    });
});

describe('resolveSiteUrl', () => {
    it('uses the configured SITE_URL, normalized', async () => {
        const fetchJson = fetcherFor({ [CONFIG_PATH]: { site_url: 'https://example.com/' } });
        await expect(resolveSiteUrl(fetchJson, 'http://localhost')).resolves.toBe('https://example.com');
    });

    it('falls back to the request origin when the backend is unreachable', async () => {
        const fetchJson: JsonFetcher = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        await expect(resolveSiteUrl(fetchJson, 'https://forked.example/')).resolves.toBe(
            'https://forked.example',
        );
    });

    it.each([[{}], [{ site_url: '' }], [null]])(
        'falls back when the payload carries no site_url (%#)',
        async (payload) => {
            const fetchJson = fetcherFor({ [CONFIG_PATH]: payload });
            await expect(resolveSiteUrl(fetchJson, 'http://localhost')).resolves.toBe('http://localhost');
        },
    );
});

describe('resolveSiteConfig', () => {
    it('normalizes the whole identity payload, trimming every field', async () => {
        const fetchJson = fetcherFor({
            [CONFIG_PATH]: {
                site_url: ' https://forked.example/ ',
                site_name: ' Forked Portfolio ',
                owner_name: ' Forked Owner ',
                owner_headline: ' Staff Engineer ',
                owner_description: ' Description. ',
                availability: 'open',
                ai_crawler_policy: 'DENY',
            },
        });

        await expect(resolveSiteConfig(fetchJson, 'http://localhost')).resolves.toEqual({
            siteUrl: 'https://forked.example',
            siteName: 'Forked Portfolio',
            ownerName: 'Forked Owner',
            ownerHeadline: 'Staff Engineer',
            ownerDescription: 'Description.',
            availability: 'open',
            aiCrawlerPolicy: 'deny',
        });
    });

    it('degrades to EMPTY identity — never an invented one — when the backend fails', async () => {
        const fetchJson: JsonFetcher = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

        await expect(resolveSiteConfig(fetchJson, 'https://forked.example/')).resolves.toEqual({
            siteUrl: 'https://forked.example',
            siteName: '',
            ownerName: '',
            ownerHeadline: '',
            ownerDescription: '',
            availability: '',
            // A backend we cannot reach must not be read as "deny".
            aiCrawlerPolicy: 'allow',
        });
    });

    it.each([[{}], [null]])('tolerates an empty payload (%#)', async (payload) => {
        const config = await resolveSiteConfig(fetcherFor({ [CONFIG_PATH]: payload }), 'http://localhost');
        expect(config.siteUrl).toBe('http://localhost');
        expect(config.aiCrawlerPolicy).toBe('allow');
    });
});

describe('fetchPublishedPosts', () => {
    it('collects slugs and lastmod dates across every page', async () => {
        const fetchJson = fetcherFor({
            [postsPath(1)]: {
                total_pages: 2,
                items: [{ slug: 'first', created_at: '2026-01-02T10:00:00+00:00' }],
            },
            [postsPath(2)]: { total_pages: 2, items: [{ slug: 'second', created_at: '2026-02-03' }] },
        });

        // Newest publication first, whatever order the pages arrived in.
        await expect(fetchPublishedPosts(fetchJson)).resolves.toEqual([
            { slug: 'second', lastmod: '2026-02-03', published: '2026-02-03' },
            { slug: 'first', lastmod: '2026-01-02', published: '2026-01-02T10:00:00+00:00' },
        ]);
    });

    it('carries the post title for llms.txt and drops a blank one', async () => {
        const fetchJson = fetcherFor({
            [postsPath(1)]: {
                items: [
                    { slug: 'named', title: '  Vector search in Postgres  ' },
                    { slug: 'untitled', title: '   ' },
                ],
            },
        });

        await expect(fetchPublishedPosts(fetchJson)).resolves.toEqual([
            { slug: 'named', title: 'Vector search in Postgres' },
            { slug: 'untitled' },
        ]);
    });

    it('skips slugless items and omits lastmod when created_at is absent', async () => {
        const fetchJson = fetcherFor({
            [postsPath(1)]: { items: [{ created_at: '2026-01-02' }, { slug: 'only' }] },
        });

        await expect(fetchPublishedPosts(fetchJson)).resolves.toEqual([{ slug: 'only' }]);
    });

    it.each([[{ items: [] }], [null]])(
        'treats a payload without items as no posts (%#)',
        async (payload) => {
            await expect(fetchPublishedPosts(fetcherFor({ [postsPath(1)]: payload }))).resolves.toEqual(
                [],
            );
        },
    );

    it('stops at the page cap even if the backend reports more pages', async () => {
        const fetchJson: JsonFetcher = vi
            .fn()
            .mockResolvedValue({ total_pages: 999, items: [{ slug: 'p' }] });

        await expect(fetchPublishedPosts(fetchJson)).resolves.toHaveLength(20);
        expect(fetchJson).toHaveBeenCalledTimes(20);
    });

    it('degrades to no posts when the API fails', async () => {
        const fetchJson: JsonFetcher = vi.fn().mockRejectedValue(new Error('boom'));
        await expect(fetchPublishedPosts(fetchJson)).resolves.toEqual([]);
    });

    // #252 review, minor 1: llms.txt prints 25 posts. Reading 4 pages of 100 to
    // throw 375 away is 4 SSR→backend round trips per request for nothing.
    it('asks the backend for only as many posts as the caller will use', async () => {
        const fetchJson: JsonFetcher = vi
            .fn()
            .mockResolvedValue({ total_pages: 9, items: Array.from({ length: 25 }, (_, i) => ({ slug: `p${i}` })) });

        await expect(fetchPublishedPosts(fetchJson, 25)).resolves.toHaveLength(25);

        expect(fetchJson).toHaveBeenCalledTimes(1);
        expect(fetchJson).toHaveBeenCalledWith(
            '/api/app/posts?published_only=true&page=1&page_size=25&sort_by=published_at&sort_order=desc',
        );
    });

    it('keeps paging under a limit larger than one page, and trims the surplus', async () => {
        const page = (n: number) => ({
            total_pages: 3,
            items: Array.from({ length: 100 }, (_, i) => ({ slug: `p${n}-${i}` })),
        });
        const fetchJson = fetcherFor({ [postsPath(1)]: page(1), [postsPath(2)]: page(2) });

        await expect(fetchPublishedPosts(fetchJson, 150)).resolves.toHaveLength(150);
        expect(fetchJson).toHaveBeenCalledTimes(2);
    });

    it('returns fewer than the limit when the blog is smaller', async () => {
        const fetchJson: JsonFetcher = vi
            .fn()
            .mockResolvedValue({ total_pages: 1, items: [{ slug: 'only' }] });

        await expect(fetchPublishedPosts(fetchJson, 25)).resolves.toEqual([{ slug: 'only' }]);
    });

    it('is unbounded when no limit is given (the sitemap must list everything)', async () => {
        const fetchJson: JsonFetcher = vi
            .fn()
            .mockResolvedValue({ total_pages: 3, items: [{ slug: 'p' }] });

        await expect(fetchPublishedPosts(fetchJson)).resolves.toHaveLength(3);
        expect(fetchJson).toHaveBeenCalledWith(
            '/api/app/posts?published_only=true&page=1&page_size=100&sort_by=published_at&sort_order=desc',
        );
    });
});

describe('buildSitemapXml', () => {
    it('lists the static routes and every post against the configured domain', () => {
        const xml = buildSitemapXml('https://example.com/', [
            { slug: 'hello-world', lastmod: '2026-02-03' },
            { slug: 'no-date' },
        ]);

        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true);
        for (const loc of [
            'https://example.com/',
            'https://example.com/blog',
            'https://example.com/cv',
            'https://example.com/llm',
            'https://example.com/blog/hello-world',
            'https://example.com/blog/no-date',
        ]) {
            expect(xml).toContain(`<loc>${loc}</loc>`);
        }
        expect(xml).toContain('<lastmod>2026-02-03</lastmod>');
        // The dateless post must not emit an empty <lastmod/>. Three dates:
        // the post itself, plus `/` and `/blog`, which take the NEWEST post's
        // date; the profile-dated routes have no profile date here, so none.
        expect(xml.match(/<lastmod>/g)).toHaveLength(3);
        expect(xml).not.toContain('beaconfolio.com');
        expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
    });

    it('escapes XML metacharacters in a slug', () => {
        expect(buildSitemapXml('https://example.com', [{ slug: 'a&b' }])).toContain(
            '<loc>https://example.com/blog/a&amp;b</loc>',
        );
    });
});

describe('buildRobotsTxt', () => {
    const AI_AGENTS = [
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

    it('welcomes the AI crawlers and points at the configured sitemap', () => {
        const txt = buildRobotsTxt(siteConfig({ siteUrl: 'https://example.com/' }));

        expect(txt).toContain('User-agent: *\nAllow: /');
        for (const agent of AI_AGENTS) {
            expect(txt).toContain(`User-agent: ${agent}\nAllow: /`);
        }
        expect(txt).toContain('Sitemap: https://example.com/sitemap.xml');
        expect(txt).toContain('# llms.txt: https://example.com/llms.txt');
        expect(txt).not.toContain('beaconfolio.com');
    });

    it('turns the AI crawlers away — and ONLY them — under the deny policy (#252)', () => {
        const txt = buildRobotsTxt(
            siteConfig({ siteUrl: 'https://example.com', aiCrawlerPolicy: 'deny' }),
        );

        // Classic search is untouched: the switch is about AI, not visibility.
        expect(txt).toContain('User-agent: *\nAllow: /');
        for (const agent of AI_AGENTS) {
            expect(txt).toContain(`User-agent: ${agent}\nDisallow: /`);
            expect(txt).not.toContain(`User-agent: ${agent}\nAllow: /`);
        }
        expect(txt).toContain('Sitemap: https://example.com/sitemap.xml');
        // The crawler-facing document must not point crawlers at a map in the
        // same breath as refusing them (#252 review, minor 4). `/llms.txt` is
        // still SERVED — it is an on-demand map, not a crawl permission.
        expect(txt).not.toContain('llms.txt');
    });

    it.each(['allow', 'deny'] as const)(
        'keeps the tailored-link and admin surfaces out of every index (%s)',
        (aiCrawlerPolicy) => {
            const txt = buildRobotsTxt(siteConfig({ aiCrawlerPolicy }));
            // #250's /for/* links are shared with ONE recipient; /admin is the
            // operator surface. Under `deny` the AI blocks are already
            // `Disallow: /`, so only the wildcard block needs the exclusions.
            expect(txt).toContain('User-agent: *\nAllow: /\nDisallow: /for/\nDisallow: /admin');
        },
    );
});

describe('render* (the shape the Express routes serve)', () => {
    it('renders robots.txt from the live config', async () => {
        const fetchJson = fetcherFor({ [CONFIG_PATH]: { site_url: 'https://forked.example' } });
        await expect(renderRobotsTxt(fetchJson, 'http://localhost')).resolves.toContain(
            'Sitemap: https://forked.example/sitemap.xml',
        );
    });

    it('renders sitemap.xml from the live config and post list', async () => {
        const fetchJson = fetcherFor({
            [CONFIG_PATH]: { site_url: 'https://forked.example' },
            [postsPath(1)]: { total_pages: 1, items: [{ slug: 'hello', created_at: '2026-02-03' }] },
        });

        const xml = await renderSitemapXml(fetchJson, 'http://localhost');
        expect(xml).toContain('<loc>https://forked.example/</loc>');
        expect(xml).toContain('<loc>https://forked.example/blog/hello</loc>');
    });
});
