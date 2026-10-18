/**
 * Config-driven `/llms.txt` (#252).
 *
 * `robots.txt` says what an agent MAY read and `sitemap.xml` lists every URL;
 * neither tells an agent WHERE THE ANSWER IS. llms.txt (llmstxt.org) is the
 * curated, markdown entry point for exactly that: a short H1 + summary, then
 * link lists an assistant can follow when a recruiter asks "has this person
 * shipped pgvector in production?".
 *
 * The file is rendered per request by the SSR Express server from the runtime
 * site config (#65) plus the live published-post list — the same seam
 * `sitemap.ts` uses, so a forker's deployment produces a forker's file with no
 * code edits and no rebuild. Every literal in here describes the PRODUCT's own
 * routes; nothing about an owner or a domain is hardcoded.
 *
 * Format (llmstxt.org, v2): an H1 (the only required section), an optional
 * blockquote summary, free prose, then H2-delimited link lists whose items are
 * `- [name](url): notes`.
 */

import type { Profile } from '../services/profile.service';
import {
    API_PREFIX,
    fetchPublishedPosts,
    JsonFetcher,
    RESUME_PATH,
    resolveSiteConfig,
    SitemapPost,
    SsrSiteConfig,
    stripTrailingSlash,
} from './sitemap';
import { decodeEntities, toPlainText, truncateAtWord } from './text';

/**
 * How many posts the blog section names individually.
 *
 * llms.txt is meant to FIT IN CONTEXT — the detail lives behind the links. A
 * blog with hundreds of posts would otherwise turn the entry point into the
 * payload; `/blog` and `sitemap.xml` carry the complete list.
 */
export const LLMS_TXT_MAX_POSTS = 25;

/**
 * The job-search state (#271) rendered as a sentence an assistant can quote.
 * An unknown/absent state yields nothing rather than a guess.
 */
const AVAILABILITY_NOTE: Record<string, string | undefined> = {
    open: 'Actively looking for new opportunities.',
    listening: 'Open to hearing about new opportunities.',
    not_looking: 'Not currently looking for new opportunities.',
};

/**
 * Markdown link-text escaping: an unescaped `]` truncates a link label, and a
 * post title is free text an admin controls.
 *
 * The BACKSLASH is escaped too, and it has to come first in the character
 * class: escaping only the brackets makes the escaping itself forgeable — a
 * title ending in `\` turns the emitted `\]` into `\\]`, which markdown reads
 * as a literal backslash followed by an ACTIVE `]`, closing the label anyway.
 * (`js/incomplete-sanitization`, flagged by CodeQL on the first push of this
 * branch; the round-1 version escaped brackets alone.)
 */
export function escapeMarkdown(value: string): string {
    return value.replace(/([\\[\]])/g, '\\$1');
}

/**
 * One `- [name](url): notes` item.
 *
 * The URL is emitted verbatim, byte-identical to the same post's `<loc>` in
 * `sitemap.xml` — two generated files must not disagree on a page's URL, and
 * percent-encoding here alone would make them disagree (and would double-encode
 * a slug that already carries an escape). Slug hygiene belongs to whoever
 * accepts the slug, not to two independent renderers.
 */
function link(name: string, url: string, notes?: string): string {
    const item = `- [${escapeMarkdown(name)}](${url})`;
    return notes ? `${item}: ${notes}` : item;
}

