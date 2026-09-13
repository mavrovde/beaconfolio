import { test, expect } from '@playwright/test';

/**
 * #324 — the branded 404.
 *
 * Before this suite existed, `GET /does-not-exist` never reached Angular at all:
 * the app declared no `**` route, the SSR engine declined the request, and
 * Express answered with its own body (measured on the deployed stack: 404,
 * `x-powered-by: Express`, `content-length: 153`, no `<head>` whatsoever). That
 * failure is invisible to every unit test — the router is never asked — which is
 * exactly why it survived so long. These cases read the WIRE.
 *
 * Mutation contract (AC4): delete the `**` route from
 * `projects/public/src/app/app.routes.ts`, rebuild the frontend image, and the
 * SSR cases below fail on `Cannot GET /…` with no `<app-root>` in the body.
 */
test.describe('Branded 404 (#324)', () => {
    const UNMATCHED = '/does-not-exist';

    test('SSR serves a real 404 with the branded body for an unmatched URL', async ({
        request,
    }) => {
        const response = await request.get(UNMATCHED, { failOnStatusCode: false });

        expect(response.status()).toBe(404);
        const html = await response.text();

        // The Angular app rendered this, not Express.
        expect(html, 'Express answered instead of Angular').not.toContain('Cannot GET');
        expect(html).toContain('<app-root');
        expect(html).toContain('data-testid="page-not-found"');
        expect(html).toContain('404 — page not found');
        // The terminal line echoes what was asked for.
        expect(html).toContain(`$ cat ~${UNMATCHED}: No such file or directory`);
        // A way back into the site — the bare Express page had none.
        expect(html).toContain('href="/blog"');
    });

    test('the 404 head is noindex, nofollow and carries no canonical', async ({ request }) => {
        const html = await (await request.get('/deep/unknown/path', { failOnStatusCode: false })).text();

        expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
        // A 404 that names the home page as its canonical tells a crawler this
        // response IS the home page (the second half of #324).
        expect(html).not.toContain('rel="canonical"');
        expect(html).toMatch(/<title>[^<]*not found[^<]*<\/title>/);
    });

    test('the rendered page navigates back into the site', async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('cookie_consent', 'true');
        });

        const response = await page.goto(UNMATCHED);
        expect(response?.status()).toBe(404);

        await expect(page.getByTestId('page-not-found')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('h1')).toContainText('404');

        await page.getByTestId('not-found-home').click();
        await expect(page).toHaveURL(/\/$/);
    });

    test('known routes are untouched by the wildcard', async ({ request }) => {
        for (const route of ['/', '/blog', '/cv', '/llm']) {
            const response = await request.get(route, { failOnStatusCode: false });
            expect(response.status(), `${route} must stay 200`).toBe(200);
            expect(await response.text()).not.toContain('data-testid="page-not-found"');
        }
    });

    test('the SEO surfaces are not swallowed by the wildcard route', async ({ request }) => {
        for (const file of ['/robots.txt', '/llms.txt', '/sitemap.xml']) {
            const response = await request.get(file, { failOnStatusCode: false });
            expect(response.status(), `${file} must stay 200`).toBe(200);
            expect(await response.text()).not.toContain('page-not-found');
        }
    });

    test('/blog/<unknown> keeps its own not-found panel (AC3, no regression)', async ({
        request,
    }) => {
        const response = await request.get(`/blog/ghost-${Date.now()}`, { failOnStatusCode: false });

        expect(response.status()).toBe(404);
        const html = await response.text();
        // The blog route still matches, so the blog's own panel renders — NOT
        // the wildcard page.
        expect(html).toContain('data-testid="post-not-found"');
        expect(html).not.toContain('data-testid="page-not-found"');
    });
});
