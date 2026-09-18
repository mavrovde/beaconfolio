import { describe, it, expect } from 'vitest';

import { buildProjectSchema, buildProjectUrl, buildTemporalCoverage } from './project-schema';
import { RenderableProject } from '../projects-model/projects';
import { SiteConfig } from '../services/site-config.service';

const SITE: SiteConfig = {
    siteName: 'Jane Doe',
    siteUrl: 'https://example.com',
    ownerName: 'Jane Doe',
    ownerHeadline: 'Engineer',
    ownerDescription: '',
    socialLinks: [],
    analyticsId: '',
    gtmContainerId: '',
    availability: 'open',
    aiCrawlerPolicy: 'allow',
};

function project(overrides: Partial<RenderableProject> = {}): RenderableProject {
    return {
        title: 'Beaconfolio',
        slug: 'beaconfolio',
        techStack: [],
        links: {},
        ...overrides,
    };
}

describe('buildProjectUrl', () => {
    it('joins the configured site URL with the project route', () => {
        expect(buildProjectUrl('https://example.com', 'beaconfolio')).toEqual(
            'https://example.com/projects/beaconfolio',
        );
    });

    // The config default is an EMPTY string, not a missing key, so this is the
    // out-of-the-box path for a forker who has not set `siteUrl` yet — the node
    // must then claim no URL rather than claim `/projects/x` as an absolute one.
    it.each([
        ['an empty site URL', ''],
        ['whitespace', '   '],
        ['an absent site URL', undefined],
    ])('omits the url for %s', (_label, siteUrl) => {
        expect(buildProjectUrl(siteUrl, 'beaconfolio')).toBeUndefined();
    });

    it('does not double the slash on a site URL with a trailing one', () => {
        expect(buildProjectUrl('https://example.com//', 'x')).toEqual(
            'https://example.com/projects/x',
        );
    });
});

describe('buildTemporalCoverage', () => {
    it('writes a closed interval from two ISO dates', () => {
        expect(buildTemporalCoverage('2024-01', '2025-03')).toEqual('2024-01/2025-03');
    });

    // The open-ended form. The profile's own word for this is "present" (en) or
    // "Heute" (de) — neither is a date, and emitting either would be invalid.
    it.each([
        ['an ongoing project', 'present'],
        ['a German profile', 'Heute'],
        ['no end date at all', undefined],
    ])('writes an open interval for %s', (_label, end) => {
        expect(buildTemporalCoverage('2024', end)).toEqual('2024/..');
    });

    // A start date is what anchors the interval; without a parseable one there
    // is nothing to write, and `../2025` would assert a beginning-of-time start.
    it.each([
        ['free text', 'summer 2024'],
        ['empty', ''],
        ['absent', undefined],
    ])('claims no coverage when the start date is %s', (_label, start) => {
        expect(buildTemporalCoverage(start, '2025')).toBeUndefined();
    });
});

describe('buildProjectSchema', () => {
    it('types a project with a repository as SoftwareSourceCode', () => {
        const schema = buildProjectSchema(
            project({
                summary: 'A portfolio template',
                techStack: ['Angular', 'FastAPI'],
                links: { source: 'https://github.com/janedoe/b' },
                image: 'assets/shot.png',
                startDate: '2025',
                endDate: 'present',
            }),
            SITE,
            'Jane Doe',
        );
        expect(schema).toEqual({
            '@context': 'https://schema.org',
            '@type': 'SoftwareSourceCode',
            name: 'Beaconfolio',
            url: 'https://example.com/projects/beaconfolio',
            description: 'A portfolio template',
            image: 'assets/shot.png',
            keywords: ['Angular', 'FastAPI'],
            programmingLanguage: ['Angular', 'FastAPI'],
            codeRepository: 'https://github.com/janedoe/b',
            author: { '@type': 'Person', name: 'Jane Doe' },
            temporalCoverage: '2025/..',
        });
    });

    // A design case study or a talk has no repository. `codeRepository` and
    // `programmingLanguage` are SoftwareSourceCode properties, so a CreativeWork
    // must carry neither — and it names its maker `creator`, not `author`.
    it('types a project without a repository as CreativeWork', () => {
        const schema = buildProjectSchema(
            project({ summary: 'A case study', techStack: ['Figma'] }),
            SITE,
            'Jane Doe',
        );
        expect(schema['@type']).toEqual('CreativeWork');
        expect(schema.keywords).toEqual(['Figma']);
        expect(schema.programmingLanguage).toBeUndefined();
        expect(schema.codeRepository).toBeUndefined();
        expect(schema.creator).toEqual({ '@type': 'Person', name: 'Jane Doe' });
        expect(schema.author).toBeUndefined();
    });

    it('prefers the long description over the summary', () => {
        const schema = buildProjectSchema(
            project({ summary: 'short', description: 'the long form' }),
            SITE,
        );
        expect(schema.description).toEqual('the long form');
    });

    // `"image": null` fails schema.org validation; an absent property claims
    // nothing. So the sparse project must produce a node of exactly two keys
    // beyond the context and type.
    it('omits every property a sparse project cannot support', () => {
        const schema = buildProjectSchema(project(), { ...SITE, siteUrl: '' });
        expect(schema).toEqual({
            '@context': 'https://schema.org',
            '@type': 'CreativeWork',
            name: 'Beaconfolio',
        });
    });

    it.each([
        ['an absent author', undefined],
        ['a blank author', '   '],
    ])('names no person for %s', (_label, authorName) => {
        const schema = buildProjectSchema(
            project({ links: { source: 'https://github.com/janedoe/b' } }),
            SITE,
            authorName,
        );
        expect(schema.author).toBeUndefined();
        expect(schema.creator).toBeUndefined();
    });
});
