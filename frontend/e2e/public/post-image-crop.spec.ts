import { test, expect } from '@playwright/test';

/**
 * Post cover image crop (owner report: "the photo in some posts looks ugly, crop it by the
 * size"). The reported post's image is a 480x596 PORTRAIT. The old markup
 * (`w-full h-auto object-cover max-h-[500px]`) upscaled it to the full column width and let the
 * 500px cap cut its MIDDLE out, so the subject's head was cropped away.
 *
 * The fix is pure CSS — a fixed 16:9 frame, `object-cover`, anchored at the top — and jsdom
 * applies no stylesheet (lessons §51), so the geometry can only be pinned here, in a real
 * browser against the composed stack: create a published post, upload a portrait image to it,
 * open the post page and measure the rendered box.
 *
 * No `test.skip` on an unserviceable stack (lessons §52): if the backend cannot be reached or
 * the admin login fails, this test FAILS — that is exactly when the feature is broken.
 */
test.describe('Blog post cover image', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('cookie_consent', 'true');
        });
    });

    test('a portrait upload renders in a 16:9 frame cropped from the top', async ({ page, request, baseURL }) => {
        const backend = process.env['BACKEND_URL'] || baseURL || 'http://localhost:4200';
        const login = await request.post(`${backend}/api/app/auth/login`, {
            form: { username: 'admin', password: 'admin123' },
        });
        expect(login.ok(), `admin login via ${backend}`).toBe(true);
        const auth = { Authorization: `Bearer ${(await login.json()).access_token}` };

        const slug = `e2e-portrait-cover-${Date.now()}`;
        const created = await request.post(`${backend}/api/app/posts`, {
            headers: auth,
            data: {
                title: 'E2E portrait cover',
                slug,
                content: '<p>Portrait cover image crop check.</p>',
                language: 'en',
                published: true,
                tags: [],
            },
        });
        expect(created.ok(), await created.text()).toBe(true);
        const postId = (await created.json()).id;

        try {
            // A 480x596 portrait PNG — the reported image's exact dimensions — drawn by the
            // browser itself so the test needs no binary fixture.
            const pngBase64 = await page.evaluate(() => {
                const c = document.createElement('canvas');
                c.width = 480;
                c.height = 596;
                const ctx = c.getContext('2d')!;
                ctx.fillStyle = '#ff0000';
                ctx.fillRect(0, 0, 480, 120);
                ctx.fillStyle = '#0000ff';
                ctx.fillRect(0, 120, 480, 476);
                return c.toDataURL('image/png').split(',')[1];
            });
            const upload = await request.put(`${backend}/api/app/posts/${postId}/image`, {
                headers: auth,
                multipart: {
                    file: { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(pngBase64, 'base64') },
                },
            });
            expect(upload.ok(), await upload.text()).toBe(true);

            await page.goto(`/blog/${slug}`);
            const img = page.locator('article img').first();
            await expect(img).toBeVisible();
            // Wait for the real decode: a broken image has naturalWidth 0.
            await expect
                .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
                .toBe(480);

            const box = await img.evaluate((el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return { w: r.width, h: r.height, fit: s.objectFit, pos: s.objectPosition };
            });
            // The frame is 16:9 regardless of the image's own (portrait) shape...
            expect(box.w).toBeGreaterThan(0);
            expect(box.w / box.h).toBeCloseTo(16 / 9, 1);
            // ...filled without distortion...
            expect(box.fit).toBe('cover');
            // ...and the crop keeps the TOP of the image, not its middle.
            expect(box.pos).toBe('50% 0%');
        } finally {
            await request.delete(`${backend}/api/app/posts/${postId}`, { headers: auth });
        }
    });
});
