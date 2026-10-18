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
        if (body.startsWith('#')) {
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

/** A `<` opens a tag only when a name, `/`, `!` or `?` follows it (HTML tokenizer rule). */
const TAG_OPEN = /[a-z/!?]/i;

/** Tags whose end is a text boundary: `<p>a</p><p>b</p>` must read `a b`, not `ab`. */
const BOUNDARY_TAG = /^<(?:br|\/p|\/div|\/li|\/h[1-6])(?![a-z0-9])/i;

/**
 * Remove every tag from `value`, writing `boundary` where a block ended.
 *
 * A single left-to-right scan rather than a `/<[^>]*>/g` replace (CodeQL
 * js/incomplete-multi-character-sanitization): one regex pass over
 * `<scr<script>ipt>` leaves a fresh `<script>` behind, while this scan consumes
 * EVERY tag opener it meets, so its output never contains a `<` followed by a
 * tag-name character. An opener with no closing `>` runs to the end of the
 * input, which is how a browser's tokenizer reads it too. A `<` that cannot
 * open a tag (`a < b`, `<3`) is text and is kept. Linear in the input.
 */
export function stripTags(value: string, boundary = ' '): string {
    let out = '';
    // Removing a tag can butt a kept `<` against text that starts with a
    // tag-name character (`<<b>b>` → `<` + `b>`); such a `<` is dropped
    // as the text arrives, so the invariant holds for the OUTPUT, not just
    // for each piece of the input.
    const append = (text: string) => {
        if (TAG_OPEN.test(text.charAt(0))) {
            let end = out.length;
            while (end > 0 && out[end - 1] === '<') {
                end -= 1;
            }
            out = out.slice(0, end);
        }
        out += text;
    };
    let index = 0;
    while (index < value.length) {
        const open = value.indexOf('<', index);
        if (open === -1) {
            append(value.slice(index));
            break;
        }
        if (!TAG_OPEN.test(value.charAt(open + 1))) {
            append(value.slice(index, open + 1));
            index = open + 1;
            continue;
        }
        append(value.slice(index, open));
        const close = value.indexOf('>', open + 1);
        const end = close === -1 ? value.length : close + 1;
        if (BOUNDARY_TAG.test(value.slice(open, end))) {
            append(boundary);
        }
        index = end;
    }
    return out;
}

/** Markup → readable text: tags dropped, entities decoded, whitespace collapsed. */
export function toPlainText(value: string | null | undefined): string {
    return decodeEntities(stripTags(value ?? '')).replace(/\s+/g, ' ').trim();
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
    return trimTrailingSeparators(cut);
}

/** `before + value` when `value` is non-empty, else `''` — an optional clause of a sentence. */
export function affix(before: string, value: string): string {
    return value ? before + value : '';
}

/** `a` / `an` for an English noun phrase, by its first letter. */
export function indefiniteArticle(phrase: string): 'a' | 'an' {
    return /^[aeiou]/i.test(phrase) ? 'an' : 'a';
}

/**
 * `url` without its trailing slashes. A scan rather than `/\/+$/`, which an
 * engine retries from every slash of a long run (Sonar S8786).
 */
export function trimTrailingSlashes(url: string): string {
    let end = url.length;
    while (end > 0 && url[end - 1] === '/') {
        end -= 1;
    }
    return url.slice(0, end);
}

/** What a word-boundary cut may leave dangling at the end. */
const TRAILING_SEPARATORS = new Set([',', ';', ':', '|', '&', '–', '—', '-']);

/**
 * `value` without its trailing run of whitespace and separators.
 *
 * A scan from the end, not an end-anchored `/[…]+$/` (Sonar S8786): an engine
 * retries such a pattern from every start position inside a long run of the
 * class, which is quadratic in the run length.
 */
function trimTrailingSeparators(value: string): string {
    let end = value.length;
    while (end > 0 && (TRAILING_SEPARATORS.has(value[end - 1]) || value[end - 1].trim() === '')) {
        end -= 1;
    }
    return value.slice(0, end);
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

/**
 * `value` without a trailing `…` / `...` an upstream truncation appended, or
 * `null` when it carries none. String operations rather than an end-anchored
 * `/\s*(…|\.\.\.)\s*$/`, which backtracks over a long whitespace run (Sonar S8786).
 */
function withoutTrailingEllipsis(value: string): string | null {
    const text = value.trimEnd();
    for (const ellipsis of ['…', '...']) {
        if (text.endsWith(ellipsis)) {
            return text.slice(0, -ellipsis.length).trimEnd();
        }
    }
    return null;
}

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
    const stem = withoutTrailingEllipsis(clean);
    if (stem === null) {
        return clean;
    }
    const firstLine = decodeEntities(stripTags(content ?? '', '\n'))
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
