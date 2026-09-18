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

    it('trims surrounding whitespace, which a comma-separated env var leaves behind', () => {
        expect(toProfileLinks(['  https://github.com/janedoe  '])[0].url).toEqual(
            'https://github.com/janedoe'
        );
    });

    it('handles a single-label host without throwing', () => {
        expect(toProfileLinks(['http://localhost/janedoe'])[0].platform).toEqual('LOCALHOST');
    });
});
