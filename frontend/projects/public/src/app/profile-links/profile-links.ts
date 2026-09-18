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
 * Derive the display label for a host nobody registered — `git.example.co.uk`
 * becomes `EXAMPLE`. Takes the registrable label rather than the whole
 * hostname, because `GIT.EXAMPLE.CO.UK` is noise in a terminal prompt.
 */
function deriveLabel(hostname: string): string {
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length <= 1) {
        return hostname;
    }
    // Drop a two-part public suffix (co.uk, com.br) when there is still a name
    // left to show; otherwise drop one.
    const tail = parts.length >= 3 && parts[parts.length - 2].length <= 3 ? 2 : 1;
    return parts[Math.max(parts.length - tail - 1, 0)];
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
        if (typeof raw !== 'string' || !raw.trim()) {
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
