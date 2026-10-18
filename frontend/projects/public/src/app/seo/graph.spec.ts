import { describe, it, expect } from 'vitest';
import { BlogPost } from '@beaconfolio/shared';
import { DEFAULT_SITE_CONFIG, SiteConfig } from '../services/site-config.service';
import { jsonForScriptBlock } from '../app.component';
import {
    absoluteUrl,
    buildBlogPosting,
    buildBreadcrumbs,
    buildProfilePage,
    buildWebSite,
    postPublishedAt,
    toGraph,
    websiteId,
} from './graph';

const SITE: SiteConfig = {
    ...DEFAULT_SITE_CONFIG,
    siteName: 'Jane Doe',
    siteUrl: 'https://example.com',
    ownerName: 'Jane Doe',
};
const NO_URL: SiteConfig = { ...SITE, siteUrl: '' };

const POST: BlogPost = {
    id: 1,
    title: 'Vector search in Postgres…',
    slug: 'vector-search',
    content: '<p>Vector search in Postgres with pgvector.</p><p>Second paragraph &amp; more.</p>',
    summary: '',
    image_url: '/api/app/posts/1/image',
    language: 'de',
    published: true,
    tags: ['pgvector', 'Postgres'],
    created_at: '2026-10-18T08:23:00Z',
    posted_at: '2025-03-04T09:00:00Z',
};

describe('toGraph', () => {
    it('wraps nodes in ONE context, drops their own @context and skips missing nodes', () => {
        expect(
            toGraph([{ '@context': 'https://schema.org', '@type': 'Thing', name: 'a' }, undefined]),
        ).toEqual({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Thing', name: 'a' }] });
    });

    it('survives the script-block serializer as valid JSON with no raw "<"', () => {
        const graph = toGraph([buildBlogPosting({ ...POST, title: '</script><b>x' }, SITE, '')]);
        const serialized = jsonForScriptBlock(graph);
        expect(serialized).not.toContain('<');
        expect(JSON.parse(serialized)).toEqual(graph);
    });
});

describe('buildWebSite / buildProfilePage', () => {
    it('links WebSite → Person and ProfilePage → Person by stable @id', () => {
        expect(buildWebSite(SITE, 'en')).toEqual({
            '@type': 'WebSite',
            '@id': 'https://example.com/#website',
            url: 'https://example.com/',
            name: 'Jane Doe',
            inLanguage: 'en',
            publisher: { '@id': 'https://example.com/#person' },
        });
        expect(buildProfilePage(SITE, { path: '/', name: 'T', lang: 'en', dateModified: '2026-09-10' })).toEqual({
            '@type': 'ProfilePage',
            '@id': 'https://example.com/#profilepage',
            url: 'https://example.com/',
            name: 'T',
            inLanguage: 'en',
            isPartOf: { '@id': 'https://example.com/#website' },
            mainEntity: { '@id': 'https://example.com/#person' },
            dateModified: '2026-09-10',
        });
    });

    it('falls back to the owner name and omits an unknown dateModified', () => {
        expect(buildWebSite({ ...SITE, siteName: '' }, 'de')?.['name']).toBe('Jane Doe');
        expect(buildProfilePage(SITE, { path: '/', name: 'T', lang: 'en', dateModified: null })).not.toHaveProperty(
            'dateModified',
        );
    });

    it('emits nothing without a site URL (an @id must be absolute)', () => {
        expect(buildWebSite(NO_URL, 'en')).toBeUndefined();
        expect(buildProfilePage(NO_URL, { path: '/', name: 'T', lang: 'en' })).toBeUndefined();
        expect(websiteId('https://example.com/')).toBe('https://example.com/#website');
    });
});

describe('buildBreadcrumbs', () => {
    it('numbers absolute items in order', () => {
        expect(buildBreadcrumbs(SITE, [{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog' }])).toEqual({
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' },
                { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://example.com/blog' },
            ],
        });
    });

    it('is undefined without a site URL or a trail', () => {
        expect(buildBreadcrumbs(NO_URL, [{ name: 'Home', path: '/' }])).toBeUndefined();
        expect(buildBreadcrumbs(SITE, [])).toBeUndefined();
    });
});

describe('postPublishedAt / absoluteUrl', () => {
    it('prefers posted_at and falls back to created_at', () => {
        expect(postPublishedAt(POST)).toBe('2025-03-04T09:00:00Z');
        expect(postPublishedAt({ ...POST, posted_at: undefined })).toBe('2026-10-18T08:23:00Z');
    });

    it.each([
        [SITE, '/x.png', 'https://example.com/x.png'],
        [SITE, 'x.png', 'https://example.com/x.png'],
        [SITE, 'https://cdn.example/x.png', 'https://cdn.example/x.png'],
        [NO_URL, '/x.png', ''],
        [NO_URL, 'http://cdn.example/x.png', 'http://cdn.example/x.png'],
        [SITE, '', ''],
        [SITE, undefined, ''],
        [SITE, null, ''],
    ])('resolves %#', (site, path, expected) => {
        expect(absoluteUrl(site, path)).toBe(expected);
    });
});

describe('buildBlogPosting', () => {
    it('dates the post by posted_at, references the Person and carries image/language/wordCount', () => {
        expect(buildBlogPosting(POST, SITE, 'https://example.com/assets/og-image.png')).toEqual({
            '@type': 'BlogPosting',
            '@id': 'https://example.com/blog/vector-search#article',
            headline: 'Vector search in Postgres with pgvector.',
            datePublished: '2025-03-04T09:00:00Z',
            dateModified: '2025-03-04T09:00:00Z',
            inLanguage: 'de',
            wordCount: 10,
            description: 'Vector search in Postgres with pgvector. Second paragraph & more.',
            author: {
                '@type': 'Person',
                '@id': 'https://example.com/#person',
                name: 'Jane Doe',
                url: 'https://example.com/',
            },
            publisher: {
                '@type': 'Person',
                '@id': 'https://example.com/#person',
                name: 'Jane Doe',
                url: 'https://example.com/',
            },
            image: 'https://example.com/api/app/posts/1/image',
            url: 'https://example.com/blog/vector-search',
            mainEntityOfPage: { '@type': 'WebPage', '@id': 'https://example.com/blog/vector-search' },
            isPartOf: { '@id': 'https://example.com/#website' },
            keywords: 'pgvector, Postgres',
        });
    });

    it('falls back to the share card, and degrades without a site URL or tags', () => {
        const node = buildBlogPosting(
            { ...POST, image_url: undefined, tags: [], posted_at: undefined, content: '', summary: 'Sum.' },
            NO_URL,
            '',
        );
        expect(node['image']).toBeUndefined();
        expect(node['@id']).toBeUndefined();
        expect(node['keywords']).toBeUndefined();
        expect(node['wordCount']).toBe(0);
        expect(node['datePublished']).toBe('2026-10-18T08:23:00Z');
        expect(node['author']).toEqual({ '@type': 'Person', name: 'Jane Doe' });
        expect(buildBlogPosting({ ...POST, image_url: undefined }, SITE, 'https://card.example/c.png')['image']).toBe(
            'https://card.example/c.png',
        );
    });
});
