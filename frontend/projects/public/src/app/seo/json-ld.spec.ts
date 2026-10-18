import { describe, it, expect } from 'vitest';
import { jsonForScriptBlock } from './json-ld';

/**
 * JSON-LD is embedded in a `<script>` ELEMENT, so the HTML parser — not the
 * JSON parser — decides where it ends. Flagged as `typescript:S6268` by the
 * v1.16.0 release security triage, and confirmed by measurement before the
 * fix: `JSON.stringify` leaves `<` alone, so a value containing `</script>`
 * closed the block early and the rest was parsed as markup.
 */
describe('JSON-LD script-block serialization (release security triage)', () => {
  const HOSTILE = { '@type': 'BlogPosting', headline: 'Post </scr' + 'ipt><img src=x onerror=alert(1)>' };

  it('escapes `<` so a value cannot close the script element', () => {
    const serialized = jsonForScriptBlock(HOSTILE);

    // The literal the HTML parser looks for. Asserted as a split string so
    // this file cannot close its own element either.
    expect(serialized).not.toContain('</scr' + 'ipt>');
    expect(serialized).toContain('\\u003c');
  });

  // The escape is free ONLY if it is lossless — `\u003c` is a valid
  // JSON escape for `<`, so the consumer sees exactly what it saw before. Without
  // this, "escape it" could silently corrupt the structured data Google reads.
  it('round-trips to a byte-identical object', () => {
    expect(JSON.parse(jsonForScriptBlock(HOSTILE))).toEqual(HOSTILE);
    expect(JSON.parse(jsonForScriptBlock(HOSTILE)).headline).toBe(HOSTILE.headline);
  });

  // The mutant that survived round 1 of this PR's own mutation check: a fix
  // narrowed to the literal closing tag passes every other case here and is
  // still unsafe. `<!--` is the tokenizer's SECOND door out of script-data
  // state — a following `<script` opens a comment-escape state that swallows
  // the markup after it — so the guard is on the CHARACTER, not on the tag.
  it('escapes the `<` that opens a comment-escape state, not only a closing tag', () => {
    const serialized = jsonForScriptBlock({ headline: 'a <!--<scr' + 'ipt> b' });

    expect(serialized).not.toContain('<');
    expect(JSON.parse(serialized).headline).toBe('a <!--<scr' + 'ipt> b');
  });

  // The assertion the rule-12 table claims makes a browser tier unnecessary.
  // Counting a substring in the PRE-PARSE string is a proxy; this parses the
  // block the way the browser does and asserts the element actually contains
  // the whole payload and nothing escaped it. `vitest.config.ts` already runs
  // this project in jsdom, so the real tokenizer is free here.
  it.each([
    ['a closing tag', 'Post </scr' + 'ipt><img src=x onerror=alert(1)>'],
    ['a comment-escape opener', 'Post <!--<scr' + 'ipt> swallowed?'],
  ])('survives parsing as real HTML when the headline carries %s', (_label, headline) => {
    const host = document.createElement('div');
    host.innerHTML =
      '<script type="application/ld+json">' +
      jsonForScriptBlock({ '@type': 'BlogPosting', headline }) +
      '</scr' + 'ipt><p id="after">after</p>';

    // ORDER MATTERS, and review round 2 of #458 is why. The structural
    // assertions come FIRST because a breakout makes `blocks[0].textContent`
    // unparseable: put the `JSON.parse` above them and every failing cell dies
    // on a `SyntaxError` two lines before reaching the assertion that states
    // this PR's actual claim, so the case can never report what it documents.
    const blocks = host.querySelectorAll('script[type="application/ld+json"]');
    expect(host.querySelector('img'), 'no element may be built from the schema').toBeNull();

    // The markup AFTER the block is still there — this is what the
    // comment-escape door destroys when `<!--` is left unescaped.
    expect(host.querySelector('#after')?.textContent).toBe('after');
    expect(blocks, 'the schema must not open a second block').toHaveLength(1);

    // …and only now, on a block we have shown is intact, the payload itself.
    expect(JSON.parse(blocks[0].textContent ?? '').headline).toBe(headline);
  });

  it('leaves a schema with no `<` untouched apart from formatting', () => {
    const plain = { '@context': 'https://schema.org' };

    expect(jsonForScriptBlock(plain)).toBe(JSON.stringify(plain, null, 2));
  });

});
