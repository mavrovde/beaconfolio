/**
 * Plain-text primitives every SEO builder shares.
 *
 * Pure and platform-free on purpose: the same functions run in the browser, in
 * the SSR render and in the Express handlers (`sitemap.ts`, `llms-txt.ts`), so
 * none of them may touch `DOMParser` or any other browser global.
 */

/** The named entities a scraped or hand-written profile actually carries. */
const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
};

const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

function decodeOnce(value: string): string {
    return value.replace(ENTITY, (match, body: string) => {
        if (body[0] === '#') {
            const hex = body[1] === 'x' || body[1] === 'X';
            const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
            // An out-of-range code point would make fromCodePoint throw; such a
            // reference is not text, so it is left exactly as written.
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
}

/**
 * Turn HTML character references back into the characters they stand for.
 *
 * WHY this exists: the LinkedIn profile text reaches the app already
 * HTML-escaped (`Engineer &amp; Architect`). Angular's `Meta` service escapes
 * attribute values once more on serialization, so the live head read
 * `&amp;amp;` and every interpolation showed a literal `&amp;` to visitors.
 * Text in this app is TEXT — the renderer does the escaping — so a stored
 * reference is decoded back to its character at the boundary.
 *
 * Two passes, not one: a value that was escaped twice upstream
 * (`&amp;amp;`) decodes to `&` rather than to the still-escaped `&amp;`.
 * Bounded at two so a string that genuinely talks ABOUT entities keeps one
 * level of them.
 */
export function decodeEntities(value: string): string {
    return decodeOnce(decodeOnce(value));
}

/** Markup → readable text: tags dropped, entities decoded, whitespace collapsed. */
export function toPlainText(value: string | null | undefined): string {
    const withoutTags = (value ?? '')
        // Block-level boundaries become spaces so `<p>a</p><p>b</p>` is `a b`.
        .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, ' ')
        .replace(/<[^>]*>/g, '');
    return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

/**
 * Cut `value` to at most `max` characters, at a WORD boundary, with no
 * ellipsis appended — a search snippet or a `<title>` with a trailing `…`
 * reads as broken, and engines add their own when they truncate.
 *
 * Trailing separators left by the cut (`,` `;` `:` `-` `|` `&`) are dropped
 * so the result never ends mid-clause. A single word longer than `max` is the
 * one case that has no boundary to cut at; it is hard-cut.
 */
export function truncateAtWord(value: string, max: number): string {
    const text = value.trim();
    if (text.length <= max) {
        return text;
    }
    const slice = text.slice(0, max + 1);
    const lastSpace = slice.lastIndexOf(' ');
    const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : text.slice(0, max);
    return cut.replace(/[\s,;:|&–—-]+$/u, '');
}

/**
 * A meta description: plain text, at most `max` characters.
 *
 * When a sentence ends inside the last third of the window the cut is made
 * there — a complete sentence is a better snippet than a longer fragment.
 * Otherwise it falls back to a word boundary.
 */
export function toMetaDescription(value: string | null | undefined, max = 155): string {
    const text = toPlainText(value);
    if (text.length <= max) {
        return text;
    }
    const window = text.slice(0, max + 1);
    const sentenceEnd = Math.max(
        window.lastIndexOf('. '),
        window.lastIndexOf('! '),
        window.lastIndexOf('? '),
    );
    if (sentenceEnd >= Math.floor((max * 2) / 3)) {
        return window.slice(0, sentenceEnd + 1);
    }
    return truncateAtWord(text, max);
}

/** A trailing `…` / `...` an upstream truncation appended, if any. */
const TRAILING_ELLIPSIS = /\s*(…|\.\.\.)\s*$/u;

/**
 * The headline a post actually has, given the title the API stored.
 *
 * The LinkedIn importer derives a post title from the first line of the post
 * and cuts it with `…` (live: "Are Heavy Frameworks Still the Default Choice
 * in the AI…"). When the content starts with that very text, the full first
 * line is recovered from the content; otherwise the title is returned without
 * the dangling ellipsis. Either way, nothing downstream emits a `…` it did not
 * write itself.
 */
export function fullPostTitle(title: string, content?: string | null): string {
    const clean = toPlainText(title);
    if (!TRAILING_ELLIPSIS.test(clean)) {
        return clean;
    }
    const stem = clean.replace(TRAILING_ELLIPSIS, '');
    const firstLine = decodeEntities(
        (content ?? '')
            .replace(/<\s*(br|\/p|\/div|\/h[1-6])\b[^>]*>/gi, '\n')
            .replace(/<[^>]*>/g, ''),
    )
        .trim()
        .split('\n')[0]
        .replace(/\s+/g, ' ')
        .trim();
    if (!stem || !firstLine.startsWith(stem)) {
        return stem;
    }
    // A post written as one long paragraph has no line break to stop at, so
    // the recovered headline also ends at the first sentence after the stem.
    const rest = firstLine.slice(stem.length);
    const sentence = /^.*?[.!?](?=\s|$)/u.exec(rest);
    const headline = sentence ? stem + sentence[0] : firstLine;
    return truncateAtWord(headline, MAX_RECOVERED_TITLE);
}

/** Upper bound on a recovered headline (Google truncates `headline` at 110). */
export const MAX_RECOVERED_TITLE = 110;
