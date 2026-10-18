import { describe, it, expect } from 'vitest';
import {
    decodeEntities,
    fullPostTitle,
    MAX_RECOVERED_TITLE,
    toMetaDescription,
    toPlainText,
    truncateAtWord,
} from './text';

describe('decodeEntities', () => {
    it('decodes the escaped LinkedIn text that double-escaped the live head', () => {
        // The measured live value: `about` stored as `Engineer &amp; Architect`,
        // which Meta serialized as `&amp;amp;`.
        expect(decodeEntities('Principal Software Engineer &amp; Architect')).toBe(
            'Principal Software Engineer & Architect',
        );
    });

    it('undoes a value escaped TWICE upstream', () => {
        expect(decodeEntities('AI &amp;amp; MCP')).toBe('AI & MCP');
    });

    it('decodes named, decimal and hex references', () => {
        expect(decodeEntities('&lt;b&gt; &quot;q&quot; &apos;a&#39; &#x2014; &nbsp;&hellip;&rsquo;')).toBe(
            // `&nbsp;` becomes a PLAIN space: this is text for snippets, and a
            // non-breaking space would survive the whitespace collapse.
            '<b> "q" \'a\' —  …’',
        );
    });

    it('leaves unknown names and out-of-range code points exactly as written', () => {
        expect(decodeEntities('&bogus; &#0; &#x110000;')).toBe('&bogus; &#0; &#x110000;');
    });

    it('leaves a bare ampersand alone', () => {
        expect(decodeEntities('R&D and Q & A')).toBe('R&D and Q & A');
    });
});

describe('toPlainText', () => {
    it('drops tags, turns block ends into spaces and collapses whitespace', () => {
        expect(toPlainText('<p>One&amp;two</p><p>three<br>four</p>\n\n  five')).toBe('One&two three four five');
    });

    it('is empty for null/undefined', () => {
        expect(toPlainText(null)).toBe('');
        expect(toPlainText(undefined)).toBe('');
    });
});

describe('truncateAtWord', () => {
    it('returns short text unchanged', () => {
        expect(truncateAtWord('  short  ', 10)).toBe('short');
    });

    it('cuts at the last word boundary and never appends an ellipsis', () => {
        const cut = truncateAtWord('alpha beta gamma delta', 15);
        expect(cut).toBe('alpha beta');
        expect(cut).not.toMatch(/…|\.\.\.$/);
    });

    it('keeps a word that ends exactly at the limit', () => {
        expect(truncateAtWord('alpha beta gamma', 10)).toBe('alpha beta');
    });

    it('drops a dangling separator left by the cut', () => {
        expect(truncateAtWord('alpha, beta | gamma', 13)).toBe('alpha, beta');
        expect(truncateAtWord('Engineer & Architect', 10)).toBe('Engineer');
    });

    it('hard-cuts a single word longer than the limit', () => {
        expect(truncateAtWord('x'.repeat(20), 5)).toBe('xxxxx');
    });
});

describe('toMetaDescription', () => {
    it('returns short plain text as-is', () => {
        expect(toMetaDescription('<b>Hi</b> &amp; welcome.')).toBe('Hi & welcome.');
    });

    it('prefers a complete sentence when one ends late enough in the window', () => {
        const first = 'A'.repeat(110) + '.';
        const text = `${first} ${'b'.repeat(30)} ${'c'.repeat(30)}`;
        expect(toMetaDescription(text)).toBe(first);
    });

    it('falls back to a word boundary when the only sentence end is too early', () => {
        const text = `Short. ${'word '.repeat(60)}`;
        const result = toMetaDescription(text);
        expect(result.length).toBeLessThanOrEqual(155);
        expect(result.startsWith('Short. word')).toBe(true);
        expect(result.endsWith('word')).toBe(true);
    });

    it('honours a custom bound', () => {
        expect(toMetaDescription('one two three four', 9)).toBe('one two');
    });

    it('is empty for empty input', () => {
        expect(toMetaDescription(undefined)).toBe('');
    });
});

describe('fullPostTitle', () => {
    it('recovers the real headline from the content when the stored title was cut with …', () => {
        // Measured on the live API: title "…in the AI…", content starts with the full line.
        expect(
            fullPostTitle(
                'Are Heavy Frameworks Still the Default Choice in the AI…',
                'Are Heavy Frameworks Still the Default Choice in the AI Era? ☕\n\nFor two decades…',
            ),
        ).toBe('Are Heavy Frameworks Still the Default Choice in the AI Era?');
    });

    it('stops at the first sentence end of a one-paragraph post', () => {
        expect(
            fullPostTitle(
                'The kind of impression you get from Google courses on…',
                'The kind of impression you get from Google courses on Coursera… if you know what I mean. More text.',
            ),
        ).toBe('The kind of impression you get from Google courses on Coursera… if you know what I mean.');
    });

    it('recovers through HTML content and a three-dot cut', () => {
        expect(fullPostTitle('Hello wor...', '<p>Hello world &amp; friends</p><p>Body</p>')).toBe(
            'Hello world & friends',
        );
    });

    it('drops the dangling ellipsis when the content does not start with the title', () => {
        expect(fullPostTitle('Something cut…', 'Entirely different body.')).toBe('Something cut');
        expect(fullPostTitle('Something cut…', undefined)).toBe('Something cut');
    });

    it('bounds a recovered headline with no sentence end at a word boundary', () => {
        const long = `Start ${'word '.repeat(60)}`;
        const recovered = fullPostTitle('Start…', long);
        expect(recovered.length).toBeLessThanOrEqual(MAX_RECOVERED_TITLE);
        expect(recovered.startsWith('Start word')).toBe(true);
    });

    it('returns a title without an ellipsis unchanged (decoded)', () => {
        expect(fullPostTitle('R&amp;D notes', 'R&D notes and more')).toBe('R&D notes');
    });

    it('returns an empty string for a title that is only an ellipsis', () => {
        expect(fullPostTitle('…', 'Anything')).toBe('');
    });
});
