// Pure, browser-free orchestration for scrape-posts.js, kept out of that file so it can
// be unit-tested with `node --test` (scrape-posts.js starts a browser at import time).
// The three decisions that cost data when they are wrong live here: how the virtualised
// feed is harvested, when an extraction counts as failed, and what is written over the
// previous export.

/** Newest first; undated posts sink to the end. */
export function sortNewestFirst(posts) {
  return [...posts].sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
}

/**
 * Harvest posts from a feed that DROPS cards scrolled far past (virtualised), so the
 * set must be collected after every step, keyed by URN, rather than read once at the end.
 *
 * `extract(seen)` returns the new posts on screen, skipping the URNs in `seen`;
 * `advance()` scrolls and waits. Stops at `maxScrolls`, once `stableLimit` consecutive
 * steps add nothing new, or when `maxPosts` is reached; the result is capped to `maxPosts`
 * (a single step can add a whole screenful past the limit).
 */
export async function harvestPosts({ extract, advance, maxScrolls, maxPosts, stableLimit = 4, log = () => {} }) {
  const byUrn = new Map();
  let stable = 0;
  for (let step = 0; step < maxScrolls && stable < stableLimit && byUrn.size < maxPosts; step++) {
    const before = byUrn.size;
    for (const post of await extract(new Set(byUrn.keys()))) {
      byUrn.set(post.urn, post);
    }
    stable = byUrn.size === before ? stable + 1 : 0;
    log(step + 1, byUrn.size);
    await advance();
  }
  return sortNewestFirst([...byUrn.values()]).slice(0, maxPosts);
}

/**
 * An extraction that found nothing is a FAILURE, not an empty profile: LinkedIn's markup
 * changed once and a run silently replaced a 25-post export with `[]`.
 */
export function assertExtracted(posts) {
  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error('Extracted 0 posts - selectors have probably rotted; posts_data.json left untouched');
  }
  return posts;
}

/**
 * Parse the previous export, FAILING CLOSED. A file that exists but is truncated, holds
 * conflict markers or is not an array must never be read as "empty": the default merge
 * would then overwrite it with only this run's posts - the shrinkage the merge exists to
 * prevent. `replace` is the explicit opt-out and ignores whatever is there.
 * `text` is the file's contents, or null when there is no file yet.
 */
export function readExisting(text, { replace = false } = {}) {
  if (replace || text === null || text === undefined) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`posts_data.json exists but is not valid JSON (${e.message}); fix it or pass --replace`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('posts_data.json exists but is not a JSON array; fix it or pass --replace');
  }
  return parsed;
}

/**
 * What to write over the previous export. By default the fresh run is MERGED into it by
 * URN (fresh wins), so a partial run - an expired session, a short scroll - can never
 * shrink the file; `replace` writes the fresh set only (to drop deleted posts on purpose).
 */
export function mergeExport(existing, fresh, { replace = false } = {}) {
  if (replace) return sortNewestFirst(fresh);
  const byUrn = new Map();
  for (const post of Array.isArray(existing) ? existing : []) {
    if (post && post.urn) byUrn.set(post.urn, post);
  }
  for (const post of fresh) byUrn.set(post.urn, post);
  return sortNewestFirst([...byUrn.values()]);
}
