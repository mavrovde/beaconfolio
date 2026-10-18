import { describe, it, expect, vi } from 'vitest';
import {
    AI_CRAWLERS,
    buildRobotsTxt,
    buildSitemapXml,
    crawlerAllowed,
    fetchProfileLastmod,
    fetchPublishedPosts,
    JsonFetcher,
    normalizeAiCrawlerPolicy,
    renderSitemapXml,
    RESUME_PATH,
    SsrSiteConfig,
} from './sitemap';

/**
 * The SEO pass on the generated files: accurate `<lastmod>`s, image-sitemap
 * entries, the original post date, and a purpose-aware AI-crawler policy.
 */

const CONFIG_PATH = '/api/app/config/site';
const postsPath = (page: number) =>
    `/api/app/posts?published_only=true&page=${page}&page_size=100&sort_by=published_at&sort_order=desc`;

const fetcherFor = (routes: Record<string, unknown>): JsonFetcher =>
    vi.fn(async (path: string) => {
        if (!(path in routes)) {
            throw new Error(`unexpected ${path}`);
        }
        return routes[path];
    });

const site = (overrides: Partial<SsrSiteConfig> = {}): SsrSiteConfig => ({
    siteUrl: 'https://example.com',
    siteName: '',
    ownerName: '',
    ownerHeadline: '',
    ownerDescription: '',
    availability: '',
    aiCrawlerPolicy: 'allow',
    ...overrides,
});

/** The `<url>` block for one `<loc>`. */
function urlBlock(xml: string, loc: string): string {
    const start = xml.indexOf(`<loc>${loc}</loc>`);
    expect(start, `no <loc>${loc}</loc>`).toBeGreaterThan(-1);
    return xml.slice(start, xml.indexOf('</url>', start));
}

describe('fetchPublishedPosts — the ORIGINAL post date', () => {
    it('dates a post by posted_at, not by the import that created it', async () => {
        const fetchJson = fetcherFor({
            [postsPath(1)]: {
                items: [
                    { slug: 'imported', created_at: '2026-10-18T08:23:00Z', posted_at: '2025-03-04T09:00:00Z' },
                    { slug: 'native', created_at: '2026-01-02T00:00:00Z', posted_at: null },
                ],
            },
        });
        const posts = await fetchPublishedPosts(fetchJson);
        // Newest publication first: the native 2026 post, then the 2025 one
        // the import created later.
        expect(posts.map((post) => [post.slug, post.lastmod])).toEqual([
            ['native', '2026-01-02'],
            ['imported', '2025-03-04'],
        ]);
    });

    it('uses updated_at for lastmod when the list carries it (#493), keeping the publication date', async () => {
        const fetchJson = fetcherFor({
            [postsPath(1)]: {
                items: [
                    { slug: 'edited', created_at: '2026-10-18T08:23:00Z', posted_at: '2025-03-04T09:00:00Z', updated_at: '2026-10-19T00:00:00Z' },
                ],
            },
        });
        expect(await fetchPublishedPosts(fetchJson)).toEqual([
            { slug: 'edited', lastmod: '2026-10-19', published: '2025-03-04T09:00:00Z' },
        ]);
    });

    it('keeps the arrival order between equally dated posts and puts undated ones last', async () => {
        const fetchJson = fetcherFor({
            [postsPath(1)]: {
                items: [
                    { slug: 'undated' },
                    { slug: 'a', created_at: '2026-01-01' },
                    { slug: 'b', created_at: '2026-01-01' },
                ],
            },
        });
        expect((await fetchPublishedPosts(fetchJson)).map((post) => post.slug)).toEqual(['a', 'b', 'undated']);
    });

    it('carries the image, the raw text and the language, and recovers a cut title', async () => {
        const fetchJson = fetcherFor({
            [postsPath(1)]: {
                items: [
                    {
                        slug: 'cut',
                        title: 'Are frameworks still the default in the AI…',
                        content: 'Are frameworks still the default in the AI era? Long body.',
                        summary: 'Short.',
                        image_url: '/api/app/posts/7/image',
                        language: 'de',
                        created_at: '2026-01-01',
                    },
                ],
            },
        });
        expect(await fetchPublishedPosts(fetchJson)).toEqual([
            {
                slug: 'cut',
                lastmod: '2026-01-01',
                published: '2026-01-01',
                title: 'Are frameworks still the default in the AI era?',
                image: '/api/app/posts/7/image',
                content: 'Are frameworks still the default in the AI era? Long body.',
                summary: 'Short.',
                language: 'de',
            },
        ]);
    });
});

describe('fetchProfileLastmod', () => {
    it('reads the JSON Resume meta.lastModified as a date', async () => {
        const fetchJson = fetcherFor({ [RESUME_PATH]: { meta: { lastModified: '2026-09-10T11:46:15+00:00' } } });
        await expect(fetchProfileLastmod(fetchJson)).resolves.toBe('2026-09-10');
    });

    it.each([[{ meta: { lastModified: null } }], [{}], [null]])('is undefined for %j', async (payload) => {
        await expect(fetchProfileLastmod(fetcherFor({ [RESUME_PATH]: payload }))).resolves.toBeUndefined();
    });

    it('is undefined when the backend fails — never "now"', async () => {
        await expect(fetchProfileLastmod(fetcherFor({}))).resolves.toBeUndefined();
    });
});

