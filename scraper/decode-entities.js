// LinkedIn's Voyager API returns some profile text HTML-escaped ("Engineer
// &amp; Architect"). The site renders text through Angular interpolation, which
// escapes again, so a visitor saw a literal "&amp;". Decode once, before the
// export is written, so every consumer gets plain text.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// ONE pass over the string: "&amp;lt;" decodes to the text "&lt;", never "<".
const ENTITY = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi;

export function decodeEntities(text) {
  return text.replace(ENTITY, (match, dec, hex, name) => {
    if (name !== undefined) {
      const named = NAMED[name.toLowerCase()];
      return named === undefined ? match : named;
    }
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    // Out-of-range or surrogate code points are not characters: keep the text.
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || code === 0) return match;
    return String.fromCodePoint(code);
  });
}

// Every string anywhere in an export, recursively; other values untouched.
export function decodeDeep(value) {
  if (typeof value === 'string') return decodeEntities(value);
  if (Array.isArray(value)) return value.map(decodeDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeDeep(v)]));
  }
  return value;
}
