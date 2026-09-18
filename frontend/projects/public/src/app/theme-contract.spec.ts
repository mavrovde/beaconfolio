import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The theme token contract (#339), asserted against the STYLESHEET SOURCE.
 *
 * This exists because the browser check it replaces could not fail. The E2E
 * spec read every contract token off `document.documentElement` and asserted
 * none resolved to `''` — but every token has a `:root`/`@theme` declaration,
 * so any element inherits one no matter which `[data-theme]` is stamped.
 * Measured by the reviewer: `data-theme="neon-vaporwave"` reported 0 missing
 * tokens, and so did removing the attribute entirely. A partial preset is
 * exactly the failure AC5 forbids, and nothing was watching for it.
 *
 * The real statement is about the SOURCE: a non-terminal preset must declare
 * every token in its OWN block, because a token it omits silently inherits
 * `terminal`'s — a CRT scanline over a white page. `terminal` is the base and
 * is deliberately spread across `@theme` + `:root` + its own block, so it is
 * checked as a union rather than per block.
 *
 * Reading the file rather than the compiled bundle is the point: this must go
 * red in the unit tier, on every push, without a stack.
 */

/**
 * The ONE stylesheet both apps import (#67). It used to live in this app's own
 * `src/styles.css`; that file is now two `@import` lines, and the admin app
 * imports the same shared file, so this contract covers BOTH apps rather than
 * only the one whose directory it sits in.
 */
const STYLES = readFileSync(
    join(__dirname, '..', '..', '..', 'shared', 'src', 'styles', 'theme.css'),
    'utf-8',
);

const PRESETS = ['terminal', 'dark', 'light', 'modern', 'classic'] as const;

/**
 * Tokens a theme must supply. Derived from the base rather than hand-listed:
 * a hand-kept copy is how the E2E list came to say 23 while the stylesheet
 * said 22. Anything `@theme` or `:root` declares is part of the contract by
 * construction, so adding a token to the base automatically obliges every
 * preset to declare it — and this file is where that obligation is enforced.
 */
function declarationsIn(selector: string): Set<string> {
    const start = STYLES.indexOf(`${selector} {`);
    if (start === -1) {
        throw new Error(`stylesheet has no \`${selector}\` block`);
    }
    const end = STYLES.indexOf('\n}', start);
    const body = STYLES.slice(start, end);
    return new Set([...body.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));
}

const BASE_TOKENS = new Set<string>([
    ...declarationsIn('@theme'),
    ...declarationsIn(':root'),
]);

describe('theme token contract', () => {
    it('the base declares a non-trivial token set', () => {
        // A guard on the guard: if `declarationsIn` ever stopped matching, an
        // empty BASE_TOKENS would make every check below pass vacuously —
        // which is the precise defect this file was written to remove.
        expect(BASE_TOKENS.size).toBeGreaterThan(20);
        for (const token of ['--color-primary', '--color-black', '--fx-panel-bg']) {
            expect(BASE_TOKENS.has(token), token).toBe(true);
        }
    });

    it.each(PRESETS.filter((p) => p !== 'terminal'))(
        'preset "%s" declares every contract token in its own block',
        (preset) => {
            const declared = declarationsIn(`[data-theme='${preset}']`);
            const missing = [...BASE_TOKENS].filter((t) => !declared.has(t)).sort();
            expect(missing, `"${preset}" inherits these from terminal`).toEqual([]);
        },
    );

    it('terminal is covered by the base it is spelled out against', () => {
        const declared = new Set([
            ...BASE_TOKENS,
            ...declarationsIn(`[data-theme='terminal']`),
        ]);
        expect([...BASE_TOKENS].filter((t) => !declared.has(t))).toEqual([]);
    });

    // The vocabulary and the stylesheet are two copies of one list; the
    // backend pins its own copy against this file, and this pins the blocks.
    it('every preset in the vocabulary has a block', () => {
        for (const preset of PRESETS) {
            expect(STYLES.includes(`[data-theme='${preset}'] {`), preset).toBe(true);
        }
    });

    // Component stylesheets are UNLAYERED in Angular, so a colour literal in
    // one beats every themed utility. The two files that paint their own
    // chrome are the two the review found unreadable on three presets.
    it.each([
        ['components/llm/llm.component.css'],
        ['components/cv/cv.component.css'],
    ])('%s paints from tokens, not from colour literals', (relative) => {
        // Comments first, then split on `;` — NOT on newlines. A line-oriented
        // version of this check passed a literal appended as
        // `.mutant { color: #ff00ff; }`, because that line begins with a
        // selector and the declaration filter dropped it. Splitting on the
        // separator CSS actually uses has no such blind spot.
        const css = readFileSync(join(__dirname, relative), 'utf-8').replace(
            /\/\*[\s\S]*?\*\//g,
            '',
        );
        const literals = css
            .split(';')
            .map((part) => part.trim())
            // A drop shadow falls on whatever is behind it rather than painting
            // a themed surface, so its literal is not a theming defect.
            .filter((part) => !/box-shadow|text-shadow/.test(part))
            .filter((part) => /#[0-9a-f]{3,8}\b|\brgba?\(|:\s*(white|black)\b/i.test(part))
            .map((part) => part.replace(/\s+/g, ' '));
        expect(literals, `${relative} still carries colour literals`).toEqual([]);
    });
});

/**
 * Per-preset typography (#67 — the residual #339 deferred here).
 *
 * #339 pointed `body` at each preset's `--font-sans`, but 59 `font-mono`
 * utilities across 13 public templates kept their own elements on the
 * monospace face, so `classic` rendered a serif body around monospace
 * headings, prose, buttons and form fields. Those utilities never meant
 * "this is code" — they meant "the site's face", back when the site had
 * exactly one. They now say `font-sans`.
 *
 * The whole safety argument for that sweep is ONE property: under `terminal`
 * the two families are the same stack, so the swap is a no-op on the default
 * preset. If that ever stops being true, `terminal` silently changes
 * appearance and this file is the only thing that would say so.
 */
describe('per-preset typography (#67)', () => {
    const familiesOf = (block: string) => ({
        sans: /--font-sans:\s*([^;]+);/.exec(block)?.[1]?.trim(),
        mono: /--font-mono:\s*([^;]+);/.exec(block)?.[1]?.trim(),
    });

    const blockFor = (preset: string) => {
        const match = new RegExp(`\\[data-theme='${preset}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(
            STYLES,
        );
        expect(match, `no [data-theme='${preset}'] block`).toBeTruthy();
        return match![1];
    };

    it('terminal declares ONE family under both names, so the sweep is a no-op there', () => {
        const { sans, mono } = familiesOf(blockFor('terminal'));

        expect(sans).toBeTruthy();
        expect(mono).toBeTruthy();
        expect(sans).toBe(mono);
    });

    // The other half: if every preset paired the same two families, swapping
    // the utilities would have changed nothing anywhere and this whole sweep
    // would be decoration. `classic` is the sharpest case — a serif body.
    it('classic declares a DIFFERENT body family from its code family', () => {
        const { sans, mono } = familiesOf(blockFor('classic'));

        expect(sans).toMatch(/serif/);
        expect(sans).not.toBe(mono);
    });

    // The sweep itself, asserted where it can actually regress: a template
    // that regains `font-mono` pins its own elements to the code face on every
    // document preset again. `llm.component.html` is the deliberate exception
    // — an AI transcript IS terminal output, and it keeps the monospace face
    // under every preset.
    it('no public template pins the code face except the LLM transcript', () => {
        const root = join(__dirname, 'components');
        const offenders = readdirSync(root, { recursive: true, encoding: 'utf-8' })
            .filter((relative) => relative.endsWith('.html'))
            .filter((relative) => !relative.includes('llm'))
            .filter((relative) => readFileSync(join(root, relative), 'utf-8').includes('font-mono'))
            .sort();

        expect(offenders, 'these templates pin monospace on every preset').toEqual([]);
    });

    it('and the LLM transcript still does', () => {
        const llm = readFileSync(join(__dirname, 'components/llm/llm.component.html'), 'utf-8');

        expect(llm).toContain('terminal-container font-mono');
        expect(llm).toContain('multi-agent-container font-mono');
    });
});
