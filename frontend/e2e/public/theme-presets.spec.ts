import { test, expect } from '@playwright/test';

/**
 * Theme presets (#339) — the layer jsdom cannot reach.
 *
 * Three of this issue's criteria are only answerable in a real browser:
 * AC1 (switching in admin changes the public site within one reload), AC3 (SSR
 * delivers the theme in the INITIAL HTML, no client-side flash) and AC5 (every
 * preset supplies the COMPLETE token set — "verified per component in a real
 * browser, not jsdom"). A Vitest spec renders the component tree but never
 * applies `styles.css`, so it can prove the attribute is stamped and nothing
 * about what the page is actually painted with. That is the whole gap here.
 *
 * Runs against the composed stack; the backend serves the real /config/site.
 */

/** Every token the stylesheet's documented contract obliges a preset to supply. */
const CONTRACT_TOKENS = [
    '--color-primary',
    '--color-secondary',
    '--color-background',
    '--color-surface',
    '--color-muted',
    '--color-black',
    '--color-white',
    '--color-terminal-bg',
    '--color-terminal-dim',
    '--color-terminal-highlight',
    '--fx-text-shadow',
    '--fx-scanlines',
    '--fx-scanline-size',
    '--fx-scanline-animation',
    '--fx-vignette',
    '--fx-vignette-shadow',
    '--fx-media-filter',
    '--fx-media-blend',
    '--fx-panel-border',
    '--fx-panel-shadow',
    '--fx-panel-bg',
    '--fx-active-shadow',
    '--fx-active-text-shadow',
];

const PRESETS = ['terminal', 'dark', 'light', 'modern', 'classic'] as const;

test.describe('Theme presets', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('cookie_consent', 'true');
        });
    });

    /**
     * Same shape as `availability-cta.spec.ts`: the API rides the SAME origin
     * the browser uses, because CI's E2E stack publishes only the proxy, and
     * Playwright's request helpers THROW on a refused connection rather than
     * returning !ok — so the reachability probe has to catch.
     */
    async function login(request: import('@playwright/test').APIRequestContext, backend: string) {
        let res;
        try {
            res = await request.post(`${backend}/api/app/auth/login`, {
                form: { username: 'admin', password: 'admin123' },
            });
        } catch {
            return null;
        }
        return res.ok() ? ((await res.json()).access_token as string) : null;
    }

    test('AC3 — the INITIAL HTML carries the theme, before any JavaScript runs', async ({
        request,
        baseURL,
    }) => {
        // Deliberately NOT page.goto: this asserts the server's bytes. Reading
        // the attribute off a hydrated DOM would pass even if the client had
        // stamped it, which is exactly the flash this criterion forbids.
        const res = await request.get(`${baseURL}/`);
        expect(res.ok()).toBe(true);
        const html = await res.text();
        const root = /<html[^>]*>/.exec(html)?.[0] ?? '';
        expect(root).toMatch(/data-theme="(terminal|dark|light|modern|classic)"/);
        // And the value is a real preset, not the literal default written by a
        // client that never got a config: the attribute must precede <body>.
        expect(html.indexOf('data-theme')).toBeLessThan(html.indexOf('<body'));
    });

    test('AC5 — every preset supplies the complete token contract, as PAINTED', async ({
        page,
        request,
        baseURL,
    }) => {
        const backend = process.env['BACKEND_URL'] || baseURL || 'http://localhost:4200';
        const token = await login(request, backend);
        test.skip(token === null, `admin API unreachable via ${backend}`);

        const put = (value: string) =>
            request.put(`${backend}/api/app/admin/site-settings/theme`, {
                headers: { Authorization: `Bearer ${token}` },
                data: { value },
            });

        const probe = await put('terminal');
        // A backend image that predates #339 has no such route. Skip VISIBLY
        // rather than fake-green; CI builds the branch, so it runs for real.
        test.skip(probe.status() === 404, 'backend image predates #339');
        expect(probe.ok()).toBe(true);

        const grounds: Record<string, string> = {};
        const tokens: Record<string, Record<string, string>> = {};
        try {
            for (const preset of PRESETS) {
                expect((await put(preset)).ok()).toBe(true);
                await page.goto('/');

                // AC1: one reload is enough — no rebuild, no redeploy.
                await expect(page.locator('html')).toHaveAttribute('data-theme', preset);

                const resolved = await page.evaluate((tokens) => {
                    const style = getComputedStyle(document.documentElement);
                    const out: Record<string, string> = {};
                    for (const t of tokens) {
                        out[t] = style.getPropertyValue(t).trim();
                    }
                    out['__bg'] = getComputedStyle(document.body).backgroundColor;
                    out['__fg'] = getComputedStyle(document.body).color;
                    return out;
                }, CONTRACT_TOKENS);

                // The tokens actually reach the page: `bg-black` compiles to
                // var(--color-black), so the body's painted ground is the
                // end-to-end proof that the indirection works in a browser.
                expect(resolved['__bg']).not.toEqual('');
                expect(resolved['__fg']).not.toEqual('');
                grounds[preset] = resolved['__bg'];
                tokens[preset] = resolved;
            }

            // AC5, stated so that it CAN FAIL. The previous form filtered the
            // resolved tokens for `''` — and every token has a `:root`
            // declaration, so `documentElement` inherits one whatever
            // `data-theme` says. Measured on this branch: `neon-vaporwave`
            // reported 0 missing and so did removing the attribute, i.e. the
            // assertion was vacuous (review round 1).
            //
            // A preset whose block is missing or partial resolves to
            // TERMINAL's values — that is the observable. So every other
            // preset must differ from terminal, both in its resolved token set
            // and in the ground the page is actually painted with. The
            // per-token completeness half now lives in the unit tier
            // (`theme-contract.spec.ts`), which reads the stylesheet source and
            // is killed by deleting a single token from one block.
            for (const preset of PRESETS.filter((p) => p !== 'terminal')) {
                expect(
                    tokens[preset],
                    `theme "${preset}" resolved identically to terminal — its block never applied`,
                ).not.toEqual(tokens['terminal']);
                expect(
                    grounds[preset],
                    `theme "${preset}" painted terminal's ground`,
                ).not.toEqual(grounds['terminal']);
            }
        } finally {
            await put('terminal');
        }
    });

    test('AC4 — the API refuses a value outside the vocabulary', async ({ request, baseURL }) => {
        const backend = process.env['BACKEND_URL'] || baseURL || 'http://localhost:4200';
        const token = await login(request, backend);
        test.skip(token === null, `admin API unreachable via ${backend}`);
        const res = await request.put(`${backend}/api/app/admin/site-settings/theme`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { value: 'neon-vaporwave' },
        });
        test.skip(res.status() === 404, 'backend image predates #339');
        expect(res.status()).toBe(422);
    });
});
