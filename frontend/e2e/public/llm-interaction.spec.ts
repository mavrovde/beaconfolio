import { test, expect } from '@playwright/test';
import { API_PREFIX } from '../config';

test.describe('LLM Terminal', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('cookie_consent', 'true');
        });
        await page.goto('/llm');

        // Hydration barrier: /llm is server-rendered, and its terminal input is
        // bound with [(ngModel)] — a ControlValueAccessor, so setUpControl's
        // writeValue wipes anything typed before Angular attaches, exactly as it
        // does the reactive CV form. The click below is the same race one step
        // earlier: a button that is in the server HTML but not yet hydrated
        // swallows the click silently. Idiom from contact-form.spec.ts.
        await page.waitForLoadState('networkidle');

        // Switch to Single Agent mode
        await page.click('button:has-text("Single Agent")');
        await page.waitForSelector('.terminal-container');
    });

    test('should display terminal with initial state', async ({ page }) => {
        await expect(page.locator('.terminal-container')).toBeVisible();
        await expect(page.getByText('user@portfolio:~/llm$', { exact: true }).first()).toBeVisible();
    });

    test('should handle multi-chunk streaming response', async ({ page }) => {
        const chunks = ['Hello ', 'this ', 'is ', 'a ', 'streamed ', 'response.'];

        await page.route(`**${API_PREFIX}/ai/chat`, async (route) => {
            await new Promise(resolve => setTimeout(resolve, 100)); // Simulate delay
            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: chunks.join('')
            });
        });

        const input = page.locator('input[type="text"]');
        await input.fill('test message');
        await input.press('Enter');

        // Check user message
        await expect(page.locator('.message', { hasText: 'test message' })).toBeVisible();

        // Check cumulative response
        await expect(page.locator('.message .text-secondary')).toContainText('Hello this is a streamed response.');
    });

    test('should clear history when "clear" command is sent', async ({ page }) => {
        const input = page.locator('input[type="text"]');
        const uniqueMessage = `FIXME_STABILITY_${Date.now()}`;

        // Mock response to avoid real AI adding same text
        await page.route(`**${API_PREFIX}/ai/chat`, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: 'Acknowledged.'
            });
        });

        // Send a message first
        await input.fill(uniqueMessage);
        await input.press('Enter');
        await expect(page.locator('.message', { hasText: uniqueMessage })).toBeVisible();

        // Send clear
        await input.fill('clear');
        await input.press('Enter');

        // Wait for messages to be cleared
        await expect(page.locator('.message')).toHaveCount(0);
    });

    test('should handle API errors gracefully', async ({ page }) => {
        await page.route(`**${API_PREFIX}/ai/chat`, async (route) => {
            await new Promise(resolve => setTimeout(resolve, 100));
            await route.abort('failed');
        });

        const input = page.locator('input[type="text"]');
        await input.fill('trigger error');
        await input.press('Enter');

        // Error message should appear
        await expect(page.locator('text=Connection error. Please ensure Ollama is running.')).toBeVisible();
    });

    test('should have terminal-inspired aesthetics', async ({ page }) => {
        const terminal = page.locator('.terminal-container');
        await expect(terminal).toHaveCSS('background-color', 'rgb(0, 0, 0)');
        await expect(terminal).toHaveCSS('font-family', /monospace|mono/);

        const input = page.locator('input[type="text"]');
        await expect(input).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(input).toHaveCSS('border-style', 'none');
    });

    test('should maintain focus on input after interaction', async ({ page }) => {
        // Mock API with delay
        await page.route(`**${API_PREFIX}/ai/chat`, async (route) => {
            await new Promise(resolve => setTimeout(resolve, 200));
            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: 'Ok'
            });
        });

        const input = page.locator('input[type="text"]');

        // Initial focus - ensure we click to focus as button click might have stolen it
        await page.locator('.terminal-container').click();
        await expect(input).toBeFocused();

        // Focus after sending message
        await input.fill('hello');
        await input.press('Enter');

        // Input should disappear during thinking (pulse indicator)
        await expect(page.locator('text=_ generating response...')).toBeVisible();

        // Wait for it to reappear and be focused
        await expect(input).toBeVisible();
        await page.waitForFunction(() => document.activeElement instanceof HTMLInputElement);
        await expect(input).toBeFocused();

        // Focus after clicking terminal container
        await page.locator('.terminal-container').click();
        await page.waitForFunction(() => document.activeElement instanceof HTMLInputElement);
        await expect(input).toBeFocused();
    });
});
