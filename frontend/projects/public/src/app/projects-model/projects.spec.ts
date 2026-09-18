import { describe, it, expect } from 'vitest';
import {
    Project,
    findProject,
    formatPeriod,
    safeHttpUrl,
    slugify,
    toRenderableProjects,
} from './projects';

describe('slugify', () => {
    it.each([
        ['Beaconfolio', 'beaconfolio'],
        ['A Portfolio Site', 'a-portfolio-site'],
        ['Böse Ümlaute', 'bose-umlaute'],
        ['  spaced  out  ', 'spaced-out'],
        ['C++ / Rust!', 'c-rust'],
        ['...', ''],
    ])('slugifies %s to %s', (input, expected) => {
        expect(slugify(input)).toEqual(expected);
    });
});

describe('safeHttpUrl', () => {
    it('keeps absolute http and https URLs', () => {
        expect(safeHttpUrl('https://github.com/janedoe/x')).toEqual('https://github.com/janedoe/x');
        expect(safeHttpUrl('http://example.com/')).toEqual('http://example.com/');
    });

    // The reason this function exists. An uploaded profile JSON is weaker input
    // than site config — anyone with admin upload can author it — and every one
    // of these lands in an [href] if it is not dropped here.
    it.each(['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:msgbox', 'not a url', ''])(
        'drops %s',
        (bad) => {
            expect(safeHttpUrl(bad)).toBeUndefined();
        }
    );

    it('drops a non-string without throwing', () => {
        expect(safeHttpUrl(42 as unknown as string)).toBeUndefined();
        expect(safeHttpUrl(undefined)).toBeUndefined();
    });
});

describe('toRenderableProjects', () => {
    it('returns nothing for an absent or empty list', () => {
        expect(toRenderableProjects(undefined)).toEqual([]);
        expect(toRenderableProjects([])).toEqual([]);
    });

    it('projects a full entry and derives its slug from the title', () => {
        const [p] = toRenderableProjects([
            {
                title: 'Beaconfolio',
                summary: 'A portfolio',
                techStack: ['Angular', 'FastAPI'],
                links: { source: 'https://github.com/janedoe/b', demo: 'https://example.com' },
                role: 'Author',
                startDate: '2025',
                endDate: '2026',
            },
        ]);
        expect(p.slug).toEqual('beaconfolio');
        expect(p.techStack).toEqual(['Angular', 'FastAPI']);
        expect(p.links.source).toEqual('https://github.com/janedoe/b');
        expect(p.links.demo).toEqual('https://example.com/');
    });

    it('honours an author-supplied slug, slugified', () => {
        const [p] = toRenderableProjects([{ title: 'Anything', slug: 'My Custom Slug' }]);
        expect(p.slug).toEqual('my-custom-slug');
    });

    // Two projects called "Portfolio" is an ordinary thing for a person to
    // have. The list tracks @for by slug and the detail route resolves BY slug,
    // so a collision is a reconciliation fault AND a wrong detail page.
    it('makes duplicate slugs unique', () => {
        const slugs = toRenderableProjects([
            { title: 'Portfolio' },
            { title: 'Portfolio' },
            { title: 'Portfolio' },
        ]).map((p) => p.slug);
        expect(slugs).toEqual(['portfolio', 'portfolio-2', 'portfolio-3']);
        expect(new Set(slugs).size).toEqual(3);
    });

    it('gives a positional slug to a title that slugifies to nothing', () => {
        const slugs = toRenderableProjects([{ title: '***' }, { title: '///' }]).map((p) => p.slug);
        expect(slugs).toEqual(['project-1', 'project-2']);
        expect(new Set(slugs).size).toEqual(2);
    });

    it.each([
        ['an empty title', { title: '   ' }],
        ['a missing title', {} as Project],
        ['a non-string title', { title: 7 } as unknown as Project],
        ['a null entry', null as unknown as Project],
    ])('drops an entry with %s', (_label, entry) => {
        expect(toRenderableProjects([entry as Project])).toEqual([]);
    });

    it('keeps the good entries when a bad one sits between them', () => {
        const titles = toRenderableProjects([
            { title: 'First' },
            { title: '' },
            { title: 'Second' },
        ]).map((p) => p.title);
        expect(titles).toEqual(['First', 'Second']);
    });

    it('drops an unsafe link but keeps the project itself', () => {
        const [p] = toRenderableProjects([
            {
                title: 'Risky',
                links: { source: 'javascript:alert(1)', demo: 'https://ok.example/' },
            },
        ]);
        expect(p.title).toEqual('Risky');
        expect(p.links.source).toBeUndefined();
        expect(p.links.demo).toEqual('https://ok.example/');
    });

    it('drops non-string tech-stack members and blank tags', () => {
        const [p] = toRenderableProjects([
            { title: 'T', techStack: ['Angular', '', 3, '  '] as unknown as string[] },
        ]);
        expect(p.techStack).toEqual(['Angular']);
    });

    it('defaults an absent tech stack to an empty array', () => {
        expect(toRenderableProjects([{ title: 'T' }])[0].techStack).toEqual([]);
    });

    // A bundled demo asset is referenced by relative path and has no scheme, so
    // it cannot go through the absolute-URL gate; a scheme-bearing image must.
    it('keeps a relative image path and vets an absolute one', () => {
        expect(toRenderableProjects([{ title: 'A', image: 'assets/p.png' }])[0].image).toEqual(
            'assets/p.png'
        );
        expect(
            toRenderableProjects([{ title: 'B', image: 'https://cdn.example/p.png' }])[0].image
        ).toEqual('https://cdn.example/p.png');
        expect(
            toRenderableProjects([{ title: 'C', image: 'javascript:alert(1)' }])[0].image
        ).toBeUndefined();
    });
});