export function buildLlmsTxt(site: SsrSiteConfig, posts: readonly SitemapPost[]): string {
    const base = stripTrailingSlash(site.siteUrl);
    // The H1 is the ONE required section, so it always resolves to something:
    // the configured site name, else the owner, else the neutral product word
    // (which is also `DEFAULT_SITE_CONFIG.siteName` in the browser app).
    const title = site.siteName || site.ownerName || 'Portfolio';
    const summary = [site.ownerName, site.ownerHeadline].filter(Boolean).join(' — ');

    const lines: string[] = [`# ${title}`, ''];
    if (summary) {
        lines.push(`> ${summary}`, '');
    }
    if (site.ownerDescription) {
        lines.push(site.ownerDescription, '');
    }
    const availability = AVAILABILITY_NOTE[site.availability];
    if (availability) {
        lines.push(`Availability: ${availability}`, '');
    }
    lines.push(
        'The complete profile is available as structured data in a single request — ' +
            'prefer it over parsing the HTML pages below.',
        '',
    );

    lines.push(
        '## Profile',
        '',
        link(
            'Structured profile (JSON Resume v1.0.0)',
            `${base}${RESUME_PATH}`,
            'the whole candidate in one fetch — experience, education, skills, ' +
                'languages, certificates, references, availability and contact route',
        ),
        link(
            'Full profile as Markdown',
            `${base}/llms-full.txt`,
            'summary, experience, skills, certifications, education, languages and recent posts in one file',
        ),
        link('Home', `${base}/`, 'summary, current availability and the contact form'),
        link('CV', `${base}/cv`, 'the rendered CV, filterable by year'),
        link('Contact', `${base}/#contact`, 'how to reach the owner about a role'),
        '',
    );

    lines.push('## Blog', '', link('All posts', `${base}/blog`, 'the complete index'));
    for (const post of posts.slice(0, LLMS_TXT_MAX_POSTS)) {
        lines.push(
            // The publication date (`posted_at ?? created_at`), not the last edit.
            link(post.title || post.slug, `${base}/blog/${post.slug}`, post.published?.slice(0, 10)),
        );
    }
    lines.push('');

    lines.push(
        '## Optional',
        '',
        link('AI assistant', `${base}/llm`, 'ask questions against this profile'),
        link('Sitemap', `${base}/sitemap.xml`, 'every indexable URL'),
        link('Crawler policy', `${base}/robots.txt`, 'what automated clients may read'),
        '',
    );

    return lines.join('\n');
}

export async function renderLlmsTxt(
    fetchJson: JsonFetcher,
    fallbackOrigin: string,
): Promise<string> {
    const [site, posts] = await Promise.all([
        resolveSiteConfig(fetchJson, fallbackOrigin),
        // Bounded at what the file will actually print: one backend request of
        // 25, not four requests of 100 whose surplus is discarded (#252 review,
        // minor 1). `sitemap.xml` still reads every page — it must.
        fetchPublishedPosts(fetchJson, LLMS_TXT_MAX_POSTS),
    ]);
    return buildLlmsTxt(site, posts);
}

/** Path of the expanded companion file (llmstxt.org's `llms-full.txt` convention). */
export const LLMS_FULL_PATH = '/llms-full.txt';
/** How many posts `llms-full.txt` excerpts. */
export const LLMS_FULL_MAX_POSTS = 20;
/** Per-post excerpt bound, in characters of plain text. */
export const LLMS_FULL_EXCERPT = 1500;
/**
 * Whole-file bound. The file is for an assistant's CONTEXT WINDOW; past this
 * the remaining posts are named by link only, and `/blog` has the rest.
 */
export const LLMS_FULL_MAX_CHARS = 60000;

function heading(level: 2 | 3, text: string): string {
    return `${'#'.repeat(level)} ${text.replace(/\s+/g, ' ').trim()}`;
}

/**
 * `/llms-full.txt` — the whole public profile as clean Markdown, plus excerpts
 * of the newest posts, generated from the SAME public profile view and post
 * list the site renders (no field the HTML does not already show).
 *
 * Every section is omitted when its data is absent, so a sparse profile yields
 * a short file rather than empty headings.
 */
