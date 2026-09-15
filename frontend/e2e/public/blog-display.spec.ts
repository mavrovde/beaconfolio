import { test, expect } from '@playwright/test';
import { config } from '../config';
import { waitForPostQueryable } from '../helpers';

test.describe('Blog Display on Page Load', () => {
    test.beforeEach(async ({ page }) => {
        // Bypass cookie consent
        await page.addInitScript(() => {
            window.localStorage.setItem('cookie_consent', 'true');
        });

        // Block analytics
        await page.route('**/google-analytics.com/**', route => route.abort());
        await page.route('**/googletagmanager.com/**', route => route.abort());
    });

    test('blog section exists on home page', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // The blog section (#blog) should exist on the home page
        const blogSection = page.locator('#blog');
        await expect(blogSection).toBeVisible({ timeout: 10000 });
    });

    test('blog section exists on standalone /blog page', async ({ page }) => {
        await page.goto('/blog');
        await page.waitForLoadState('networkidle');

        // The blog section should exist
        const blogSection = page.locator('#blog');
        await expect(blogSection).toBeVisible({ timeout: 10000 });
    });

    test('load more button fetches additional posts', async ({ page }) => {
        // First, create enough posts via admin
        await page.goto(`${config.adminUrl}/login`);
        await page.fill('input[name="username"]', 'admin');
        await page.fill('input[name="password"]', 'admin123');
        await page.click('button[type="submit"]');
        await expect(page).toHaveURL(/\/dashboard/);

        // Create 15 published posts (enough to trigger load-more after initial 10)
        let lastSlug = '';
        for (let i = 0; i < 15; i++) {
            const uniqueId = Date.now() + i;
            lastSlug = `blog-display-e2e-${uniqueId}`;
            await page.goto(`${config.adminUrl}/posts`);
            await page.click('.btn-new');

            await page.fill('input[id="title"]', `Blog Display E2E ${uniqueId}`);
            await page.fill('input[id="slug"]', lastSlug);
            await page.selectOption('select[id="language"]', 'en');
            await page.fill('textarea[id="content"]', `Content for blog display test ${i}`);
            await page.fill('textarea[id="summary"]', `Summary for post ${i}`);

            // Publish the post (uses the Publish button, not a checkbox).
            // The URL wait is ANCHORED (#337): the editor lives at /posts/new,
            // which the old unanchored /\/posts/ matched instantly — so the loop
            // never waited for the POST (whose synchronous embedding takes
            // seconds per post on a busy Ollama) and 15 creations queued a
            // backlog the 20s queryable-poll then raced. /posts$ is only
            // reached via router.navigate after the create response lands.
            await page.click('button:has-text("[ Publish ]")');
            await page.waitForURL(/\/posts$/);
        }

        // Logout and visit the blog page as a visitor
        await page.click('.logout-btn');
        // Wait for logout to settle (admin origin → /login) before the cross-origin
        // navigation to the public site, so the goto below isn't interrupted mid-flight.
        await page.waitForURL(/\/login/, { timeout: 15000 });
        // Ensure the last-created post is queryable before loading the public list.
        await waitForPostQueryable(page.request, lastSlug);
        await page.goto('/blog');
        await page.waitForLoadState('networkidle');

        // Blog posts are rendered as div.group elements inside #blog
        const blogSection = page.locator('#blog');
        await expect(blogSection).toBeVisible({ timeout: 10000 });

        // Should have posts displayed (div.group contains each post)
        const postGroups = blogSection.locator('.space-y-6 > .group');
        await expect(postGroups.first()).toBeVisible({ timeout: 10000 });

        const initialCount = await postGroups.count();
        expect(initialCount).toBe(10);

        // DEBUG: Log all API responses for posts
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('/api/app/posts')) {
                try {
                    const body = await response.text();
                    console.log(`[E2E-DEBUG] Posts API response: ${url} status=${response.status()} body_length=${body.length} body_preview=${body.substring(0, 200)}`);
                } catch (e) {
                    console.log(`[E2E-DEBUG] Posts API response: ${url} status=${response.status()} ERROR reading body: ${e}`);
                }
            }
        });

        // DEBUG: Verify the API works directly from browser context
        const apiResult = await page.evaluate(async () => {
            try {
                const resp = await fetch('/api/app/posts?page=3&page_size=5&published_only=true&sort_by=created_at&sort_order=desc');
                const data = await resp.json();
                return { status: resp.status, total: data.total, items: data.items?.length, itemIds: data.items?.map((i: any) => i.id) };
            } catch (e: any) {
                return { error: e.message };
            }
        });
        console.log('[E2E-DEBUG] Direct fetch result:', JSON.stringify(apiResult));

        // Find the "LOAD MORE RECORDS" button and wait for it to be ENABLED.
        const loadMoreBtn = page.locator('button:has-text("LOAD MORE RECORDS")');
        await expect(loadMoreBtn).toBeVisible({ timeout: 10000 });
        await expect(loadMoreBtn).toBeEnabled({ timeout: 10000 });

        await loadMoreBtn.click();

        // Wait for the post count to increase using Playwright's auto-retrying assertion.
        const allPosts = blogSection.locator('.space-y-6 > .group');
        await expect(allPosts).toHaveCount(15, { timeout: 15000 });
    });

    test('newly created blog post shows title on public page', async ({ page }) => {
        const uniqueId = Date.now();
        const title = `E2E Title Check ${uniqueId}`;

        // Create a post via admin
        await page.goto(`${config.adminUrl}/login`);
        await page.fill('input[name="username"]', 'admin');
        await page.fill('input[name="password"]', 'admin123');
        await page.click('button[type="submit"]');
        await expect(page).toHaveURL(/\/dashboard/);

        await page.goto(`${config.adminUrl}/posts`);
        await page.click('.btn-new');
        await page.fill('input[id="title"]', title);
        await page.fill('input[id="slug"]', `e2e-title-check-${uniqueId}`);
        await page.selectOption('select[id="language"]', 'en');
        await page.fill('textarea[id="content"]', 'Title check content');
        await page.fill('textarea[id="summary"]', 'Title check summary');
        await page.click('button:has-text("[ Publish ]")');
        await page.waitForURL(/\/posts$/);

        // Logout and visit blog
        await page.click('.logout-btn');
        // Wait for logout to settle (admin origin → /login) before the cross-origin
        // navigation to the public site, so the goto below isn't interrupted mid-flight.
        await page.waitForURL(/\/login/, { timeout: 15000 });
        await waitForPostQueryable(page.request, `e2e-title-check-${uniqueId}`);
        await page.goto('/blog');
        await page.waitForLoadState('networkidle');

        // The newly created post title should be visible
        const postWithTitle = page.locator('.group', { hasText: title });
        await expect(postWithTitle).toBeVisible({ timeout: 10000 });
    });

    test('post is successfully displayed when navigated directly via slug URL', async ({ page }) => {
        const uniqueId = Date.now();
        const title = `Slug Direct Load Test ${uniqueId}`;
        const slug = `slug-direct-load-${uniqueId}`;

        // Create a post via admin
        await page.goto(`${config.adminUrl}/login`);
        await page.fill('input[name="username"]', 'admin');
        await page.fill('input[name="password"]', 'admin123');
        await page.click('button[type="submit"]');
        await expect(page).toHaveURL(/\/dashboard/);

        await page.goto(`${config.adminUrl}/posts`);
        await page.click('.btn-new');
        await page.fill('input[id="title"]', title);
        await page.fill('input[id="slug"]', slug);
        await page.selectOption('select[id="language"]', 'en');
        await page.fill('textarea[id="content"]', 'Direct URL load content');
        await page.fill('textarea[id="summary"]', 'Direct URL load summary');
        await page.click('button:has-text("[ Publish ]")');
        await page.waitForURL(/\/posts$/);

        await page.click('.logout-btn');
        // Wait for logout to settle (admin origin → /login) before the cross-origin
        // navigation to the public site, so the goto below isn't interrupted mid-flight.
        await page.waitForURL(/\/login/, { timeout: 15000 });
        await waitForPostQueryable(page.request, slug);

        // Navigate directly to the slug URL to verify SSR/Routing fix
        const response = await page.goto(`/blog/${slug}`);
        await page.waitForLoadState('networkidle');

        // Check it's a 2xx response, not a 404
        expect(response?.ok()).toBeTruthy();

        // The blog post content should be visible on the loaded page
        const postTitleOnPage = page.locator('h1', { hasText: title });
        await expect(postTitleOnPage).toBeVisible({ timeout: 10000 });
        
        const postContentOnPage = page.getByText('Direct URL load content');
        await expect(postContentOnPage).toBeVisible({ timeout: 10000 });
    });
});

