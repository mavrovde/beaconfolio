/**
 * Code-host / social profile links (#93), derived from the ONE runtime list the
 * site already carries: `SOCIAL_LINKS` → site config `socialLinks[]` (#65).
 *
 * ## Why this derives rather than adding a second config knob
 *
 * `socialLinks` is already the site's identity-link list — it is what
 * `person-schema.ts:161` emits as `Person.sameAs`. A parallel `codeHosts` knob
 * would mean two lists that have to agree, and the thing this repo's
 * retrospectives say most often is that two copies of one fact drift. A forker
 * adds a host by adding a URL, and it appears in the UI *and* in the structured
 * data, because both read the same array.
 *
 * ## Extensibility without an allowlist
 *
 * An unknown host is NOT dropped — it renders with a label derived from its own
 * domain and the default glyph. Adding Codeberg, SourceHut or a self-hosted
 * GitLab is therefore a config edit and nothing else, which is the acceptance
 * criterion. The registry below only makes KNOWN hosts prettier.
 */

export interface ProfileLink {
    /** Display name, upper-cased for the terminal prompt (e.g. `GITHUB`). */
    platform: string;
    /** The absolute URL, guaranteed http(s). */
    url: string;
    /** A short text glyph — this app renders no SVG and loads no icon font. */
    icon: string;
}

/** Known hosts get a curated label and glyph; everything else is derived. */
const REGISTRY: Readonly<Record<string, { platform: string; icon: string }>> = {
    'github.com': { platform: 'GitHub', icon: '⌥' },
    'gitlab.com': { platform: 'GitLab', icon: '⌁' },
    'bitbucket.org': { platform: 'Bitbucket', icon: '⌆' },
    'codeberg.org': { platform: 'Codeberg', icon: '⌇' },
    'sr.ht': { platform: 'SourceHut', icon: '⌐' },
    // SourceHut splits its services across hosts: a profile lives on `sr.ht`
    // but the repository people actually link to is on `git.sr.ht`, which is a
    // separate hostname and so a separate registry key. Without this row the
    // CHANGELOG's claim that SourceHut is curated holds for one of the two URLs
    // a SourceHut user is likely to configure (review finding 3).
    'git.sr.ht': { platform: 'SourceHut', icon: '⌐' },
    'dev.azure.com': { platform: 'Azure DevOps', icon: '⌂' },
    'linkedin.com': { platform: 'LinkedIn', icon: '§' },
    'stackoverflow.com': { platform: 'Stack Overflow', icon: '¶' },
    'x.com': { platform: 'X', icon: '×' },
    'twitter.com': { platform: 'X', icon: '×' },
    'mastodon.social': { platform: 'Mastodon', icon: '∴' },
};

/**
 * The glyph an unregistered host gets. Deliberately not empty: a blank cell
 * reads as a rendering bug, a generic marker reads as "a link".
 */
export const DEFAULT_ICON = '›';

/**
 * The second-level labels that are PUBLIC SUFFIXES rather than names, under a
 * country-code TLD: `example.co.uk` is registered at `example`, not at `co`.
 *
 * This is deliberately a small list and not a length test. The obvious
 * shortcut — "a second-to-last label of three characters or fewer is a
 * suffix" — is wrong on ordinary hosts and was caught in review: it reads
 * `code.bbc.com` as BBC's public suffix and labels the link CODE instead of
 * BBC, does the same to `git.abc.com`, and turns SourceHut's real git host
 * `git.zz.ht` into GIT rather than ZZ. A full Public Suffix List is ~10k
 * entries and a dependency; these seven cover the ccTLD shapes a portfolio's
 * links realistically use, and anything outside them degrades to dropping one
 * label, which is the same answer the length test gave for `github.com`.
 */
const CCTLD_SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ac', 'gov', 'edu']);

/**
 * Derive the display label for a host nobody registered — `git.example.co.uk`
 * becomes `EXAMPLE`. Takes the registrable label rather than the whole
 * hostname, because `GIT.EXAMPLE.CO.UK` is noise in a terminal prompt.
 */
function deriveLabel(hostname: string): string {
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length <= 1) {
        return hostname;
    }
    // Drop a two-part public suffix (`co.uk`, `com.br`) only when the LAST
    // label is a ccTLD — a two-character TLD — and the one before it is a
    // known suffix. `code.bbc.com` fails on the first test, `git.zz.ht` on the
    // second, and both keep their real registrable label.
    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    const dropsTwo =
        parts.length >= 3 && last.length === 2 && CCTLD_SECOND_LEVEL.has(secondLast);
    // No floor needed: `dropsTwo` already requires three labels, so the index
    // is 0 at worst. An unreachable `Math.max(..., 0)` here advertised an edge
    // case that does not exist (review nit 4).
    return dropsTwo ? parts[parts.length - 3] : parts[parts.length - 2];
}

/**
 * Project the configured URL list onto typed, renderable links.
 *
 * Anything that is not an absolute `http(s)` URL is DROPPED, not escaped. The
 * value is owner-controlled config, but it lands in an `[href]`, and
 * `javascript:` in an href is the oldest XSS there is — a config value must
 * never be able to become script. Angular's sanitizer is the second line here,
 * not the first.
 */
export function toProfileLinks(urls: readonly string[] | undefined): ProfileLink[] {
    if (!urls?.length) {
        return [];
    }
    const links: ProfileLink[] = [];
    // `SOCIAL_LINKS` is a comma-separated env var, so a copy-paste duplicate is
    // an ordinary operator slip — and the template tracks `@for` by `link.url`,
    // where a repeated key is a reconciliation bug, not just a repeated row.
    const seen = new Set<string>();
    for (const raw of urls) {
        // `typeof` only. A `!raw.trim()` blank-check was here and it was
        // UNREACHABLE as behavior: `new URL('   ')` throws, so the catch below
        // already drops a blank entry, and deleting the check left the whole
        // suite green. The typeof guard is a different matter and stays — a
        // non-string member whose `toString()` yields a valid URL would
        // otherwise be coerced into a rendered link by the parser.
        if (typeof raw !== 'string') {
            continue;
        }
        let parsed: URL;
        try {
            parsed = new URL(raw.trim());
        } catch {
            continue;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            continue;
        }
        const normalized = parsed.toString();
        if (seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
        const known = REGISTRY[host];
        links.push({
            platform: (known?.platform ?? deriveLabel(host)).toUpperCase(),
            url: normalized,
            icon: known?.icon ?? DEFAULT_ICON,
        });
    }
    return links;
}