export function buildLlmsFullTxt(
    site: SsrSiteConfig,
    profile: Profile | null,
    posts: readonly SitemapPost[],
): string {
    const base = stripTrailingSlash(site.siteUrl);
    const name = toPlainText(profile?.name) || site.ownerName || site.siteName || 'Portfolio';
    const lines: string[] = [`# ${name}`, ''];
    const headline = toPlainText(profile?.headline) || site.ownerHeadline;
    if (headline) {
        lines.push(`> ${headline}`, '');
    }
    const facts = [
        profile?.location ? `- Location: ${toPlainText(profile.location)}` : '',
        AVAILABILITY_NOTE[site.availability] ? `- Availability: ${AVAILABILITY_NOTE[site.availability]}` : '',
        `- Website: ${base}/`,
        `- Structured profile (JSON Resume): ${base}${RESUME_PATH}`,
        `- Contact: ${base}/#contact`,
    ].filter(Boolean);
    lines.push(...facts, '');

    const about = decodeEntities(profile?.about ?? '').trim();
    if (about) {
        lines.push(heading(2, 'Summary'), '', about, '');
    }

    const experience = profile?.experience ?? [];
    if (experience.length) {
        lines.push(heading(2, 'Experience'), '');
        for (const role of experience) {
            const title = [toPlainText(role.title), toPlainText(role.company)].filter(Boolean).join(' — ');
            lines.push(heading(3, title || 'Role'));
            const period = [role.startDate, role.endDate].map((d) => toPlainText(d)).filter(Boolean).join(' – ');
            const meta = [period, toPlainText(role.location)].filter(Boolean).join(' · ');
            if (meta) {
                lines.push('', meta);
            }
            const description = decodeEntities(role.description ?? '').trim();
            if (description) {
                lines.push('', description);
            }
            lines.push('');
        }
    }

    const skills = (profile?.skills ?? []).map((skill) => toPlainText(skill)).filter(Boolean);
    if (skills.length) {
        lines.push(heading(2, 'Skills'), '', skills.join(', '), '');
    }

    const certifications = profile?.certifications ?? [];
    if (certifications.length) {
        lines.push(heading(2, 'Certifications'), '');
        for (const cert of certifications) {
            const date = toPlainText(cert.issueDate ?? cert.date);
            const label = [toPlainText(cert.name), toPlainText(cert.issuer), date].filter(Boolean).join(' — ');
            lines.push(cert.credentialUrl ? link(label, cert.credentialUrl) : `- ${label}`);
        }
        lines.push('');
    }

    const education = profile?.education ?? [];
    if (education.length) {
        lines.push(heading(2, 'Education'), '');
        for (const entry of education) {
            lines.push(`- ${[entry.school, entry.degree, entry.years].map((v) => toPlainText(v)).filter(Boolean).join(' — ')}`);
        }
        lines.push('');
    }

    const languages = profile?.languages ?? [];
    if (languages.length) {
        lines.push(heading(2, 'Languages'), '');
        for (const language of languages) {
            lines.push(`- ${[language.name, language.proficiency].map((v) => toPlainText(v)).filter(Boolean).join(' — ')}`);
        }
        lines.push('');
    }

    if (posts.length) {
        lines.push(heading(2, 'Recent posts'), '');
        for (const post of posts.slice(0, LLMS_FULL_MAX_POSTS)) {
            const url = `${base}/blog/${post.slug}`;
            const title = post.title || post.slug;
            const excerpt = truncateAtWord(toPlainText(post.content || post.summary), LLMS_FULL_EXCERPT);
            const block = [
                heading(3, title),
                '',
                [post.published?.slice(0, 10), post.language, url].filter(Boolean).join(' · '),
                ...(excerpt ? ['', excerpt] : []),
                '',
            ];
            if (lines.join('\n').length + block.join('\n').length > LLMS_FULL_MAX_CHARS) {
                lines.push(link(title, url, post.published?.slice(0, 10)));
                continue;
            }
            lines.push(...block);
        }
        lines.push(link('All posts', `${base}/blog`, 'the complete index'), '');
    }

    return lines.join('\n');
}

/** The active public profile (English), or null — the file still renders. */
async function fetchProfile(fetchJson: JsonFetcher): Promise<Profile | null> {
    try {
        return ((await fetchJson(`${API_PREFIX}/profile?lang=en`)) as Profile | null) ?? null;
    } catch {
        return null;
    }
}

export async function renderLlmsFullTxt(
    fetchJson: JsonFetcher,
    fallbackOrigin: string,
): Promise<string> {
    const [site, profile, posts] = await Promise.all([
        resolveSiteConfig(fetchJson, fallbackOrigin),
        fetchProfile(fetchJson),
        fetchPublishedPosts(fetchJson, LLMS_FULL_MAX_POSTS),
    ]);
    return buildLlmsFullTxt(site, profile, posts);
}
