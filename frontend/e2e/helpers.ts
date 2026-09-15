import { expect } from '@playwright/test';
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
    request: { get: (url: string) => Promise<{ status: () => number }> },
    slug: string,
): Promise<void> {
    await expect
        .poll(async () => (await request.get(`${config.baseUrl}${API_PREFIX}/posts/${slug}`)).status(), {
            timeout: 20000,
            intervals: [200, 500, 1000],
        })
        .toBe(200);
}
