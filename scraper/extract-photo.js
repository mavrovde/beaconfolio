// Pure avatar-URL extraction from the voyager profile payload (#333).
// Split out of scrape-linkedin.js so it is unit-testable without a live
// LinkedIn session (#422 review round 1, finding 2) — same pattern as
// parse-post.js. LinkedIn carries the avatar as a vectorImage
// (rootUrl + per-size artifacts); take the largest.
export function extractPhotoUrl(included) {
  for (const e of included) {
    const vec =
      (e.profilePicture && e.profilePicture.displayImageReference && e.profilePicture.displayImageReference.vectorImage) ||
      (e.profilePicture && e.profilePicture.displayImage && e.profilePicture.displayImage.vectorImage);
    if (vec && vec.rootUrl && Array.isArray(vec.artifacts) && vec.artifacts.length) {
      const best = [...vec.artifacts].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
      if (best && best.fileIdentifyingUrlPathSegment) {
        return vec.rootUrl + best.fileIdentifyingUrlPathSegment;
      }
    }
  }
  return null;
}