/**
 * #25 hydration regression guard — runs with retries:0 so a flash-to-home or a
 * home-bounce on a genuine 404 fails loudly instead of being masked by the
 * global retry policy. These tests are decoupled from the brand-new-post
 * propagation race (they poll until the post is queryable, or use a slug that is
 * deliberately absent), so any flake here is a real regression, not timing.
 */
test.describe('Blog post SSR/hydration (#25) — no retry tolerance', () => {
    test.describe.configure({ retries: 0 });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => window.localStorage.setItem('cookie_consent', 'true'));
        await page.route('**/google-analytics.com/**', route => route.abort());
        await page.route('**/googletagmanager.com/**', route => route.abort());
    });

    test('direct /blog/:slug renders the post and never flashes to the home page', async ({ page }) => {
        const uniqueId = Date.now();
        const title = `No Flash Test ${uniqueId}`;
        const slug = `no-flash-${uniqueId}`;

        // Create + publish via admin.
        await page.goto(`${config.adminUrl}/login`);
        await page.fill('input[name="username"]', 'admin');
        await page.fill('input[name="password"]', 'admin123');
        await page.click('button[type="submit"]');
        await expect(page).toHaveURL(/\/dashboard/);
        await page.goto(`${config.adminUrl}/posts`);
        await page.click('.btn-new');
        await page.fill('input[id="title"]', title);
        await page.fill('input[id="slug"]', slug);
        await page.selectOption('select[id="language"]', 'en');
        await page.fill('textarea[id="content"]', 'No flash content body');
        await page.fill('textarea[id="summary"]', 'No flash summary');
        await page.click('button:has-text("[ Publish ]")');
        await page.waitForURL(/\/posts$/);
        await page.click('.logout-btn');
        await page.waitForURL(/\/login/, { timeout: 15000 });

        // Decouple from propagation timing: only test hydration once the post is
        // server-queryable (so SSR renders it and hydration must preserve it).
        await waitForPostQueryable(page.request, slug);

        const response = await page.goto(`/blog/${slug}`);
        expect(response?.ok()).toBeTruthy();
        await page.waitForLoadState('networkidle');

        // The post must be shown AND the URL must remain /blog/:slug — a flash to
        // home would leave the hero, not the post <h1>, and change the URL to '/'.
        await expect(page.locator('h1', { hasText: title })).toBeVisible({ timeout: 10000 });
        await expect(page).toHaveURL(new RegExp(`/blog/${slug}$`));
        // Give hydration a beat and re-assert we did not get bounced home.
        await page.waitForTimeout(1500);
        await expect(page).toHaveURL(new RegExp(`/blog/${slug}$`));
        await expect(page.locator('h1', { hasText: title })).toBeVisible();
    });

    test('unknown /blog/:slug shows a graceful not-found panel, not a home redirect', async ({ page }) => {
        const missingSlug = `does-not-exist-${Date.now()}`;

        const response = await page.goto(`/blog/${missingSlug}`);
        await page.waitForLoadState('networkidle');

        // #109: SSR must serve a real HTTP 404 for an unknown slug (a soft-404
        // served as 200 pollutes search indexes and lies to crawlers). The
        // document navigation response itself carries the status.
        expect(response?.status()).toBe(404);

        // Graceful not-found (criterion 3): the not-found panel is shown and we
        // stay on /blog/:slug — the old behavior redirected to '/'.
        await expect(page.getByTestId('post-not-found')).toBeVisible({ timeout: 10000 });
        await expect(page).toHaveURL(new RegExp(`/blog/${missingSlug}$`));

        // #109: the 404 body must be marked noindex so it is never indexed.
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    });

    // #109: a request-level 404 assertion that also proves a KNOWN route stays 200.
    test('SSR returns HTTP 404 for an unknown slug but 200 for a known route', async ({ request }) => {
        const missingSlug = `ghost-${Date.now()}`;
        const notFound = await request.get(`/blog/${missingSlug}`, { failOnStatusCode: false });
        expect(notFound.status()).toBe(404);

        const home = await request.get('/', { failOnStatusCode: false });
        expect(home.status()).toBe(200);
    });
});
