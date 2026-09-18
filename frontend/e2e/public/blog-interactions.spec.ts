import { test, expect } from '@playwright/test';
import { config } from '../config';
import { fetchBrand, hasShellChrome, shellPrompt, waitForPostQueryable } from '../helpers';

test.describe('Blog Interactions', () => {
    test.beforeEach(async ({ page }) => {
        // Bypass cookie consent persistently
        await page.addInitScript(() => {
            window.localStorage.setItem('cookie_consent', 'true');
        });

        // 1. Login (admin SPA lives on a separate origin)
        await page.goto(`${config.adminUrl}/login`);
        await page.fill('input[name="username"]', 'admin');
        await page.fill('input[name="password"]', 'admin123');
        await page.click('button[type="submit"]');
        await expect(page).toHaveURL(/\/dashboard/);

        // 2. Create a clean test post
        await page.goto(`${config.adminUrl}/posts`);
        await page.click('.btn-new');

        // Use a fixed timestamp for this test run to ensure uniqueness but predictability within the test context
        const uniqueId = Date.now();
        const title = `Stable E2E Post ${uniqueId}`;
        const slug = `stable-e2e-post-${uniqueId}`;

        await page.fill('input[id="title"]', title);
        await page.fill('input[id="slug"]', slug);
        await page.selectOption('select[id="language"]', 'en');
        await page.fill('textarea[id="content"]', '# Test Content\n\nThis is a stable post for E2E testing.');
        await page.fill('textarea[id="summary"]', 'Stable summary for E2E testing.');

        // Click Publish to ensure it appears on the public site
        await page.click('button:has-text("[ Publish ]")');
        // ANCHORED (#337): /posts/new matched the old unanchored form, so this
        // never gated on the create POST completing (see blog-display.spec.ts).
        await page.waitForURL(/\/posts$/);

        // 3. Logout to view as guest. Wait for the logout to settle on the
        // admin origin before the cross-origin navigation, so the goto below
        // isn't interrupted mid-flight (same pattern as blog-display).
        await page.click('.logout-btn');
        await page.waitForURL(/\/login/, { timeout: 15000 });

        // 4. The just-published post is not queryable the instant Publish
        // returns (#107 propagation race) — under full-suite load that gap is
        // what made this spec flaky (#337): the home page rendered before the
        // post existed in the public list. Gate on the API first.
        await waitForPostQueryable(page.request, slug);
        await page.goto('/');
    });

    test('should expand summary and navigate to full post', async ({ page }) => {
        // Find our specific stable post
        // We look for the row containing our stable title
        const postGroup = page.locator('.group', { hasText: 'Stable E2E Post' }).first();
        const postTitle = postGroup.locator('.text-primary.font-bold');

        await expect(postTitle).toBeVisible();

        // Get title text for verification later
        // The previous selector includes badges and tags. 
        // We want the text content of the direct text node or filter out children.
        // Easier approach: Get the whole text and clean it up or expect substring.
        // Or better: Use the title property from the data if possible, but we are testing UI.

        // The structure is: 
        // <span class="text-primary font-bold ...">
        //   <span class="badge">EN</span>
        //   Title Text
        //   <span class="tag">#tag</span>
        // </span>

        // Let's grab the full text and split/clean it. 
        // "EN Title #tag" -> we want "Title"
        // Since we know the structure, we can verify the H1 contains the title part.
        // But since the title length varies, let's just make sure the H1 text is IN the list item text (minus badges/tags).
        // Actually, reverse: The list item text contains the title. The H1 IS the title.
        // So H1 should be a substring of the List Item? No, List Item has extra text.
        // List Item: "EN My Title #tag"
        // H1: "My Title".
        // So List Item contains H1.

        const listItemText = await postTitle.innerText();

        // 1. Expand Summary
        // Click the title
        await postTitle.click();

        // Check for expanded area visibility
        const expandedArea = postGroup.locator('.border-l-2.border-dashed');
        await expect(expandedArea).toBeVisible();

        const summary = expandedArea.locator('.italic.text-primary');
        await expect(summary).toBeVisible();

        // Check for "Read More" button ($ cat full_post.md)
        const readMoreBtn = postGroup.getByRole('link', { name: '$ cat full_post.md' });
        await expect(readMoreBtn).toBeVisible();

        // Check for share button ($ cp post.url /clipboard)
        const shareBtn = postGroup.getByRole('button', { name: /cp post\.url/ });
        await expect(shareBtn).toBeVisible();

        // 2. Navigate to Full Post (click title again when expanded to navigate)
        await postTitle.click();

        // Verify URL pattern /blog/:slug
        await expect(page).toHaveURL(/\/blog\/.+/);

        // Verify changed view
        // Header should contain ~/blog/slug
        await expect(page.locator('text=~/blog/')).toBeVisible();

        // Check H1 is visible matches the expected title.
        // We know the title is "Stable E2E Post ...". 
        // Just verify H1 contains "Stable E2E Post".
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('h1')).toContainText('Stable E2E Post');

        // Check for "Back" button in the footer. 
        // There are two "[ cd .. ]" buttons now (header and footer). We want the last one.
        const footerBackBtn = page.getByRole('button', { name: '[ cd .. ]' }).last();
        // Scroll to it to ensure visibility (Playwright does this on action, but check might need it)
        await footerBackBtn.scrollIntoViewIfNeeded();
        await expect(footerBackBtn).toBeVisible();

        // 3. Verify share button on post detail page
        const detailShareBtn = page.getByRole('button', { name: /cp post\.url/ });
        await detailShareBtn.scrollIntoViewIfNeeded();
        await expect(detailShareBtn).toBeVisible();

        // 4. Navigate Back (using the footer button this time to verify it works)
        await footerBackBtn.click();

        // Verify return to homepage with #blog
        await expect(page).toHaveURL(/.*#blog/);
    });

    test('should navigate directly to a post via URL', async ({ page }) => {
        // Find our specific stable post
        const postGroup = page.locator('.group', { hasText: 'Stable E2E Post' }).first();
        const postTitle = postGroup.locator('.text-primary.font-bold').first();

        // Expand to get the link
        await postTitle.click();

        // Get the link from the expanded area within this group
        const readMoreLink = postGroup.getByRole('link', { name: '$ cat full_post.md' });
        const href = await readMoreLink.getAttribute('href');
        expect(href).toBeTruthy();

        // Now navigate directly
        await page.goto(href!);

        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('text=End of file')).toBeVisible();
    });

    test('should show a graceful not-found panel for an invalid slug (no home redirect)', async ({ page }) => {
        const missingSlug = 'non-existent-completely-fake-slug-12345';
        await page.goto(`/blog/${missingSlug}`);
        await page.waitForLoadState('networkidle');

        // Graceful not-found (#25 criterion 3): the not-found panel is shown and
        // we stay on /blog/:slug — the old behavior redirected to '/'.
        await expect(page.getByTestId('post-not-found')).toBeVisible({ timeout: 10000 });
        await expect(page).toHaveURL(new RegExp(`/blog/${missingSlug}$`));
    });

    test('should support terminal commands in UI', async ({ page, request }) => {
        // Verify terminal aesthetics on the list page. The prompt is DERIVED
        // from the served site name since #67, so the expectation is derived
        // too — asserting `user@portfolio:~/blog$` again would re-pin the
        // hardcoding this issue removed, and would pass for a forker whose
        // header still advertised somebody else's site.
        const brand = await fetchBrand(request);
        if (hasShellChrome(brand.theme)) {
            const prompt = shellPrompt(brand, '~/blog');
            await expect(page.getByText(prompt).first()).toBeVisible();
            // The guard that keeps the line above falsifiable: the configured
            // identity must actually differ from the literal it replaced, or a
            // revert to the hardcoded template would still pass.
            expect(prompt).not.toBe('user@portfolio:~/blog$');
        } else {
            // The other half of #67: a serif document preset must not greet a
            // visitor with a shell prompt at all.
            await expect(page.getByText(/^\w+@[\w.-]+:~/)).toHaveCount(0);
        }

        // Verify grep search input exists
        await expect(page.getByPlaceholder('search semantically...')).toBeVisible();
    });

    test('should show blog posts after navigating away and back', async ({ page }) => {
        // Verify posts are visible initially
        const postGroup = page.locator('.group', { hasText: 'Stable E2E Post' }).first();
        await expect(postGroup).toBeVisible();

        // Navigate to a post detail
        const postTitle = postGroup.locator('.text-primary.font-bold');
        await postTitle.click(); // expand
        await postTitle.click(); // navigate

        await expect(page).toHaveURL(/\/blog\/.+/);

        // Navigate back via header Blog link
        const blogNavLink = page.locator('nav a', { hasText: 'Blog' }).first();
        await blogNavLink.click();

        // Verify we're on homepage with #blog
        await expect(page).toHaveURL(/.*#blog/);

        // Verify posts are still visible (not empty)
        const postGroupAfterReturn = page.locator('.group', { hasText: 'Stable E2E Post' }).first();
        await expect(postGroupAfterReturn).toBeVisible({ timeout: 10000 });
    });
});
