// Unit tests for the scraper's data-loss guards. No browser, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { harvestPosts, assertExtracted, mergeExport, readExisting, sortNewestFirst } from './collect-posts.js';

const post = (n, postedAt = `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`) => ({
  urn: `urn:li:activity:${n}`,
  postedAt,
});

// A feed that shows `pages[step]` on each step (virtualised: earlier cards vanish).
function feed(pages) {
  let step = 0;
  const calls = { extract: 0, advance: 0 };
  return {
    calls,
    extract: async (seen) => {
      calls.extract++;
      return (pages[step] || []).filter((p) => !seen.has(p.urn));
    },
    advance: async () => {
      calls.advance++;
      step++;
    },
  };
}

test('harvestPosts keeps cards that have left the DOM and de-duplicates by URN', async () => {
  const f = feed([[post(1), post(2)], [post(2), post(3)], [post(3), post(4)]]);
  const out = await harvestPosts({ ...f, maxScrolls: 10, maxPosts: 100 });
  assert.deepEqual(out.map((p) => p.urn).sort(), [1, 2, 3, 4].map((n) => `urn:li:activity:${n}`));
});

test('harvestPosts stops after stableLimit steps that add nothing new', async () => {
  const f = feed([[post(1)], [post(1)], [post(1)], [post(1)], [post(1)], [post(9)]]);
  const out = await harvestPosts({ ...f, maxScrolls: 50, maxPosts: 100, stableLimit: 4 });
  assert.equal(out.length, 1);
  assert.equal(f.calls.extract, 5); // 1 productive + 4 empty; post 9 is never reached
});

test('harvestPosts respects maxScrolls', async () => {
  const f = feed([[post(1)], [post(2)], [post(3)], [post(4)]]);
  const out = await harvestPosts({ ...f, maxScrolls: 2, maxPosts: 100 });
  assert.equal(out.length, 2);
  assert.equal(f.calls.advance, 2);
});

test('harvestPosts never runs (and returns nothing) for a non-numeric scroll count', async () => {
  const f = feed([[post(1)]]);
  assert.deepEqual(await harvestPosts({ ...f, maxScrolls: NaN, maxPosts: 100 }), []);
  assert.equal(f.calls.extract, 0);
});

test('harvestPosts caps the result at maxPosts even when one step overshoots', async () => {
  const f = feed([[post(1), post(2), post(3), post(4), post(5)]]);
  const out = await harvestPosts({ ...f, maxScrolls: 5, maxPosts: 3 });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((p) => p.urn), ['urn:li:activity:5', 'urn:li:activity:4', 'urn:li:activity:3']);
});

test('assertExtracted rejects an empty or missing extraction and passes a real one', () => {
  assert.throws(() => assertExtracted([]), /Extracted 0 posts/);
  assert.throws(() => assertExtracted(undefined), /Extracted 0 posts/);
  const posts = [post(1)];
  assert.equal(assertExtracted(posts), posts);
});

test('mergeExport never shrinks the previous export unless replace is asked for', () => {
  const existing = [post(1), post(2), post(3)];
  const fresh = [post(3, '2026-02-01T00:00:00.000Z'), post(4)];
  const merged = mergeExport(existing, fresh);
  assert.equal(merged.length, 4);
  assert.equal(merged.find((p) => p.urn.endsWith(':3')).postedAt, '2026-02-01T00:00:00.000Z'); // fresh wins
  assert.deepEqual(mergeExport(existing, fresh, { replace: true }).map((p) => p.urn).sort(), [
    'urn:li:activity:3',
    'urn:li:activity:4',
  ]);
});

test('mergeExport tolerates a missing or malformed previous export', () => {
  assert.equal(mergeExport(undefined, [post(1)]).length, 1);
  assert.equal(mergeExport({ not: 'an array' }, [post(1)]).length, 1);
  assert.equal(mergeExport([null, {}, post(2)], [post(1)]).length, 2);
});

test('sortNewestFirst puts undated posts last and does not mutate its input', () => {
  const input = [post(1), { urn: 'u', postedAt: '' }, post(5)];
  const out = sortNewestFirst(input);
  assert.deepEqual(out.map((p) => p.urn), ['urn:li:activity:5', 'urn:li:activity:1', 'u']);
  assert.equal(input[0].urn, 'urn:li:activity:1');
});

test('harvestPosts keeps going through repeated short empty stretches (the stop counter resets on progress)', async () => {
  // Two stretches of 3 empty steps (< stableLimit 4), each followed by a new card: a counter
  // that never reset would reach 4 in the second stretch and lose post 3.
  const f = feed([[post(1)], [post(1)], [post(1)], [post(1)], [post(2)], [post(2)], [post(2)], [post(2)], [post(3)]]);
  const out = await harvestPosts({ ...f, maxScrolls: 50, maxPosts: 100, stableLimit: 4 });
  assert.deepEqual(out.map((p) => p.urn).sort(), [1, 2, 3].map((n) => `urn:li:activity:${n}`));
});

test('harvestPosts hands extract the URNs already collected so those cards are not re-opened', async () => {
  const seenArgs = [];
  const pages = [[post(1), post(2)], [post(3)]];
  let step = 0;
  await harvestPosts({
    extract: async (seen) => {
      seenArgs.push([...seen].sort());
      return pages[step] || [];
    },
    advance: async () => {
      step++;
    },
    maxScrolls: 2,
    maxPosts: 100,
  });
  assert.deepEqual(seenArgs, [[], ['urn:li:activity:1', 'urn:li:activity:2']]);
});

test('harvestPosts stops scrolling once maxPosts is reached (the anti-bot cap, not just the output cap)', async () => {
  const f = feed([[post(1), post(2), post(3)], [post(4)], [post(5)]]);
  const out = await harvestPosts({ ...f, maxScrolls: 10, maxPosts: 2 });
  assert.equal(out.length, 2);
  assert.equal(f.calls.extract, 1);
  assert.equal(f.calls.advance, 1);
});

test('readExisting reads a valid export and treats a missing file as empty', () => {
  assert.deepEqual(readExisting('[{"urn":"u"}]'), [{ urn: 'u' }]);
  assert.deepEqual(readExisting(null), []);
  assert.deepEqual(readExisting(undefined), []);
});

test('readExisting FAILS CLOSED on a malformed or non-array export instead of reading it as empty', () => {
  assert.throws(() => readExisting('[{"urn":'), /not valid JSON/);
  assert.throws(() => readExisting('<<<<<<< HEAD'), /not valid JSON/);
  assert.throws(() => readExisting('{"not":"an array"}'), /not a JSON array/);
  assert.throws(() => readExisting('null'), /not a JSON array/);
});

test('readExisting with replace ignores whatever is on disk', () => {
  assert.deepEqual(readExisting('[{"urn":', { replace: true }), []);
  assert.deepEqual(readExisting('{"x":1}', { replace: true }), []);
});
