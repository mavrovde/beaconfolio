// Pure, browser-free helpers that turn a raw scraped post record into the stable
// posts_data.json schema. Kept free of Playwright so it can be unit-tested with
// `node --test` against fixtures (no live LinkedIn, no network).

/** Extract the numeric activity id from a LinkedIn URN (activity or ugcPost). */
export function activityIdFromUrn(urn) {
  if (!urn) return null;
  const m = String(urn).match(/urn:li:(?:activity|ugcPost):(\d+)/);
  if (m) return m[1];
  const last = String(urn).split(':').pop();
  return /^\d+$/.test(last) ? last : null;
}

/**
 * LinkedIn activity ids encode the creation time in their high bits: the first
 * 41 bits are milliseconds since the epoch. `id >> 22` recovers that timestamp.
 * Returns an ISO-8601 string, or null if the id is unusable.
 */
export function postedAtFromActivityId(activityId) {
  if (!activityId || !/^\d+$/.test(String(activityId))) return null;
  try {
    const ms = Number(BigInt(activityId) >> 22n);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

/** Canonical permalink for an activity id. */
export function urlFromActivityId(activityId) {
  return activityId
    ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
    : null;
}

/**
 * Keep only the post's OWN media: drop the author's profile/avatar photo (the
 * historical bug), drop non-http junk, and de-duplicate while preserving order.
 */
export function cleanImageUrls(candidates, authorImageUrl) {
  const out = [];
  const seen = new Set();
  for (const raw of candidates || []) {
    if (!raw) continue;
    const url = String(raw).trim();
    if (!url.startsWith('http')) continue;
    if (authorImageUrl && url === authorImageUrl) continue;
    // LinkedIn avatar assets — never the post image.
    if (/profile-displayphoto|profile-framedphoto|profile-photo/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

// Language heuristic (en/de) — the SAME algorithm as importer/core.py
// detect_language(); keep the two in sync. The old version flipped a post to
// "de" on a single umlaut or German-looking word ("MIT", "Köln", "born and
// die"), which tagged six English posts German. Now each language counts its
// own function words over the tokenised text, and German must win on volume
// (>= 2 hits), density (>= 10% of words) AND against the English count.
const DE_STOPWORDS = new Set(
  ('und der das den dem des ein eine einen einem einer nicht mit für ich auch ' +
    'ist sind wird werden wurde sich wir sie er es zu von auf im zum zur bei aus ' +
    'nach wie aber oder wenn noch nur schon sehr mehr mich mir uns unser unsere ' +
    'diese dieser dieses man hier jetzt immer heute dass über kann können haben ' +
    'habe gibt ohne durch vom bin bist seid eure euch ihr ihre').split(' '),
);
const EN_STOPWORDS = new Set(
  ('the and of to is that with for it this are you not be on as have but what ' +
    'they we from by or at which can how why their our my your its has been ' +
    'were would there when who than then just about into more one all').split(' '),
);
const MIN_WORDS = 4;
const MIN_HITS = 2;
const MIN_RATIO = 0.1;

export function detectLanguage(text, fallback = 'en') {
  const words = (text || '').toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < MIN_WORDS) return fallback;
  const de = words.filter((w) => DE_STOPWORDS.has(w) || /[äöüß]/.test(w)).length;
  const en = words.filter((w) => EN_STOPWORDS.has(w)).length;
  for (const [lang, hits, other] of [
    ['de', de, en],
    ['en', en, de],
  ]) {
    if (hits >= MIN_HITS && hits / words.length >= MIN_RATIO && hits > other) return lang;
  }
  return fallback;
}

/**
 * Turn a raw extracted record into the stable schema, or null if it has no real
 * text. `raw` = { urn, content, imageCandidates, authorImageUrl, time }.
 */
export function parsePost(raw) {
  const content = (raw.content || '').trim();
  if (content.length < 5) return null;
  const activityId = activityIdFromUrn(raw.urn);
  const imageUrls = cleanImageUrls(raw.imageCandidates, raw.authorImageUrl);
  return {
    urn: activityId ? `urn:li:activity:${activityId}` : raw.urn || '',
    url: urlFromActivityId(activityId),
    content,
    imageUrls,
    imageUrl: imageUrls[0] || null,
    postedAt: postedAtFromActivityId(activityId),
    time: raw.time || '',
    language: detectLanguage(content),
  };
}
