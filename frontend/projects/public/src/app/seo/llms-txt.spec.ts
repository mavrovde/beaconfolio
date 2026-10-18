import { describe, it, expect, vi } from 'vitest';
import { buildLlmsTxt, escapeMarkdown, LLMS_TXT_MAX_POSTS, renderLlmsTxt } from './llms-txt';
import { JsonFetcher, SitemapPost, SsrSiteConfig } from './sitemap';

const CONFIG_PATH = '/api/app/config/site';
/** llms.txt reads ONE bounded page — `page_size` is the printed cap, not 100. */
const postsPath = (page: number) =>
    `/api/app/posts?published_only=true&page=${page}&page_size=${LLMS_TXT_MAX_POSTS}&sort_by=published_at&sort_order=desc`;

const fetcherFor = (routes: Record<string, unknown>): JsonFetcher =>
    vi.fn(async (path: string) => {
        if (!(path in routes)) {
            throw new Error(`unexpected ${path}`);
        }
        return routes[path];
    });

const siteConfig = (overrides: Partial<SsrSiteConfig> = {}): SsrSiteConfig => ({
    siteUrl: 'https://example.com',
    siteName: 'Example Portfolio',
    ownerName: 'Example Owner',
    ownerHeadline: 'Staff Engineer',
    ownerDescription: 'Portfolio of a staff engineer.',
    availability: 'open',
    aiCrawlerPolicy: 'allow',
    ...overrides,
});

/** The llmstxt.org sections, in the order the spec fixes them. */
const headings = (txt: string) => txt.split('\n').filter((line) => line.startsWith('#'));

