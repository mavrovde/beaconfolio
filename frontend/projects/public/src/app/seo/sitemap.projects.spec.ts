import { describe, it, expect, vi } from 'vitest';
import {
    API_PREFIX,
    buildSitemapXml,
    fetchProjectSlugs,
    JsonFetcher,
    PROFILE_PATH,
    renderSitemapXml,
} from './sitemap';

const fetcherFor = (routes: Record<string, unknown>): JsonFetcher =>
    vi.fn(async (path: string) => {
        if (!(path in routes)) {
            throw new Error(`unexpected ${path}`);
        }
        return routes[path];
    });

describe('sitemap project detail pages (#92)', () => {
    it('reads the public profile path', () => {
        expect(PROFILE_PATH).toBe(`${API_PREFIX}/profile`);
    });

    it('returns the slugs the /projects/:slug route resolves, de-duplicated and title-derived', async () => {
        const fetchJson = fetcherFor({
            [PROFILE_PATH]: {
                projects: [
                    { title: 'ViaFrei MCP', slug: 'viafrei-mcp' },
                    { title: 'thekotlin.com' },
                    { title: 'Portfolio' },
                    { title: 'Portfolio' },
                    { title: '   ' },
                ],
            },
        });
        await expect(fetchProjectSlugs(fetchJson)).resolves.toEqual([
            'viafrei-mcp',
            'thekotlin-com',
            'portfolio',
            'portfolio-2',
        ]);
    });

    it('yields no project URLs when the profile has none or cannot be read', async () => {
        await expect(fetchProjectSlugs(fetcherFor({ [PROFILE_PATH]: {} }))).resolves.toEqual([]);
        await expect(fetchProjectSlugs(fetcherFor({ [PROFILE_PATH]: null }))).resolves.toEqual([]);
        await expect(fetchProjectSlugs(fetcherFor({}))).resolves.toEqual([]);
    });

    it('lists each project page with the profile lastmod, escaped', () => {
        const xml = buildSitemapXml('https://example.com/', [], { profile: '2026-10-18' }, [
            'bookvault',
            'a&b',
        ]);
        expect(xml).toContain(
            '  <url>\n' +
                '    <loc>https://example.com/projects/bookvault</loc>\n' +
                '    <lastmod>2026-10-18</lastmod>\n' +
                '    <changefreq>monthly</changefreq>\n' +
                '    <priority>0.7</priority>\n' +
                '  </url>',
        );
        expect(xml).toContain('<loc>https://example.com/projects/a&amp;b</loc>');
    });

    it('omits lastmod when the profile date is unknown, and adds nothing without projects', () => {
        const withProject = buildSitemapXml('https://example.com', [], {}, ['bookvault']);
        expect(withProject).toContain(
            '    <loc>https://example.com/projects/bookvault</loc>\n    <changefreq>monthly</changefreq>',
        );
        expect(buildSitemapXml('https://example.com', [])).not.toContain('/projects/');
    });

    it('renders the live project pages into sitemap.xml', async () => {
        const fetchJson = fetcherFor({
            [`${API_PREFIX}/config/site`]: { site_url: 'https://forked.example' },
            [PROFILE_PATH]: { projects: [{ title: 'TransPaste' }] },
        });
        const xml = await renderSitemapXml(fetchJson, 'http://localhost');
        expect(xml).toContain('<loc>https://forked.example/projects/transpaste</loc>');
        expect(xml).toContain('<loc>https://forked.example/projects</loc>');
    });
});
