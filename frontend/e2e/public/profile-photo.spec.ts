import { test, expect } from '@playwright/test';

/**
 * Runtime profile photo (#333): the hero's <img> points at the backend API
 * and falls back to the baked placeholder when the API 404s (no upload yet).
 * Runs against the composed stack. The no-upload test exercises exactly the
 * fork-safe default path the AC pins ("with no upload, the placeholder
 * renders exactly as today") — including the browser-side error→fallback
 * swap, which no unit tier can see (jsdom fires no real image loads). The
 * upload test drives the REAL flow (admin upload → public page) at the API
 * seam and restores the pristine state in a finally, availability-cta's
 * pattern: serial worker + finally-restore keep the shared backend clean.
 */
test.describe('Hero profile photo', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('cookie_consent', 'true');
        });
    });

    test('SSR ships the API photo URL; with no upload the placeholder renders', async ({ page }) => {
        await page.goto('/');
        const img = page.getByTestId('profile-photo');
        await expect(img).toBeVisible();
        // The error event has fired (the API 404s on a fresh stack) and the
        // swap landed: the rendered src is the baked placeholder again.
        await expect(img).toHaveAttribute('src', /assets\/images\/profile\.png/);
        // ...and that fallback actually paints — a broken image has
        // naturalWidth 0.
        const naturalWidth = await img.evaluate(
            (el) => (el as HTMLImageElement).naturalWidth,
        );
        expect(naturalWidth).toBeGreaterThan(0);
    });

    test('an uploaded photo is served publicly and the hero keeps the API src', async ({ page, request, baseURL }) => {
        // The API rides the SAME origin the browser uses (CI publishes only
        // the proxy; :8000 exists only in the dev topology — #295). And
        // request.post THROWS on a refused connection, so the probe catches.
        const backend = process.env['BACKEND_URL'] || baseURL || 'http://localhost:4200';
        let login;
        try {
            login = await request.post(`${backend}/api/app/auth/login`, {
                form: { username: 'admin', password: 'admin123' },
            });
        } catch {
            test.skip(true, `backend API unreachable via ${backend}`);
            return;
        }
        test.skip(!login.ok(), 'admin login unavailable on this stack');
        const token = (await login.json()).access_token;

        // 1x1 PNG.
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            'base64',
        );
        const upload = await request.post(`${backend}/api/app/admin/profile/photo`, {
            headers: { Authorization: `Bearer ${token}` },
            multipart: {
                file: { name: 'photo.png', mimeType: 'image/png', buffer: png },
            },
        });
        // A backend image predating #333 has no such route — skip VISIBLY
        // rather than fake-green; CI builds the branch, so it runs for real
        // there and on every stack built after this merges.
        test.skip(upload.status() === 404, 'backend image predates #333');
        expect(upload.ok()).toBe(true);
        try {
            const served = await request.get(`${backend}/api/app/profile/photo`);
            expect(served.status()).toBe(200);
            expect(served.headers()['content-type']).toBe('image/png');

            await page.goto('/');
            const img = page.getByTestId('profile-photo');
            await expect(img).toBeVisible();
            // No error fires now, so the src STAYS the API URL — the visible
            // proof that an upload personalizes the hero with no rebuild.
            await expect(img).toHaveAttribute('src', /\/api\/app\/profile\/photo/);
        } finally {
            await request.delete(`${backend}/api/app/admin/profile/photo`, {
                headers: { Authorization: `Bearer ${token}` },
            });
        }
    });
});
