// Unit tests for the pure post-parsing helpers (spec 05). Run: `npm test`.
// No live LinkedIn, no network — fixtures only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePost,
  activityIdFromUrn,
  postedAtFromActivityId,
  cleanImageUrls,
  detectLanguage,
  urlFromActivityId,
} from './parse-post.js';

const REAL_URN = 'urn:li:activity:7434116504088055808';
const PROFILE_PHOTO =
  'https://media.licdn.com/dms/image/v2/D4D03AQF/profile-displayphoto-scale_100_100/0/1765046503283';
const POST_IMAGE =
  'https://media.licdn.com/dms/image/v2/D4D22AQF/feedshare-shrink_800/0/realpost.jpg';

test('parsePost captures the post image, NOT the profile photo', () => {
  const post = parsePost({
    urn: REAL_URN,
    content: 'The AI Paradox in Engineering Culture — a longer post body.',
    authorImageUrl: PROFILE_PHOTO,
    imageCandidates: [PROFILE_PHOTO, POST_IMAGE], // profile photo first (the old bug)
    time: '2 days ago • Edited',
  });
  assert.equal(post.imageUrls[0], POST_IMAGE);
  assert.ok(!post.imageUrls.some((u) => u.includes('profile-displayphoto')));
  assert.equal(post.imageUrl, POST_IMAGE);
  assert.equal(post.urn, REAL_URN);
  assert.equal(
    post.url,
    'https://www.linkedin.com/feed/update/urn:li:activity:7434116504088055808/',
  );
  assert.match(post.postedAt, /^20\d\d-\d\d-\d\dT/); // ISO date derived from the urn
  assert.equal(post.time, '2 days ago • Edited');
});

test('parsePost returns null when there is no real content', () => {
  assert.equal(parsePost({ urn: REAL_URN, content: '' }), null);
  assert.equal(parsePost({ urn: REAL_URN, content: '   ' }), null);
});

test('parsePost tolerates a missing/odd urn', () => {
  const post = parsePost({ urn: '', content: 'Some content here', imageCandidates: [] });
  assert.equal(post.url, null);
  assert.equal(post.postedAt, null);
  assert.equal(post.imageUrl, null);
});

test('activityIdFromUrn handles activity, ugcPost and bare ids', () => {
  assert.equal(activityIdFromUrn(REAL_URN), '7434116504088055808');
  assert.equal(activityIdFromUrn('urn:li:ugcPost:123'), '123');
  assert.equal(activityIdFromUrn('urn:li:share:xyz'), null);
  assert.equal(activityIdFromUrn(null), null);
});

test('postedAtFromActivityId decodes the embedded timestamp', () => {
  const iso = postedAtFromActivityId('7434116504088055808');
  assert.match(iso, /^20\d\d-/);
  assert.equal(postedAtFromActivityId('not-a-number'), null);
  assert.equal(postedAtFromActivityId(null), null);
});

test('urlFromActivityId', () => {
  assert.equal(urlFromActivityId(null), null);
  assert.ok(urlFromActivityId('123').endsWith('urn:li:activity:123/'));
});

test('cleanImageUrls drops avatars + non-http + dupes, preserves order', () => {
  assert.deepEqual(
    cleanImageUrls([PROFILE_PHOTO, POST_IMAGE, POST_IMAGE, '', 'data:x', null], PROFILE_PHOTO),
    [POST_IMAGE],
  );
});

test('detectLanguage', () => {
  assert.equal(detectLanguage('Das ist für alle nicht schön und gut'), 'de');
  assert.equal(detectLanguage('This is an English post about engineering'), 'en');
  assert.equal(detectLanguage(''), 'en');
});

// The real shapes the old single-hit heuristic tagged "de": one isolated
// German-looking token inside an English post. Mirrors importer/tests.
test('detectLanguage keeps English posts with an isolated German token English', () => {
  for (const text of [
    'Today we honor Margaret Hamilton. As director of the Software Engineering ' +
      'Division of the MIT Instrumentation Lab for Apollo, she coined the term.',
    "What if the interface to Germany's transport data was simply a conversation? " +
      'Ask "Cheapest E10 in Köln?" and it is ranked by price.',
    'Aachen, AI, and the systems we underestimate. The plaque read: Karl der Große. ' +
      'With my German at the time, my only idea was that it is old.',
    'Hyped consumer apps are born and die by the hundreds, but cloud bills and the ' +
      'people who pay them remain with us for years.',
    'Proud to announce: Wir sind jetzt auch in Köln! The team and I are excited to ' +
      'be there for you.',
  ]) {
    assert.equal(detectLanguage(text), 'en', text);
    assert.equal(detectLanguage(text, 'de'), 'en', text);
  }
});

test('detectLanguage still detects genuine German and defaults on thin evidence', () => {
  assert.equal(detectLanguage('Ich freue mich sehr!'), 'de');
  assert.equal(
    detectLanguage('Große Neuigkeiten: wir sind jetzt auch in Köln und München vertreten.'),
    'de',
  );
  for (const text of [
    'Ich bin hier',
    'Köln',
    'Kubernetes Terraform Grafana und',
    'Kubernetes, Terraform, Grafana, Prometheus, Ansible, Docker, Helm, ArgoCD, Vault, ' +
      'Consul, Nomad, Packer, Jenkins, Gradle, Maven, Spark, Kafka, Flink, Redis, ' +
      'Postgres und Elastic und Kibana',
  ]) {
    assert.equal(detectLanguage(text, 'xx'), 'xx', text);
  }
});
