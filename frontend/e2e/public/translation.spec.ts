import { test, expect } from '@playwright/test';
import { fetchBrand, wordmark } from '../helpers';

test.describe('Translation Integrity', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('cookie_consent', 'true');
        });
        await page.goto('/');
        // Wait for potential initial load
        await page.waitForLoadState('networkidle');
    });

    test('should display English menu items by default', async ({ page }) => {
        await expect(page.locator('nav').getByText('About')).toBeVisible();
        await expect(page.locator('nav').getByText('Experience')).toBeVisible();
        await expect(page.locator('nav').getByText('Skills')).toBeVisible();
        await expect(page.locator('nav').getByText('Education')).toBeVisible();
        await expect(page.locator('nav').getByText('Blog')).toBeVisible();
        await expect(page.locator('nav').getByText('CV')).toBeVisible();
        await expect(page.locator('nav').getByText('LLM')).toBeVisible();
    });

    test('should switch to German and back', async ({ page }) => {
        // Switch to DE
        // exact: getByRole name-matching is case-insensitive SUBSTRING — the German
        // contact-form submit "senden" contains both "de" and "en", so the bare
        // locators broke in strict mode the moment #69 added the form (deploy run
        // 34009222801). Exact matching pins the language switcher alone.
        await page.getByRole('button', { name: 'DE', exact: true }).click();

        await expect(page.locator('nav').getByText('Über Mich')).toBeVisible();
        await expect(page.locator('nav').getByText('Erfahrung')).toBeVisible();
        await expect(page.locator('nav').getByText('Fähigkeiten')).toBeVisible();
        await expect(page.locator('nav').getByText('Ausbildung')).toBeVisible();
        await expect(page.locator('nav').getByText('Blog')).toBeVisible();
        await expect(page.locator('nav').getByText('Lebenslauf')).toBeVisible();
        await expect(page.locator('nav').getByText('LLM')).toBeVisible();

        // Switch back to EN
        await page.getByRole('button', { name: 'EN', exact: true }).click();
        await expect(page.locator('nav').getByText('About')).toBeVisible();
    });

    test('should maintain translation when navigating to sub-routes', async ({ page, request }) => {
        // Go to LLM page
        await page.getByRole('link', { name: 'LLM' }).click();
        await expect(page).toHaveURL(/\/llm/);

        // Wait for it to load
        await page.waitForTimeout(1000);

        // The header wordmark is DERIVED from the configured owner name since
        // #67 — it used to be the literal `>_ SM`, which is initials this
        // project no longer ships and a forker could not change without
        // editing the template. Deriving the expectation is what makes this a
        // pin on the behaviour rather than on the hardcoding.
        const brand = await fetchBrand(request);
        const mark = wordmark(brand);
        expect(mark).not.toBe('>_ SM');
        await expect(page.locator('header a', { hasText: mark })).toBeVisible();

        // Navigate back to home via logo
        await page.locator('header a', { hasText: mark }).click();
        await expect(page).toHaveURL(/\/$/);

        // Menu should still be correctly translated
        await expect(page.locator('nav').getByText('LLM')).toBeVisible();
    });
});
