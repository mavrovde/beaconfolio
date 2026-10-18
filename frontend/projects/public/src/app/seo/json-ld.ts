/**
 * Serialize a JSON-LD schema for embedding inside a `<script>` ELEMENT.
 *
 * `JSON.stringify` escapes what JSON needs escaped; it does not escape `<`,
 * because `<` is a perfectly ordinary character in a JSON string. Inside a
 * `<script>` block it is not: the HTML parser ends the element at the first
 * `</script>` it sees, wherever that sits — inside a quoted string included.
 * So a post title reading `</script><img src=x onerror=…>` closes the JSON-LD
 * block early and everything after it is parsed as markup.
 *
 * Measured before this was written, on the real serializer:
 *
 *     JSON.stringify({ headline: 'Post </script><img src=x onerror=alert(1)>' })
 *       // → the rendered block contains a literal </script>: breaks out
 *
 * `\u003c` is a valid JSON escape for `<`, so escaping it costs nothing —
 * `JSON.parse` yields a byte-identical object, verified in the spec — and it
 * is the one character that has to go. Nothing here is exploitable by an
 * untrusted party today: every writer on this path is authenticated (the admin
 * SPA, or the token-gated LinkedIn importer). This is the cheap half of
 * defence in depth, taken while it is still cheap, so that the day some
 * unauthenticated text reaches post content this is not also true.
 *
 * EVERY `<` is escaped, not just the ones that begin a closing tag — and
 * that is not belt-and-braces. The HTML tokenizer leaves script-data
 * state through `<` by TWO doors: `</` ends the element, and `<!--`
 * opens a comment-escape state in which a following `<script` swallows
 * the markup after it. A fix narrowed to the literal `</script>` passes
 * every test in the spec beside this file and still loses the document
 * to a headline reading `<!--<script>`. Escaping the one character both
 * doors need closes both.
 *
 * Flagged as `typescript:S6268` by the v1.16.0 release security triage. The
 * rule fires on every `bypassSecurityTrust*` call; here it was right. Since
 * then the block is no longer built as an HTML string at all: `SeoService`
 * writes this text into a `<script>` element's `textContent`, so no sanitizer
 * bypass exists — but the escape is still REQUIRED, because the server
 * serializes a script's text verbatim and the browser's HTML parser reads it
 * back with exactly the two doors described above.
 */
export function jsonForScriptBlock(schema: unknown): string {
  return JSON.stringify(schema, null, 2).replaceAll('<', String.raw`\u003c`);
}
