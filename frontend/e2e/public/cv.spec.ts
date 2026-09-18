import { test, expect } from '@playwright/test';
import { API_PREFIX } from '../config';

test.describe('CV Request Flow', () => {
    test.beforeEach(async ({ page }) => {
        console.log(`[E2E] Starting test: ${test.info().title}`);
        page.on('console', msg => console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`));

        await page.addInitScript(() => {
            window.localStorage.setItem('cookie_consent', 'true');
        });
    });

    test('should submit CV request successfully', async ({ page }) => {
        // Intercept the request to verify payload and response
        let requestPayload: any;
        console.log('[E2E] Mocking CV request API...');
        await page.route(`**${API_PREFIX}/cv/request*`, async route => {
            requestPayload = route.request().postDataJSON();
            console.log(`[E2E] Intercepted ${API_PREFIX}/cv/request with payload:`, requestPayload);
            await route.continue();
        });

        console.log('[E2E] Navigating to /cv...');
        await page.goto('/cv');

        // Hydration barrier: filling before Angular hydrates lets setUpControl's
        // writeValue wipe the typed values, so cvForm stays pristine+invalid and
        // the submit button never enables — the failure reads as a 120s click
        // timeout on a `disabled` button, three steps from the cause. The idiom
        // is contact-form.spec.ts's, added there as a review blocker after the
        // same race was reproduced 1-in-60; this file was the ONE public spec
        // that fills a form and never got it (measured across e2e/public: 4
        // fills, 0 barriers), which is why #425's template rewrite could tip it.
        await page.waitForLoadState('networkidle');

        // Fill form
        console.log('[E2E] Filling CV request form...');
        await page.fill('input[formControlName="name"]', 'E2E Tester');
        await page.fill('input[formControlName="email"]', 'e2e@test.com');
        await page.fill('input[formControlName="company"]', 'Test Co');
        await page.fill('textarea[formControlName="message"]', 'Hello from E2E');

        // Handle the download event
        console.log('[E2E] Setting up download listener...');
        const downloadPromise = page.waitForEvent('download').catch(() => {
            console.log('[E2E] No download event triggered (within timeout)');
            return null;
        });

        // The form is valid BEFORE the click is attempted. Without this the
        // regression surfaces as `page.click` retrying a disabled button for the
        // full 120s test timeout; with it, a form that never becomes valid fails
        // here in seconds, naming the actual broken state.
        const submit = page.locator('button[type="submit"]');
        await expect(submit).toBeEnabled({ timeout: 15000 });

        // Click submit
        console.log('[E2E] Submitting request...');
        await submit.click();

        // Verify request payload was correct
        expect(requestPayload).toBeTruthy();
        expect(requestPayload.name).toBe('E2E Tester');
        console.log('[E2E] Request payload verified.');

        // Verify success state
        console.log('[E2E] Waiting for API response...');
        const response = await page.waitForResponse(response =>
            response.url().includes(`${API_PREFIX}/cv/request`) && response.status() === 200
        );
        expect(response.ok()).toBeTruthy();
        console.log('[E2E] API response received and verified.');
    });

    test('should show validation errors', async ({ page }) => {
        await page.goto('/cv');

        // Hydration barrier: filling before Angular hydrates lets setUpControl's
        // writeValue wipe the typed values, so cvForm stays pristine+invalid and
        // the submit button never enables — the failure reads as a 120s click
        // timeout on a `disabled` button, three steps from the cause. The idiom
        // is contact-form.spec.ts's, added there as a review blocker after the
        // same race was reproduced 1-in-60; this file was the ONE public spec
        // that fills a form and never got it (measured across e2e/public: 4
        // fills, 0 barriers), which is why #425's template rewrite could tip it.
        await page.waitForLoadState('networkidle');

        // Touch fields and leave them to trigger validation
        await page.focus('input[formControlName="email"]');
        await page.locator('input[formControlName="email"]').blur();

        // Look for error message (adjust selector based on your visual implementation)
        // If specific error classes/elements aren't known, checking that submit is disabled is a good proxy if valid
        // Or check if classes keys are visible like "VALIDATION.REQUIRED"

        // Attempt submit
        // Check submit button is disabled
        await expect(page.locator('button[type="submit"]')).toBeDisabled();

        // Check error message visibility
        await expect(page.locator('.error-msg').first()).toBeVisible();
    });
});
