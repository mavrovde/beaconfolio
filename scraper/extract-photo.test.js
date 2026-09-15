// Unit tests for the avatar-URL extraction (#333/#422). Run: `npm test`.
// No live LinkedIn, no network — voyager-SHAPED fixtures only: the entity
// shapes below mirror the two places the voyager payload carries the avatar
// (profilePicture.displayImageReference.vectorImage on current payloads,
// profilePicture.displayImage.vectorImage on older ones). A LIVE payload run
// still needs an authenticated session (documented in WORKFLOW.md) — what
// these pin is the selection logic and every malformed-entity fallthrough,
// which is the part a payload drift would break silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractPhotoUrl } from './extract-photo.js';

const ROOT = 'https://media.licdn.com/dms/image/v2/D4D03AQF/';
const ARTIFACTS = [
  { width: 100, fileIdentifyingUrlPathSegment: 'profile-displayphoto-scale_100_100/0/1' },
  { width: 800, fileIdentifyingUrlPathSegment: 'profile-displayphoto-scale_800_800/0/1' },
  { width: 400, fileIdentifyingUrlPathSegment: 'profile-displayphoto-scale_400_400/0/1' },
];

test('picks the LARGEST artifact from displayImageReference (current shape)', () => {
  const url = extractPhotoUrl([
    { otherEntity: true },
    {
      profilePicture: {
        displayImageReference: { vectorImage: { rootUrl: ROOT, artifacts: ARTIFACTS } },
      },
    },
  ]);
  assert.equal(url, ROOT + 'profile-displayphoto-scale_800_800/0/1');
});

test('falls back to the older displayImage shape', () => {
  const url = extractPhotoUrl([
    {
      profilePicture: {
        displayImage: { vectorImage: { rootUrl: ROOT, artifacts: [ARTIFACTS[0]] } },
      },
    },
  ]);
  assert.equal(url, ROOT + 'profile-displayphoto-scale_100_100/0/1');
});

test('returns null when no entity carries an avatar', () => {
  assert.equal(extractPhotoUrl([{ a: 1 }, { profilePicture: {} }]), null);
  assert.equal(extractPhotoUrl([]), null);
});

test('returns null on malformed vectorImages instead of throwing', () => {
  // Each case is one broken invariant: no rootUrl, artifacts not an array,
  // empty artifacts, artifact without a path segment. A payload drift lands
  // here as a clean null (the scraper logs "no avatar"), never a crash.
  assert.equal(extractPhotoUrl([
    { profilePicture: { displayImageReference: { vectorImage: { artifacts: ARTIFACTS } } } },
  ]), null);
  assert.equal(extractPhotoUrl([
    { profilePicture: { displayImageReference: { vectorImage: { rootUrl: ROOT, artifacts: 'nope' } } } },
  ]), null);
  assert.equal(extractPhotoUrl([
    { profilePicture: { displayImageReference: { vectorImage: { rootUrl: ROOT, artifacts: [] } } } },
  ]), null);
  assert.equal(extractPhotoUrl([
    { profilePicture: { displayImageReference: { vectorImage: { rootUrl: ROOT, artifacts: [{ width: 9 }] } } } },
  ]), null);
});

test('artifacts without width sort as 0 and never beat a sized one', () => {
  const url = extractPhotoUrl([
    {
      profilePicture: {
        displayImageReference: {
          vectorImage: {
            rootUrl: ROOT,
            artifacts: [
              { fileIdentifyingUrlPathSegment: 'unsized/0/1' },
              { width: 200, fileIdentifyingUrlPathSegment: 'sized_200/0/1' },
            ],
          },
        },
      },
    },
  ]);
  assert.equal(url, ROOT + 'sized_200/0/1');
});

test('first avatar-bearing entity wins across a mixed included list', () => {
  const url = extractPhotoUrl([
    { profilePicture: { displayImageReference: { vectorImage: { rootUrl: ROOT, artifacts: [] } } } },
    { profilePicture: { displayImage: { vectorImage: { rootUrl: ROOT, artifacts: [ARTIFACTS[2]] } } } },
    { profilePicture: { displayImage: { vectorImage: { rootUrl: 'https://other/', artifacts: [ARTIFACTS[1]] } } } },
  ]);
  assert.equal(url, ROOT + 'profile-displayphoto-scale_400_400/0/1');
});