describe('buildLlmsTxt', () => {
    it('follows the llms.txt format: H1, blockquote summary, then link lists', () => {
        const txt = buildLlmsTxt(siteConfig(), []);
        const lines = txt.split('\n');

        expect(lines[0]).toBe('# Example Portfolio');
        expect(lines[2]).toBe('> Example Owner — Staff Engineer');
        expect(headings(txt)).toEqual([
            '# Example Portfolio',
            '## Profile',
            '## Blog',
            '## Optional',
        ]);
        // Every link list item is `- [name](url)` with optional `: notes`.
        for (const item of lines.filter((line) => line.startsWith('- '))) {
            expect(item).toMatch(/^- \[[^\]]+\]\(https:\/\/example\.com[^)]*\)(: .+)?$/);
        }
    });

    it('links the machine-readable profile FIRST — the one-fetch entry point (#252)', () => {
        const txt = buildLlmsTxt(siteConfig(), []);

        expect(txt).toContain(
            '- [Structured profile (JSON Resume v1.0.0)](https://example.com/api/app/profile/resume.json):',
        );
        expect(txt).toContain('- [Home](https://example.com/):');
        expect(txt).toContain('- [CV](https://example.com/cv):');
        expect(txt).toContain('- [Contact](https://example.com/#contact):');
        expect(txt).toContain('- [AI assistant](https://example.com/llm):');
        expect(txt).toContain('- [Sitemap](https://example.com/sitemap.xml):');
        expect(txt).toContain('- [Crawler policy](https://example.com/robots.txt):');
    });

    it('is built from config alone — no owner or domain literal in the module', () => {
        const txt = buildLlmsTxt(
            siteConfig({
                siteUrl: 'https://forked.example/',
                siteName: 'Forked',
                ownerName: 'Forked Owner',
                ownerHeadline: 'SRE',
                ownerDescription: 'Another portfolio.',
            }),
            [],
        );

        expect(txt.startsWith('# Forked\n')).toBe(true);
        expect(txt).toContain('> Forked Owner — SRE');
        expect(txt).toContain('Another portfolio.');
        expect(txt).toContain('https://forked.example/api/app/profile/resume.json');
        expect(txt).not.toContain('example.com');
        expect(txt).not.toContain('mavrov');
    });

    it.each([
        ['open', 'Availability: Actively looking for new opportunities.'],
        ['listening', 'Availability: Open to hearing about new opportunities.'],
        ['not_looking', 'Availability: Not currently looking for new opportunities.'],
    ])('states the %s availability signal as a quotable sentence', (availability, expected) => {
        expect(buildLlmsTxt(siteConfig({ availability }), [])).toContain(expected);
    });

    it('omits the availability line for an unknown state rather than guessing', () => {
        expect(buildLlmsTxt(siteConfig({ availability: 'on_sabbatical' }), [])).not.toContain(
            'Availability:',
        );
    });

    it('lists published posts by title with their date, falling back to the slug', () => {
        const txt = buildLlmsTxt(siteConfig(), [
            // The PUBLICATION date is printed, not the last-change `lastmod`.
            { slug: 'vector-search', title: 'Vector search', lastmod: '2026-05-05', published: '2026-02-03T10:00:00Z' },
            { slug: 'untitled-post' },
        ]);

        expect(txt).toContain('- [All posts](https://example.com/blog): the complete index');
        expect(txt).toContain('- [Vector search](https://example.com/blog/vector-search): 2026-02-03');
        expect(txt).toContain('- [untitled-post](https://example.com/blog/untitled-post)');
    });

    it('asks the backend for only the posts it will print (#252 review, minor 1)', async () => {
        // A blog far bigger than the cap: 9 pages exist, the file prints 25.
        const fetchJson: JsonFetcher = vi.fn(async (path: string) =>
            path.includes('/posts')
                ? {
                      total_pages: 9,
                      items: Array.from({ length: LLMS_TXT_MAX_POSTS }, (_, i) => ({
                          slug: `p${i}`,
                          title: `P${i}`,
                      })),
                  }
                : { site_url: 'https://example.com' },
        );

        await renderLlmsTxt(fetchJson, 'http://localhost');

        expect(fetchJson).toHaveBeenCalledWith(
            `/api/app/posts?published_only=true&page=1&page_size=${LLMS_TXT_MAX_POSTS}&sort_by=published_at&sort_order=desc`,
        );
        // config + ONE post page, not one page per hundred posts in the blog.
        expect(fetchJson).toHaveBeenCalledTimes(2);
    });

    it('caps the post list so the file still fits in a context window', () => {
        const posts: SitemapPost[] = Array.from({ length: LLMS_TXT_MAX_POSTS + 7 }, (_, i) => ({
            slug: `post-${i}`,
        }));

        const txt = buildLlmsTxt(siteConfig(), posts);

        expect(txt).toContain('/blog/post-0)');
        expect(txt).toContain(`/blog/post-${LLMS_TXT_MAX_POSTS - 1})`);
        expect(txt).not.toContain(`/blog/post-${LLMS_TXT_MAX_POSTS})`);
    });

    it('still renders a valid file when the identity is unknown (backend down)', () => {
        const txt = buildLlmsTxt(
            siteConfig({
                siteName: '',
                ownerName: '',
                ownerHeadline: '',
                ownerDescription: '',
                availability: '',
            }),
            [],
        );

        // The H1 is the only REQUIRED section — it must never be empty.
        expect(txt.startsWith('# Portfolio\n')).toBe(true);
        expect(txt).not.toContain('> ');
        expect(txt).toContain('https://example.com/api/app/profile/resume.json');
    });

    it('falls back to the owner name when only the site name is missing', () => {
        expect(
            buildLlmsTxt(siteConfig({ siteName: '', ownerName: 'Solo Owner' }), []).startsWith(
                '# Solo Owner\n',
            ),
        ).toBe(true);
    });

    it('escapes brackets so a post title cannot break the link syntax', () => {
        expect(escapeMarkdown('A [bracketed] title')).toBe('A \\[bracketed\\] title');
        expect(
            buildLlmsTxt(siteConfig(), [{ slug: 's', title: 'Release [v2]' }]),
        ).toContain('- [Release \\[v2\\]](https://example.com/blog/s)');
    });

    it('escapes the backslash too, so the escaping cannot be forged', () => {
        // A title ending in `\` would otherwise emit `\\]`: markdown reads that
        // as a literal backslash plus an ACTIVE `]`, closing the label
        // (js/incomplete-sanitization, CodeQL on this branch's first push).
        expect(escapeMarkdown('trailing\\')).toBe('trailing\\\\');
        expect(escapeMarkdown('a\\]b')).toBe('a\\\\\\]b');
        expect(buildLlmsTxt(siteConfig(), [{ slug: 's', title: 'a\\] (b)' }])).toContain(
            '- [a\\\\\\] (b)](https://example.com/blog/s)',
        );
    });
});

describe('renderLlmsTxt (the shape the Express route serves)', () => {
    it('renders from the live config and post list', async () => {
        const fetchJson = fetcherFor({
            [CONFIG_PATH]: {
                site_url: 'https://forked.example',
                site_name: 'Forked',
                owner_name: 'Forked Owner',
                owner_headline: 'SRE',
                availability: 'listening',
            },
            [postsPath(1)]: {
                total_pages: 1,
                items: [{ slug: 'hello', title: 'Hello', created_at: '2026-02-03T00:00:00Z' }],
            },
        });

        const txt = await renderLlmsTxt(fetchJson, 'http://localhost');

        expect(txt.startsWith('# Forked\n')).toBe(true);
        expect(txt).toContain('- [Hello](https://forked.example/blog/hello): 2026-02-03');
        expect(txt).toContain('https://forked.example/api/app/profile/resume.json');
    });

    it('degrades to the request origin when the backend is unreachable', async () => {
        const fetchJson: JsonFetcher = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

        const txt = await renderLlmsTxt(fetchJson, 'https://forked.example/');

        expect(txt.startsWith('# Portfolio\n')).toBe(true);
        expect(txt).toContain('https://forked.example/api/app/profile/resume.json');
        expect(txt).not.toContain('/blog/');
    });
});
