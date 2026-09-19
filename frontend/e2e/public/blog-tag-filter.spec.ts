import { test, expect } from '@playwright/test';
import { config } from '../config';
import { waitForPostQueryable } from '../helpers';

/**
 * #460 — the blog tag chips must be usable WITHOUT a pointer.
 *
 * This lives in a real browser on purpose: jsdom does not implement a button's native
 * activation behaviour, so "press Enter on the chip" can only be measured here. The unit
 * suite (`blog.component.tags.spec.ts`) pins the structure — a `<button type="button">`
 * that is a SIBLING of the row control — and this spec pins what that structure buys:
 * tab-reachability, Enter, Space, and the row navigation that must survive alongside it.
 */
test.describe('Blog tag chips — keyboard and pointer', () => {
    // Per TEST, not per describe: `beforeEach` seeds a post for every case, and a repeated
    // slug is de-duplicated by the backend into `<slug>-<n>` — which made the second case
    // navigate to a URL the pinned slug no longer matched (measured in CI, run 35407041236).
    let slug = '';
    let title = '';
    let tagEnter = '';
    let tagSpace = '';

    test.beforeEach(async ({ page }) => {
        const uniqueId = Date.now();
        slug = `tag-kbd-post-${uniqueId}`;
        title = `Tag Keyboard Post ${uniqueId}`;
        tagEnter = `kbd-enter-${uniqueId}`;
        tagSpace = `kbd-space-${uniqueId}`;

        await page.addInitScript(() => {
            window.localStorage.setItem('cookie_consent', 'true');
        });

        // Seed a published, TAGGED post through the admin SPA (a CSR app — no
        // pre-hydration window, so these fills need no barrier).
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
        await page.fill('textarea[id="content"]', '# Test Content\n\nA tagged post for the #460 e2e.');
        await page.fill('textarea[id="summary"]', 'Tagged summary for E2E testing.');

        for (const tag of [tagEnter, tagSpace]) {
            await page.fill('input[id="post-tag-input"]', tag);
            await page.press('input[id="post-tag-input"]', 'Enter');
        }
        await expect(page.locator('.tag-chip')).toHaveCount(2);

        await page.click('button:has-text("[ Publish ]")');
        await page.waitForURL(/\/posts$/);

        await page.click('.logout-btn');
        await page.waitForURL(/\/login/, { timeout: 15000 });

        // The publish→queryable propagation race (#107), gated on the API first.
        await waitForPostQueryable(page.request, slug);
        await page.goto('/blog');
        // The public app is SSR: wait for hydration before driving the keyboard,
        // otherwise the keystroke lands on markup Angular has not attached to yet.
        await page.waitForLoadState('networkidle');
    });

    /** The seeded post's row, and the chip carrying a given tag inside it. */
    const postRow = (page: import('@playwright/test').Page) =>
        page.getByTestId('post-item').filter({ hasText: title }).first();
    const chip = (page: import('@playwright/test').Page, tag: string) =>
        postRow(page).getByTestId('post-tag').filter({ hasText: `#${tag}` });

    const filterIndicator = (page: import('@playwright/test').Page) =>
        page.locator('text=Filtering by tag:').locator('..');

    test('a chip is reachable by Tab and activated by Enter and Space, without navigating', async ({ page }) => {
        const row = postRow(page);
        await expect(row).toBeVisible();

        // 1. TAB REACHABILITY. The chips follow the row control in the DOM and are
        //    native buttons, so one Tab from the row lands on the first chip — no
        //    tabindex, no role, no keydown handler involved.
        await row.locator('[role="button"]').focus();
        await page.keyboard.press('Tab');
        await expect(chip(page, tagEnter)).toBeFocused();

        // 2. ENTER filters, and does NOT navigate to the post.
        await page.keyboard.press('Enter');
        await expect(filterIndicator(page)).toContainText(`#${tagEnter}`);
        await expect(page).toHaveURL(/\/blog$/);
        await expect(postRow(page)).toBeVisible();

        await page.getByRole('button', { name: '[ clear filter ]' }).click();
        await expect(page.locator('text=Filtering by tag:')).toHaveCount(0);

        // 3. SPACE filters too — the other half of a native button's activation.
        await chip(page, tagSpace).focus();
        await page.keyboard.press('Space');
        await expect(filterIndicator(page)).toContainText(`#${tagSpace}`);
        await expect(page).toHaveURL(/\/blog$/);
    });

    test('a pointer click on a chip filters without navigating, and the row still navigates', async ({ page }) => {
        await expect(postRow(page)).toBeVisible();

        // Pointer parity: the chip is no longer inside the row control, so this
        // needs no stopPropagation to avoid the row's navigation.
        await chip(page, tagEnter).click();
        await expect(filterIndicator(page)).toContainText(`#${tagEnter}`);
        await expect(page).toHaveURL(/\/blog$/);

        await page.getByRole('button', { name: '[ clear filter ]' }).click();
        await expect(page.locator('text=Filtering by tag:')).toHaveCount(0);

        // The behaviour that must SURVIVE the restructure: activating the row
        // outside a chip still expands and then navigates to the post.
        const rowControl = postRow(page).locator('[role="button"]');
        await rowControl.click();
        await expect(postRow(page).locator('.border-l-2.border-dashed')).toBeVisible();
        await rowControl.click();
        await expect(page).toHaveURL(new RegExp(`/blog/${slug}$`));
    });
});