describe('findProject', () => {
    const projects: Project[] = [{ title: 'First' }, { title: 'Second' }];

    it('finds by slug', () => {
        expect(findProject(projects, 'second')?.title).toEqual('Second');
    });

    it('returns undefined for an unknown slug or an absent list', () => {
        expect(findProject(projects, 'nope')).toBeUndefined();
        expect(findProject(undefined, 'first')).toBeUndefined();
    });

    // The de-duplication must be visible through this lookup too, or the
    // detail route would serve the first match for both.
    it('resolves a de-duplicated slug to the right project', () => {
        const dupes: Project[] = [
            { title: 'Portfolio', role: 'one' },
            { title: 'Portfolio', role: 'two' },
        ];
        expect(findProject(dupes, 'portfolio')?.role).toEqual('one');
        expect(findProject(dupes, 'portfolio-2')?.role).toEqual('two');
    });
});

describe('formatPeriod', () => {
    it.each([
        [{ title: 'x', startDate: '2024', endDate: '2025' }, '2024 — 2025'],
        [{ title: 'x', startDate: '2024' }, '2024'],
        [{ title: 'x', endDate: '2025' }, '2025'],
    ])('formats %o as %s', (project, expected) => {
        expect(formatPeriod(project as Project)).toEqual(expected);
    });

    // undefined, not '' — the template hides the element rather than rendering
    // an empty one.
    it('returns undefined when neither date is present or both are blank', () => {
        expect(formatPeriod({ title: 'x' })).toBeUndefined();
        expect(formatPeriod({ title: 'x', startDate: '  ', endDate: '  ' })).toBeUndefined();
    });

    // The positional fallback can itself collide: an explicit title of
    // "Project 2" takes `project-2`, and a punctuation-only title arriving
    // second computes the same `project-${out.length + 1}`. The dedup loop then
    // re-enters with an EMPTY base, which is why it carries its own
    // `|| 'project'` — without it the suffix would be appended to nothing and
    // the loop would keep proposing "-2", "-3" forever.
    it('resolves a collision between an explicit slug and the positional fallback', () => {
        const out = toRenderableProjects([{ title: 'Project 2' }, { title: '!!!' }]);
        expect(out.map((p) => p.slug)).toEqual(['project-2', 'project-3']);
    });
});
