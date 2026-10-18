import { describe, it, expect, vi } from 'vitest';
import { Profile } from '../services/profile.service';
import {
    buildLlmsFullTxt,
    buildLlmsTxt,
    LLMS_FULL_EXCERPT,
    renderLlmsFullTxt,
} from './llms-txt';
import { JsonFetcher, SitemapPost, SsrSiteConfig } from './sitemap';

const SITE: SsrSiteConfig = {
    siteUrl: 'https://example.com',
    siteName: 'Jane Doe',
    ownerName: 'Jane Doe',
    ownerHeadline: 'Engineer',
    ownerDescription: '',
    availability: 'open',
    aiCrawlerPolicy: 'allow',
};

const PROFILE: Profile = {
    name: 'Jane Doe',
    headline: 'Staff Engineer @ Acme',
    location: 'Berlin, Germany',
    about: 'Builds &amp; ships platforms.',
    experience: [
        {
            title: 'Staff Engineer',
            company: 'Acme',
            startDate: 'Mar 2022',
            endDate: 'Present',
            location: 'Berlin',
            description: 'Led the platform team.',
        },
        { title: '', company: '', startDate: '', endDate: '' },
    ],
    education: [{ school: 'Example University', degree: 'M.Sc.', years: '2014 - 2016' }],
    skills: ['Go', 'Rust'],
    certifications: [
        { name: 'Cloud Pro', issuer: 'Example Institute', issueDate: 'Aug 2026', credentialUrl: 'https://v.example/1' },
        { name: 'Offline Cert', issuer: 'Org', date: '2020' },
    ],
    languages: [{ name: 'English', proficiency: 'native' }],
};

const POSTS: SitemapPost[] = [
    {
        slug: 'first',
        title: 'First post',
        lastmod: '2025-06-01',
        published: '2025-03-04T09:00:00Z',
        language: 'en',
        content: '<p>Hello &amp; welcome.</p>',
    },
    { slug: 'second', summary: 'Only a summary.' },
];

describe('buildLlmsFullTxt', () => {
    it('renders the whole profile and the posts as clean Markdown', () => {
        const md = buildLlmsFullTxt(SITE, PROFILE, POSTS);
        expect(md.startsWith('# Jane Doe\n\n> Staff Engineer @ Acme\n')).toBe(true);
        for (const fragment of [
            '- Location: Berlin, Germany',
            '- Availability: Actively looking for new opportunities.',
            '- Website: https://example.com/',
            '- Structured profile (JSON Resume): https://example.com/api/app/profile/resume.json',
            '## Summary\n\nBuilds & ships platforms.',
            '### Staff Engineer — Acme\n\nMar 2022 – Present · Berlin\n\nLed the platform team.',
            '### Role',
            '## Skills\n\nGo, Rust',
            '- [Cloud Pro — Example Institute — Aug 2026](https://v.example/1)',
            '- Offline Cert — Org — 2020',
            '## Education\n\n- Example University — M.Sc. — 2014 - 2016',
            '## Languages\n\n- English — native',
            '### First post\n\n2025-03-04 · en · https://example.com/blog/first\n\nHello & welcome.',
            '### second\n\nhttps://example.com/blog/second\n\nOnly a summary.',
            '- [All posts](https://example.com/blog): the complete index',
        ]) {
            expect(md).toContain(fragment);
        }
        expect(md).not.toContain('&amp;');
        expect(md).not.toContain('<p>');
    });

    it('omits every section its data does not support', () => {
        const md = buildLlmsFullTxt({ ...SITE, availability: '', ownerHeadline: '' }, null, []);
        expect(md).toBe(
            '# Jane Doe\n\n- Website: https://example.com/\n' +
                '- Structured profile (JSON Resume): https://example.com/api/app/profile/resume.json\n' +
                '- Contact: https://example.com/#contact\n',
        );
        expect(buildLlmsFullTxt({ ...SITE, ownerName: '', siteName: '' }, null, [])).toMatch(/^# Portfolio\n/);
        expect(buildLlmsFullTxt({ ...SITE, ownerName: '' }, null, [])).toMatch(/^# Jane Doe\n/);
    });

    it('bounds each excerpt and the whole file, naming overflow posts by link only', () => {
        const big = 'word '.repeat(2000);
        const many: SitemapPost[] = Array.from({ length: 20 }, (_, i) => ({ slug: `p${i}`, title: `P${i}`, content: big }));
        const md = buildLlmsFullTxt(SITE, PROFILE, many);
        const firstExcerpt = md.split('### P0\n\nhttps://example.com/blog/p0\n\n')[1].split('\n')[0];
        expect(firstExcerpt.length).toBeLessThanOrEqual(LLMS_FULL_EXCERPT);
        // 20 bounded excerpts fit; a profile that already fills the budget
        // leaves room for links only.
        expect(md).toContain('### P19');
        const huge = buildLlmsFullTxt(SITE, { ...PROFILE, about: 'word '.repeat(12_500) }, many);
        expect(huge).toContain('- [P19](https://example.com/blog/p19)');
        expect(huge).not.toContain('### P0');
    });
});

describe('llms.txt links the full file', () => {
    it('advertises /llms-full.txt in the Profile section', () => {
        expect(buildLlmsTxt(SITE, [])).toContain('(https://example.com/llms-full.txt)');
    });
});

describe('renderLlmsFullTxt', () => {
    const fetcher = (routes: Record<string, unknown>): JsonFetcher =>
        vi.fn(async (path: string) => {
            if (!(path in routes)) {
                throw new Error(`unexpected ${path}`);
            }
            return routes[path];
        });

    it('reads the config, the English profile and the newest posts', async () => {
        const md = await renderLlmsFullTxt(
            fetcher({
                '/api/app/config/site': { site_url: 'https://forked.example', owner_name: 'Jane Doe' },
                '/api/app/profile?lang=en': PROFILE,
                '/api/app/posts?published_only=true&page=1&page_size=20&sort_by=published_at&sort_order=desc': {
                    items: [{ slug: 'hello', title: 'Hello', created_at: '2026-01-02' }],
                },
            }),
            'http://localhost',
        );
        expect(md).toContain('## Summary');
        expect(md).toContain('https://forked.example/blog/hello');
    });

    it('still renders when the profile request fails or returns nothing', async () => {
        const md = await renderLlmsFullTxt(fetcher({ '/api/app/config/site': { owner_name: 'Jane Doe' } }), 'http://localhost');
        expect(md.startsWith('# Jane Doe')).toBe(true);
        expect(md).not.toContain('## Summary');
        const empty = await renderLlmsFullTxt(
            fetcher({ '/api/app/config/site': { owner_name: 'Jane Doe' }, '/api/app/profile?lang=en': null }),
            'http://localhost',
        );
        expect(empty.startsWith('# Jane Doe')).toBe(true);
    });
});
