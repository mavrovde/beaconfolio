import { test, expect } from '@playwright/test';

test.describe('Design Regression Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('cookie_consent', 'true');
    });
  });

  test('should use correct terminal green colors', async ({ page }) => {
    await page.goto('/');

    // Check primary color variable if exposed, or computed style of key elements
    // Since we hardcoded primary to #00ff00

    const body = page.locator('body');
    // text-primary results in color #00ff00 (rgb(0, 255, 0))
    await expect(body).toHaveCSS('color', 'rgb(51, 255, 0)');

    // Check background is black
    await expect(body).toHaveCSS('background-color', 'rgb(0, 0, 0)');

    // Check a border terminal element if exists (e.g. header)
    const headerBorder = page.locator('.border-terminal').first();
    // Border color should be rgba(0, 255, 0, 0.3)
    // Note: computed style might return the matrix or specific rgba
    if ((await headerBorder.count()) > 0) {
      await expect(headerBorder).toHaveCSS('border-bottom-color', 'rgba(51, 255, 0, 0.6)');
    }
  });

  /**
   * #443 — a filled CTA must not render its label in its own background colour.
   *
   * `styles.css` themes every button/link with `@apply text-primary …`. While
   * that block sat OUTSIDE a cascade layer it beat every Tailwind utility,
   * because unlayered CSS wins over layered CSS regardless of specificity — so
   * the hero's `bg-primary text-black` CTA painted #33ff00 on #33ff00 and the
   * "Hire me" button shipped as a solid green rectangle with an invisible
   * label. The same classes on a <span> were fine, which is what localised the
   * cause to the selector rather than to the palette.
   *
   * This asserts the OUTCOME (a readable label), not the mechanism, so it also
   * catches a future palette edit or a new unlayered rule that reintroduces the
   * defect by some other route. It is an e2e test because the CSS cascade only
   * exists in a browser — Vitest cannot see this class of bug at all.
   */
  test('filled buttons and links keep their label readable', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const offenders = await page.evaluate(() => {
      const luminance = (rgb: string): number => {
        const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
        const channel = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };

      const bad: { text: string; color: string; background: string; ratio: number }[] = [];
      for (const el of Array.from(document.querySelectorAll('a, button'))) {
        const style = getComputedStyle(el);
        const background = style.backgroundColor;
        // Only elements that paint their own background: over a transparent
        // background the effective backdrop is the page, which this test does
        // not try to resolve.
        const alpha = Number((background.match(/[\d.]+/g) ?? [])[3] ?? '1');
        if (alpha === 0) continue;
        const label = (el.textContent ?? '').trim();
        if (!label) continue;

        const lightest = Math.max(luminance(style.color), luminance(background));
        const darkest = Math.min(luminance(style.color), luminance(background));
        const ratio = (lightest + 0.05) / (darkest + 0.05);
        if (ratio < 4.5) {
          bad.push({ text: label.slice(0, 40), color: style.color, background, ratio });
        }
      }
      return bad;
    });

    expect(offenders, `unreadable labels: ${JSON.stringify(offenders, null, 2)}`).toEqual([]);
  });

  /**
   * The mechanism itself, pinned separately: a utility class must be able to
   * override the button/link theme default. If the theme block ever leaves
   * `@layer base` again, this fails immediately and names the cause, instead of
   * leaving the contrast test above to report a symptom.
   */
  test('a utility class overrides the button/link theme default', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const color = await page.evaluate(() => {
      const probe = document.createElement('a');
      probe.className = 'text-black';
      probe.textContent = 'probe';
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    });

    expect(color).toBe('rgb(0, 0, 0)');
  });

  test('should use mono font', async ({ page }) => {
    await page.goto('/');
    const body = page.locator('body');
    await expect(body).toHaveCSS('font-family', /Courier Prime|Courier|monospace/);
  });
});