describe('buildSitemapXml — static lastmod, images', () => {
    const posts = [
        { slug: 'older', lastmod: '2026-01-05' },
        { slug: 'newer', lastmod: '2026-03-01', image: '/api/app/posts/2/image' },
        { slug: 'remote', lastmod: '2025-12-01', image: 'https://cdn.example/a&b.png' },
    ];

    it('dates each static route from its data source, never from the request', () => {
        const xml = buildSitemapXml('https://example.com', posts, { profile: '2026-02-10' });
        // Home renders the profile AND the posts: the newer of the two.
        expect(urlBlock(xml, 'https://example.com/')).toContain('<lastmod>2026-03-01</lastmod>');
        expect(urlBlock(xml, 'https://example.com/blog')).toContain('<lastmod>2026-03-01</lastmod>');
        for (const path of ['/projects', '/cv', '/llm']) {
            expect(urlBlock(xml, `https://example.com${path}`)).toContain('<lastmod>2026-02-10</lastmod>');
        }
    });

    it('lets the profile date win on the home page when it is the newer one', () => {
        const xml = buildSitemapXml('https://example.com', posts, { profile: '2026-09-10' });
        expect(urlBlock(xml, 'https://example.com/')).toContain('<lastmod>2026-09-10</lastmod>');
    });

    it('is byte-stable across renders (no request-time dates)', () => {
        expect(buildSitemapXml('https://example.com', posts, { profile: '2026-02-10' })).toBe(
            buildSitemapXml('https://example.com', posts, { profile: '2026-02-10' }),
        );
    });

    it('emits image:image entries for posts that have an image, absolute and escaped', () => {
        const xml = buildSitemapXml('https://example.com', posts);
        expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
        expect(urlBlock(xml, 'https://example.com/blog/newer')).toContain(
            '<image:loc>https://example.com/api/app/posts/2/image</image:loc>',
        );
        expect(urlBlock(xml, 'https://example.com/blog/remote')).toContain(
            '<image:loc>https://cdn.example/a&amp;b.png</image:loc>',
        );
        expect(urlBlock(xml, 'https://example.com/blog/older')).not.toContain('image:image');
    });

    it('joins a slash-less relative image path correctly', () => {
        const xml = buildSitemapXml('https://example.com', [{ slug: 'x', image: 'img/x.png' }]);
        expect(xml).toContain('<image:loc>https://example.com/img/x.png</image:loc>');
    });

    it('keeps the home <loc> byte-identical to the canonical the page emits', () => {
        expect(buildSitemapXml('https://example.com/', [])).toContain('<loc>https://example.com/</loc>');
    });

    it('renders the profile date fetched from the JSON Resume', async () => {
        const fetchJson = fetcherFor({
            [CONFIG_PATH]: { site_url: 'https://forked.example' },
            [postsPath(1)]: { items: [] },
            [RESUME_PATH]: { meta: { lastModified: '2026-04-04T00:00:00Z' } },
        });
        const xml = await renderSitemapXml(fetchJson, 'http://localhost');
        expect(urlBlock(xml, 'https://forked.example/cv')).toContain('<lastmod>2026-04-04</lastmod>');
    });
});

describe('AI crawler policy', () => {
    it.each([
        [undefined, 'allow'],
        ['', 'allow'],
        ['ALLOW', 'allow'],
        [' deny ', 'deny'],
        ['search-only', 'search-only'],
        ['Search_Only', 'search-only'],
        ['typo', 'allow'],
    ])('normalizes %j to %s', (wire, expected) => {
        expect(normalizeAiCrawlerPolicy(wire)).toBe(expected);
    });

    it('names every documented agent exactly once, each with a purpose', () => {
        const agents = AI_CRAWLERS.map((crawler) => crawler.agent);
        expect(new Set(agents).size).toBe(agents.length);
        for (const required of [
            'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
            'Claude-Web', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'YouBot', 'Google-Extended',
            'Applebot-Extended', 'CCBot', 'meta-externalagent', 'Meta-ExternalFetcher', 'DuckAssistBot',
            'Amazonbot', 'MistralAI-User', 'Bytespider', 'cohere-ai',
        ]) {
            expect(agents).toContain(required);
        }
        // Classic search engines are governed by `User-agent: *` alone.
        expect(agents).not.toContain('Googlebot');
        expect(agents).not.toContain('Bingbot');
    });

    it.each([
        ['allow', 'training', true],
        ['allow', 'search', true],
        ['deny', 'search', false],
        ['deny', 'user', false],
        ['search-only', 'training', false],
        ['search-only', 'search', true],
        ['search-only', 'user', true],
    ] as const)('policy %s lets a %s agent in: %s', (policy, purpose, expected) => {
        expect(crawlerAllowed(policy, purpose)).toBe(expected);
    });

    it('search-only refuses training crawlers and keeps search + user agents', () => {
        const txt = buildRobotsTxt(site({ aiCrawlerPolicy: 'search-only' }));
        for (const { agent, purpose } of AI_CRAWLERS) {
            const rule = purpose === 'training' ? 'Disallow: /' : 'Allow: /\nDisallow: /for/';
            expect(txt, agent).toContain(`User-agent: ${agent}\n${rule}`);
        }
        expect(txt).toContain('AI_CRAWLER_POLICY=search-only');
        // Classic search and the sitemap/llms breadcrumb are untouched.
        expect(txt).toContain('User-agent: *\nAllow: /\nDisallow: /for/\nDisallow: /admin');
        expect(txt).toContain('Sitemap: https://example.com/sitemap.xml');
        expect(txt).toContain('# llms.txt: https://example.com/llms.txt');
    });

    it('never names Googlebot or Bingbot under any policy', () => {
        for (const aiCrawlerPolicy of ['allow', 'deny', 'search-only'] as const) {
            const txt = buildRobotsTxt(site({ aiCrawlerPolicy }));
            expect(txt).not.toMatch(/User-agent: (Googlebot|Bingbot)/);
        }
    });
});
