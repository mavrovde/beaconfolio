import { test, expect } from '@playwright/test';
import { API_PREFIX } from '../config';

/**
 * The public contact form (#69) — the product's newest PUBLIC WRITE path, and
 * until now the only v1.12.0 surface never exercised in a browser (both the
 * #258 and #274 reviews named this residual). Covers what unit tests can't:
 * the form renders in the SSR'd page, the zoneless client repaints after the
 * async submit, and a failing API surfaces an error instead of a silent hang.
 */
test.describe('Public contact form', () => {
    test('is server-rendered, then hydrates with its privacy note', async ({ page, request }) => {
        // SSR proper: the form must exist in the HTML the server sends, not
        // only after hydration (the seo-ssr.spec.ts idiom — review nit 5).
        const html = await (await request.get('/')).text();
        expect(html).toContain('aria-label="contact form"');

        await page.goto('/');
        // Hydration barrier (review blocker): filling before Angular hydrates
        // lets setUpControl's writeValue wipe the typed values — reproduced as
        // 1 failure in 60 runs. It is now required by
        // scripts/check_e2e_hydration_barrier.sh, which is here because this
        // comment used to claim "Every other public spec uses this idiom" and
        // that was false: cv.spec.ts had four fills and no barrier.
        await page.waitForLoadState('networkidle');
        const form = page.locator('form[aria-label="contact form"]');
        await expect(form).toBeVisible();
        await expect(page.locator('#contact-name')).toBeVisible();
        await expect(page.locator('#contact-email')).toBeVisible();
        await expect(page.locator('#contact-message')).toBeVisible();
        // Privacy affordance: the page states what happens to the data.
        // Language-agnostic: EN "stored" / DE "gespeichert" (the site serves both).
        await expect(page.locator('#contact').getByText(/stored|gespeichert/i)).toBeVisible();
    });

    test('blocks submission until the required fields are valid', async ({ page }) => {
        await page.goto('/');
        // Hydration barrier (review blocker): filling before Angular hydrates
        // lets setUpControl's writeValue wipe the typed values — reproduced as
        // 1 failure in 60 runs. It is now required by
        // scripts/check_e2e_hydration_barrier.sh, which is here because this
        // comment used to claim "Every other public spec uses this idiom" and
        // that was false: cv.spec.ts had four fills and no barrier.
        await page.waitForLoadState('networkidle');
        const submit = page.locator('form[aria-label="contact form"] button[type="submit"]');
        await expect(submit).toBeDisabled();

        // Whitespace-only input must NOT satisfy the trimmed validators.
        await page.fill('#contact-name', '   ');
        await page.fill('#contact-email', 'rita@agency.example');
        await page.fill('#contact-message', '   ');
        await expect(submit).toBeDisabled();

        await page.fill('#contact-name', 'Rita Recruiter');
        await page.fill('#contact-message', 'We have a role that fits your profile.');
        await expect(submit).toBeEnabled();
    });

    test('submits, repaints with the success message, and clears the form', async ({ page }) => {
        let posted: Record<string, unknown> | null = null;
        await page.route(`**${API_PREFIX}/interactions/contact`, async (route) => {
            posted = route.request().postDataJSON();
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({
                    id: 'e2e-1', source: 'contact_form', status: 'new',
                    name: 'Rita Recruiter', email: 'rita@agency.example',
                    company: null, message: 'We have a role that fits your profile.',
                    payload: null, created_at: '2026-09-06T09:00:00Z',
                    updated_at: '2026-09-06T09:00:00Z',
                }),
            });
        });

        await page.goto('/');
        // Hydration barrier (review blocker): filling before Angular hydrates
        // lets setUpControl's writeValue wipe the typed values — reproduced as
        // 1 failure in 60 runs. It is now required by
        // scripts/check_e2e_hydration_barrier.sh, which is here because this
        // comment used to claim "Every other public spec uses this idiom" and
        // that was false: cv.spec.ts had four fills and no barrier.
        await page.waitForLoadState('networkidle');
        await page.fill('#contact-name', '  Rita Recruiter  ');
        await page.fill('#contact-email', 'rita@agency.example');
        await page.fill('#contact-message', 'We have a role that fits your profile.');
        await page.locator('form[aria-label="contact form"] button[type="submit"]').click();

        // NOTE (review-corrected): this does NOT pin the zoneless repaint —
        // `contactForm.reset()` notifies the scheduler on its own, so the page
        // repaints even with markForCheck() deleted (reviewer mutated the
        // served bundle and this test still passed). What it pins is the
        // success CONTRACT: status message shown, form cleared. The repaint
        // itself is pinned by the error-path test below, where nothing else
        // triggers change detection.
        await expect(page.locator('form[aria-label="contact form"] [role="status"]')).toBeVisible();
        await expect(page.locator('#contact-name')).toHaveValue('');

        // The client mirrors the server's normalization contract.
        expect(posted).toMatchObject({ name: 'Rita Recruiter', company: null });
    });

    test('shows an error and keeps the values when the API fails', async ({ page }) => {
        await page.route(`**${API_PREFIX}/interactions/contact`, (route) =>
            route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"nope"}' })
        );

        await page.goto('/');
        // Hydration barrier (review blocker): filling before Angular hydrates
        // lets setUpControl's writeValue wipe the typed values — reproduced as
        // 1 failure in 60 runs. It is now required by
        // scripts/check_e2e_hydration_barrier.sh, which is here because this
        // comment used to claim "Every other public spec uses this idiom" and
        // that was false: cv.spec.ts had four fills and no barrier.
        await page.waitForLoadState('networkidle');
        await page.fill('#contact-name', 'Rita Recruiter');
        await page.fill('#contact-email', 'rita@agency.example');
        await page.fill('#contact-message', 'We have a role that fits your profile.');
        await page.locator('form[aria-label="contact form"] button[type="submit"]').click();

        // THIS is the zoneless repaint pin: on the error branch nothing but
        // markForCheck() triggers change detection (verified by mutation —
        // deleting it here fails this test).
        await expect(page.locator('form[aria-label="contact form"] [role="alert"]')).toBeVisible();
        // Values survive a failure so the visitor can retry without retyping.
        await expect(page.locator('#contact-name')).toHaveValue('Rita Recruiter');
    });

    test('is reachable and usable on a phone viewport', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // The form must be usable on the device most recruiters read mail on —
        // not merely present in the DOM at desktop width.
        const form = page.locator('form[aria-label="contact form"]');
        await form.scrollIntoViewIfNeeded();
        await expect(form).toBeVisible();
        await expect(page.locator('#contact-name')).toBeVisible();

        // The PAGE must not scroll sideways. Measuring the form's own box is
        // vacuous — reviewer measured 342px inside a 390px viewport, i.e. 48px
        // of permanent slack, so an injected overflow still passed. The
        // document's scrollWidth vs clientWidth is the real property (verified
        // both directions: 0 clean, 534 with an injected overflow).
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(0);
    });

    test('labels every field for assistive technology', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        // Every control is reachable by a real <label for>, which is what a
        // screen reader announces — a form nobody can fill is a lost lead.
        for (const id of ['contact-name', 'contact-email', 'contact-message']) {
            await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
            await expect(page.locator(`#${id}`)).toBeVisible();
        }
        await expect(page.locator('form[aria-label="contact form"]')).toHaveCount(1);
    });
});
