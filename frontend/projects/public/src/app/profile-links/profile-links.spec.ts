import { describe, it, expect } from 'vitest';
import { DEFAULT_ICON, toProfileLinks } from './profile-links';

describe('toProfileLinks (#93)', () => {
    it('labels and marks the three named code hosts', () => {
        const links = toProfileLinks([
            'https://github.com/janedoe',
            'https://gitlab.com/janedoe',
            'https://bitbucket.org/janedoe',
        ]);
        expect(links.map((l) => l.platform)).toEqual(['GITHUB', 'GITLAB', 'BITBUCKET']);
        expect(links.every((l) => l.icon !== DEFAULT_ICON)).toBe(true);
    });

    // THE acceptance criterion: a new platform must cost a config entry and
    // nothing else. This case is the one that fails if anyone ever "tightens"
    // the registry into an allowlist.
    it('renders an unregistered host instead of dropping it', () => {
        const links = toProfileLinks(['https://codeberg.org/janedoe']);
        expect(links).toEqual([
            { platform: 'CODEBERG', url: 'https://codeberg.org/janedoe', icon: '⌇' },
        ]);

        const novel = toProfileLinks(['https://git.example.com/janedoe']);
        expect(novel).toEqual([
            { platform: 'EXAMPLE', url: 'https://git.example.com/janedoe', icon: DEFAULT_ICON },
        ]);
    });

    it('derives a readable label through a two-part public suffix', () => {
        expect(toProfileLinks(['https://git.example.co.uk/j'])[0].platform).toEqual('EXAMPLE');
    });

    // Both SourceHut hostnames are curated, not just the profile one: a
    // configured `git.sr.ht` link must not fall through to the derived label.
    it.each(['https://sr.ht/~janedoe', 'https://git.sr.ht/~janedoe'])(
        'labels %s as the curated SourceHut host',
        (url) => {
            expect(toProfileLinks([url])[0].platform).toEqual('SOURCEHUT');
        }
    );

    // Review finding 3. The first implementation dropped two labels whenever
    // the second-to-last one was <= 3 characters, which reads an ordinary
    // subdomain as a public suffix. Each of these came back with the SUBDOMAIN
    // as the label; the registrable name is what the row is supposed to say.
    it.each([
        ['https://code.bbc.com/j', 'BBC'],
        ['https://git.abc.com/j', 'ABC'],
        ['https://git.zz.ht/~j', 'ZZ'],
    ])('labels %s with its registrable name, not its subdomain', (url, expected) => {
        expect(toProfileLinks([url])[0].platform).toEqual(expected);
    });

    // The other half of the same rule: a two-character LAST label alone is not
    // enough to drop two — `zz.ht` above ends in a ccTLD too.
    it('still drops a genuine ccTLD second level', () => {
        expect(toProfileLinks(['https://git.example.ac.uk/j'])[0].platform).toEqual('EXAMPLE');
    });

    it('ignores a leading www. when matching the registry', () => {
        expect(toProfileLinks(['https://www.github.com/janedoe'])[0].platform).toEqual('GITHUB');
    });

    it('returns nothing for an empty, absent or all-blank list', () => {
        expect(toProfileLinks([])).toEqual([]);
        expect(toProfileLinks(undefined)).toEqual([]);
        expect(toProfileLinks(['', '   '])).toEqual([]);
    });

    // The value is owner-controlled config, but it lands in an [href]. A
    // `javascript:` URL there is the oldest XSS there is, so the parser drops
    // it rather than relying on Angular's sanitizer alone.
    it('drops anything that is not an absolute http(s) URL', () => {
        expect(
            toProfileLinks([
                'javascript:alert(1)',
                'data:text/html,<script>alert(1)</script>',
                'ftp://example.com/x',
                'github.com/janedoe',
                'not a url at all',
            ])
        ).toEqual([]);
    });

    it('keeps the good entries when a bad one sits between them', () => {
        const links = toProfileLinks([
            'https://github.com/janedoe',
            'not a url',
            'https://gitlab.com/janedoe',
        ]);
        expect(links.map((l) => l.platform)).toEqual(['GITHUB', 'GITLAB']);
    });

    // Review finding 2: this case SURVIVES deleting the `raw.trim()` inside
    // `new URL(...)`, because the WHATWG parser strips leading and trailing
    // whitespace itself and the backend already `.strip()`s at
    // `site_config.py:57`. It is kept as a contract on the OUTPUT — a padded
    // env entry must not reach an href with spaces in it — and deliberately
    // not claimed as coverage of that `.trim()`, which is redundancy.
    it('trims surrounding whitespace, which a comma-separated env var leaves behind', () => {
        expect(toProfileLinks(['  https://github.com/janedoe  '])[0].url).toEqual(
            'https://github.com/janedoe'
        );
    });

    // The `typeof` guard, pinned by an input that actually REACHES it. The
    // first attempt used `{ toString: () => '<url>' }` and passed without the
    // guard too — round 2 measured it: that object has no `.trim`, so
    // `raw.trim()` throws INSIDE the try and the catch drops it before the
    // parser is involved. A test that green-lights for an unrelated reason is
    // worse than no test. A boxed `String` has a working `trim()`, so it walks
    // straight past the catch and the parser accepts it: delete the guard and
    // this renders a live GITHUB row.
    it('drops a non-string member that survives .trim() and parses', () => {
        const boxed = new String('https://github.com/janedoe') as unknown as string;
        expect(toProfileLinks([boxed])).toEqual([]);
    });

    // An output contract, stated as one: a blank entry never renders a row.
    // It does NOT pin any particular guard — it was written to pin a
    // `!raw.trim()` check and survived deleting it, because `new URL('   ')`
    // throws and the catch drops the entry regardless. That measurement is why
    // the check is gone; this case is what still has to hold without it.
    it('drops an entry that is nothing but whitespace', () => {
        expect(toProfileLinks(['   ', 'https://github.com/janedoe'])).toHaveLength(1);
    });

    // The template tracks `@for` by `link.url`. A duplicate key there is a
    // reconciliation bug, not merely a repeated row — and a comma-separated env
    // var makes a copy-paste duplicate an ordinary operator slip.
    it('collapses a repeated URL, including one that only differs by whitespace', () => {
        const links = toProfileLinks([
            'https://github.com/janedoe',
            '  https://github.com/janedoe  ',
            'https://gitlab.com/janedoe',
        ]);
        expect(links.map((l) => l.url)).toEqual([
            'https://github.com/janedoe',
            'https://gitlab.com/janedoe',
        ]);
    });

    it('handles a single-label host without throwing', () => {
        expect(toProfileLinks(['http://localhost/janedoe'])[0].platform).toEqual('LOCALHOST');
    });
});
