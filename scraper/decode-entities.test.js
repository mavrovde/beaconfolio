// Unit tests for the profile export's entity decoding. No browser, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeEntities, decodeDeep } from './decode-entities.js';

test('decodes the named entities LinkedIn emits', () => {
  assert.equal(decodeEntities('Engineer &amp; Architect'), 'Engineer & Architect');
  assert.equal(decodeEntities('&lt;b&gt; &quot;q&quot; &apos;a&apos;'), '<b> "q" \'a\'');
  assert.equal(decodeEntities('A&nbsp;B'), 'A B');
  assert.equal(decodeEntities('&AMP;'), '&');
});

test('decodes numeric entities', () => {
  assert.equal(decodeEntities('it&#39;s &#x2014; &#X1F680;'), "it's — \u{1F680}");
});

test('decodes in ONE pass, never twice', () => {
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeEntities('&amp;amp;'), '&amp;');
});

test('leaves unknown names, invalid code points and bare ampersands alone', () => {
  for (const text of ['&bogus;', '&#0;', '&#xD800;', '&#9999999;', 'R&D', 'a & b', '&amp']) {
    assert.equal(decodeEntities(text), text);
  }
});

test('decodeDeep decodes every string and keeps the shape', () => {
  const input = {
    about: 'A &amp; B',
    certifications: [{ name: 'X &amp; Y', issueDate: 'Sep 2026', n: 3, ok: true, none: null }],
    skills: ['C&amp;C'],
  };
  assert.deepEqual(decodeDeep(input), {
    about: 'A & B',
    certifications: [{ name: 'X & Y', issueDate: 'Sep 2026', n: 3, ok: true, none: null }],
    skills: ['C&C'],
  });
  assert.equal(input.about, 'A &amp; B', 'input is not mutated');
});
