import { expect, type APIRequestContext } from '@playwright/test';
import { config, API_PREFIX } from './config';

/**
 * Poll the PUBLIC posts API until a freshly-created post is queryable by slug.
 * A just-published post is not in the SSR/transfer-cached list immediately; this
 * decouples the create→view tests from that propagation race (tracked in #107)
 * so they exercise the actual render/hydration behavior, not eventual
 * consistency, and stop flaking against the tight per-assertion timeout.
 * Shared by blog-display and blog-interactions (#337 — the latter lacked it and
 * raced the propagation on every full-suite run).
 */
export async function waitForPostQueryable(
    request: APIRequestContext,
    slug: string,
): Promise<void> {
    await expect
        .poll(async () => (await request.get(`${config.baseUrl}${API_PREFIX}/posts/${slug}`)).status(), {
            timeout: 20000,
            intervals: [200, 500, 1000],
        })
        .toBe(200);
}

/**
 * The shell chrome the page should be rendering, derived from the identity the
 * BACKEND is actually serving (#67).
 *
 * Before #67 the prompt (`user@portfolio:~$`) and the header wordmark
 * (`>_ SM`) were literals in the templates, and the e2e specs asserted those
 * literals — which made them a pin on the hardcoding, not on the behaviour. A
 * forker who set `OWNER_NAME` got a header that still read someone else's
 * initials and a suite that stayed green about it.
 *
 * So the expectation is re-derived here from `GET /config/site` instead of
 * restated. It is a deliberate second implementation of the mapping: the unit
 * suite pins the mapping table itself (`shell-chrome.service.spec.ts`), and
 * these assert that what the browser PAINTS tracks what the API SERVES. A
 * regression that re-hardcodes a literal fails here, because the e2e stack's
 * configured name ("My Portfolio", "Jane Doe") derives to neither old literal.
 */
export interface ServedBrand {
    siteName: string;
    ownerName: string;
    theme: string;
}

export async function fetchBrand(request: APIRequestContext): Promise<ServedBrand> {
    const response = await request.get(`${config.baseUrl}${API_PREFIX}/config/site`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    return {
        siteName: body['site_name'],
        ownerName: body['owner_name'],
        theme: body['theme'],
    };
}

/** `My Portfolio` -> `my-portfolio`; the host half of `user@host:~$`. */
export function shellHost(siteName: string): string {
    const slug = siteName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9.-]/g, '');
    return slug || 'portfolio';
}

/** `user@my-portfolio:~/blog$` — the full prompt for a path. */
export function shellPrompt(brand: ServedBrand, path = '~', user = 'user'): string {
    return `${user}@${shellHost(brand.siteName)}:${path}$`;
}

/** `>_ JD` under the terminal preset, `JD` under every other. */
export function wordmark(brand: ServedBrand): string {
    const letters = brand.ownerName
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => word[0])
        .filter((ch) => /[a-z0-9]/i.test(ch))
        .slice(0, 2)
        .join('')
        .toUpperCase();
    const mark = letters || brand.siteName.trim().slice(0, 2).toUpperCase() || '??';
    return brand.theme === 'terminal' ? `>_ ${mark}` : mark;
}

/**
 * Whether the served preset dresses the page as a terminal. Only `terminal`
 * does; the other four are ordinary document themes, where a `user@host:~$`
 * greeting reads as a rendering bug (#67). The e2e stack defaults to
 * `terminal`, but the theme is ONE MUTABLE ROW that `theme-presets.spec.ts`
 * PUTs and restores — so a spec that asserts chrome has to branch on what the
 * API says rather than on what the default is, or a failure mid-way through
 * that serial block leaves it failing for an unrelated reason.
 */
export function hasShellChrome(theme: string): boolean {
    return theme === 'terminal';
}
