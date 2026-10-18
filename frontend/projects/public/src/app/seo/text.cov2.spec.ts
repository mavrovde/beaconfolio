import { describe, it, expect } from 'vitest';
import {
    affix,
    fullPostTitle,
    indefiniteArticle,
    stripTags,
    toPlainText,
    trimTrailingSlashes,
    truncateAtWord,
} from './text';

/**
 * The CodeQL / Sonar findings on #494, pinned as behaviour.
 *
 * `stripTags` replaced a single `/<[^>]*>/g` pass (CodeQL
 * js/incomplete-multi-character-sanitization: `<scr<script>ipt>` came out of
 * it as a fresh `<script>`); the trailing-run helpers replaced end-anchored
 * regexes Sonar measured as super-linear (S8786).
 */
describe('stripTags', () => {
    it('leaves no tag opener behind for input built to reassemble one', () => {
        for (const input of [
            '<scr<script>ipt>alert(1)</script>',
            '<<script>script>alert(1)<</script>/script>',
            '<img src=x onerror=alert(1)//',
            'ok <script',
            '<<<b>b>i>x', // nested reassembly, three levels
            '<'.repeat(5) + '<b>' + 'img src=x>',
        ]) {
            expect(stripTags(input)).not.toMatch(/<[a-z/!?]/i);
        }
    });

    it('reads an unterminated opener as running to the end, like a browser tokenizer', () => {
        expect(stripTags('safe text <script alert(1)')).toBe('safe text ');
    });

    it('keeps a `<` that cannot open a tag', () => {
        expect(stripTags('a < b and 1 <3 you')).toBe('a < b and 1 <3 you');
        expect(stripTags('trailing <')).toBe('trailing <');
        expect(stripTags('a <<b> 1')).toBe('a < 1');
    });

    it('writes the boundary only for block ends, and not for a longer tag name', () => {
        expect(stripTags('<p>a</p><p>b</p>')).toBe('a b ');
        expect(stripTags('x<br/>y', '\n')).toBe('x\ny');
        expect(stripTags('x<bridge>y')).toBe('xy');
        expect(stripTags('<h2>T</h2>body')).toBe('T body');
    });

    it('drops comments and processing instructions whole', () => {
        expect(stripTags('a<!-- c -->b<?php x ?>c')).toBe('abc');
    });

    it('is linear on a pathological run of openers', () => {
        const input = '<a'.repeat(50_000);
        const started = performance.now();
        expect(stripTags(input)).toBe('');
        expect(performance.now() - started).toBeLessThan(1000);
    });
});

describe('toPlainText after the scan', () => {
    it('decodes an escaped tag into TEXT (consumers escape it on output)', () => {
        // `&lt;b&gt;` is text the author wrote; it is not markup until a sink
        // renders it unescaped, and every sink here escapes (Meta, JSON-LD
        // `<`, XML escape, text/plain + nosniff).
        expect(toPlainText('use &lt;b&gt; for bold')).toBe('use <b> for bold');
    });
});

describe('trailing-run helpers', () => {
    it('trims every trailing slash and only those', () => {
        expect(trimTrailingSlashes('https://site.example///')).toBe('https://site.example');
        expect(trimTrailingSlashes('https://site.example/a')).toBe('https://site.example/a');
        expect(trimTrailingSlashes('///')).toBe('');
        expect(trimTrailingSlashes('')).toBe('');
    });

    it('drops a mixed trailing run of separators and whitespace after a cut', () => {
        expect(truncateAtWord('alpha - , beta', 9)).toBe('alpha');
        expect(truncateAtWord('alpha — beta', 8)).toBe('alpha');
    });

    it('recovers a title whose ellipsis is followed or preceded by whitespace', () => {
        expect(fullPostTitle('Hello wor …  ', 'Hello wor ld. Rest')).toBe('Hello wor ld.');
        expect(fullPostTitle('Plain title  ', 'whatever')).toBe('Plain title');
    });
});

describe('sentence helpers', () => {
    it('affix adds the clause only for a value', () => {
        expect(affix(' at ', 'ACME')).toBe(' at ACME');
        expect(affix(' at ', '')).toBe('');
    });

    it('indefiniteArticle picks by the first letter', () => {
        expect(indefiniteArticle('Architect')).toBe('an');
        expect(indefiniteArticle('engineer')).toBe('an');
        expect(indefiniteArticle('Principal Engineer')).toBe('a');
    });
});
