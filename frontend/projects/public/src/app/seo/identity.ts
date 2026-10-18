import { decodeEntities, toPlainText, truncateAtWord } from './text';

/**
 * The owner's search identity — title, description, keywords, short role —
 * COMPOSED from configured data, never written down (#71, template product).
 *
 * Every function here is pure. The inputs are the two runtime sources a
 * deployment controls: the profile data (name, headline, location, about,
 * skills — uploaded through the admin panel) and the site config (availability
 * and the optional `seo_*` overrides — env vars on the backend). A forker's
 * data therefore produces a forker's titles with no code edit, and nothing in
 * this file names a person, a place or an employer.
 */

/** Google shows roughly 60 characters of a `<title>` before cutting it. */
export const MAX_TITLE_LENGTH = 60;
/** Snippet length that survives Google's and Bing's display cut. */
export const MAX_DESCRIPTION_LENGTH = 155;
/** How many skills reach `knowsAbout` / `hasOccupation.skills`. */
export const MAX_SCHEMA_SKILLS = 25;
/** How many skills reach the `keywords` meta. */
export const MAX_KEYWORD_SKILLS = 8;

export interface IdentityInput {
    name: string;
    headline?: string;
    location?: string;
    about?: string;
    skills?: string[];
    /** 'open' | 'listening' | 'not_looking' (#271). */
    availability?: string;
    /** UI language of the render; selects the sentence templates. */
    lang?: string;
}

/** Optional per-deployment overrides from the site config. Empty = compose. */
export interface IdentityOverrides {
    seoTitle?: string;
    seoDescription?: string;
    seoKeywords?: string;
}

/**
 * Words that mark a headline segment as a ROLE rather than a skill list.
 * English and German, because the bundled demo profiles ship both; matched as
 * whole words, case-insensitively.
 */
const ROLE_WORDS =
    /\b(engineer|architect|developer|programmer|manager|lead|leader|consultant|scientist|designer|analyst|administrator|specialist|researcher|founder|co-founder|director|head|officer|owner|cto|ceo|cio|vp|freelancer|contractor|entwickler(in)?|ingenieur(in)?|architekt(in)?|berater(in)?|leiter(in)?|gr[üu]nder(in)?)\b/i;

/** Strip `@ Employer` / ` at Employer` — the role, not where it is held. */
function stripEmployer(segment: string): string {
    return segment.split('@')[0].split(/\s+at\s+/i)[0].trim();
}

/**
 * The roles a LinkedIn-style headline names, most important first.
 *
 * `"Principal Engineer @ ACME | Java, Python | Solutions Architect"` →
 * `["Principal Engineer", "Solutions Architect"]`. The FIRST segment is always
 * taken (it is where every headline puts the current role, whatever its
 * wording); later segments only when they read as a role, so a skill list
 * between two pipes is never promoted to a job title.
 */
export function extractRoles(headline: string | undefined): string[] {
    const segments = decodeEntities(headline ?? '')
        .split('|')
        .map((segment) => stripEmployer(segment.split(/\s+[-–—]\s+/)[0]))
        .map((segment) => segment.replace(/\s+/g, ' ').trim());
    const roles: string[] = [];
    segments.forEach((segment, index) => {
        if (!segment || (index > 0 && !ROLE_WORDS.test(segment))) {
            return;
        }
        if (!roles.some((role) => role.toLowerCase() === segment.toLowerCase())) {
            roles.push(segment);
        }
    });
    return roles;
}

/** The single short role (`jobTitle`): the headline's first role segment. */
export function primaryRole(headline: string | undefined): string {
    return extractRoles(headline)[0] ?? '';
}

/** Up to two roles joined for display: `"Principal Engineer & Solutions Architect"`. */
export function rolesLabel(headline: string | undefined): string {
    return extractRoles(headline).slice(0, 2).join(' & ');
}

function locationParts(location: string | undefined): string[] {
    return decodeEntities(location ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
}

/** `"Aachen, North Rhine-Westphalia, Germany"` → `"Aachen"`. */
export function locality(location: string | undefined): string {
    return locationParts(location)[0] ?? '';
}

/** `"Aachen, North Rhine-Westphalia, Germany"` → `"Aachen, Germany"`. */
export function shortLocation(location: string | undefined): string {
    const parts = locationParts(location);
    return parts.length > 1 ? `${parts[0]}, ${parts[parts.length - 1]}` : (parts[0] ?? '');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** `"Retrieval-Augmented Generation (RAG)"` → `["Retrieval-Augmented Generation", "RAG"]`. */
function skillTerms(skill: string): string[] {
    const match = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(skill);
    return (match ? [match[1], match[2]] : [skill]).map((term) => term.trim()).filter(Boolean);
}

/**
 * The short form of a skill for prose and keywords. A parenthesised ACRONYM
 * wins (`"Model Context Protocol (MCP)"` → `"MCP"`, the term people search);
 * any other parenthetical is a qualifier and is dropped
 * (`"Python (Programming Language)"` → `"Python"`).
 */
export function skillLabel(skill: string): string {
    const [main, qualifier] = skillTerms(skill);
    return qualifier && /^[A-Z0-9][A-Z0-9.+#/-]{0,7}$/.test(qualifier) ? qualifier : main;
}

function mentions(text: string, skill: string): boolean {
    return skillTerms(skill).some((term) =>
        new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, 'iu').test(text),
    );
}

/**
 * The profile's skills, the ones the owner EMPHASISES first.
 *
 * A LinkedIn skills list is long (the live profile carries 77) and its order is
 * whatever the platform kept. The headline and the about text are where the
 * owner says what matters, so a skill named in the headline ranks highest, one
 * named in the about text next, and the profile order breaks every tie. Data
 * decides — no skill is privileged by this file.
 */
export function rankSkills(
    skills: readonly string[] | undefined,
    headline?: string,
    about?: string,
): string[] {
    const head = decodeEntities(headline ?? '');
    const body = toPlainText(about);
    const seen = new Set<string>();
    return (skills ?? [])
        .map((skill) => decodeEntities(skill).trim())
        .filter((skill) => {
            const key = skill.toLowerCase();
            if (!skill || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        })
        .map((skill, index) => ({
            skill,
            index,
            score: (mentions(head, skill) ? 2 : 0) + (mentions(body, skill) ? 1 : 0),
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map(({ skill }) => skill);
}

/**
 * The home page `<title>`: `"{name} - {roles} | {city}"`, at most 60 chars.
 *
 * Tried longest-first and the first candidate that FITS wins, so the title
 * loses whole parts (city, then the second role) instead of being cut
 * mid-word; only a name+role that cannot fit at all is word-cut.
 */
export function buildHomeTitle(input: IdentityInput, overrides: IdentityOverrides = {}): string {
    const override = toPlainText(overrides.seoTitle);
    if (override) {
        return truncateAtWord(override, MAX_TITLE_LENGTH);
    }
    const name = toPlainText(input.name);
    const roles = rolesLabel(input.headline);
    const role = primaryRole(input.headline);
    const city = locality(input.location);
    const candidates = [
        roles && city && `${name} - ${roles} | ${city}`,
        roles && `${name} - ${roles}`,
        role && city && `${name} - ${role} | ${city}`,
        role && `${name} - ${role}`,
    ].filter((candidate): candidate is string => Boolean(candidate));
    const fit = candidates.find((candidate) => candidate.length <= MAX_TITLE_LENGTH);
    return fit ?? truncateAtWord(candidates[candidates.length - 1] ?? name, MAX_TITLE_LENGTH);
}

/**
 * Any other page's `<title>`: `"{page} | {owner}"` when it fits in 60
 * characters; otherwise the page name ALONE (the page is the more specific
 * signal), word-cut without an ellipsis when even that is too long — a blog
 * post's headline is the usual case.
 */
export function buildPageTitle(page: string, ownerName: string): string {
    const name = toPlainText(page);
    const owner = toPlainText(ownerName);
    const branded = owner ? `${name} | ${owner}` : name;
    return branded.length <= MAX_TITLE_LENGTH ? branded : truncateAtWord(name, MAX_TITLE_LENGTH);
}

/** Sentence templates per UI language; English is the fallback. */
const PHRASES = {
    en: {
        is: (name: string, roles: string, where: string) =>
            `${name} is ${/^[aeiou]/i.test(roles) ? 'an' : 'a'} ${roles}${where ? ` based in ${where}` : ''}.`,
        skills: (list: string) => `Specialises in ${list}.`,
        and: 'and',
        availability: {
            open: 'Open to new opportunities.',
            listening: 'Open to hearing about new opportunities.',
        } as Record<string, string | undefined>,
    },
    de: {
        is: (name: string, roles: string, where: string) =>
            `${name} ist ${roles}${where ? ` in ${where}` : ''}.`,
        skills: (list: string) => `Schwerpunkte: ${list}.`,
        and: 'und',
        availability: {
            open: 'Offen für neue Aufgaben.',
            listening: 'Offen für Gespräche über neue Aufgaben.',
        } as Record<string, string | undefined>,
    },
};

export function phrasesFor(lang: string | undefined) {
    return lang === 'de' ? PHRASES.de : PHRASES.en;
}

function joinList(items: readonly string[], and: string): string {
    return items.length > 1
        ? `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`
        : items.join('');
}

/** Split plain text into sentences (kept with their terminal punctuation). */
function sentences(text: string): string[] {
    return text.match(/[^.!?]+[.!?]+(?=\s|$)/g)?.map((s) => s.trim()) ?? (text ? [text] : []);
}

/**
 * The home page meta description, plain text, at most 155 characters.
 *
 * Built from WHOLE sentences, greedily: who + role + where, then as many of
 * the top skills as fit, then the availability signal, then sentences of the
 * owner's own about text while they still fit. An answer engine quoting it
 * therefore always gets complete statements, and every fact in it comes from
 * the configured data.
 */
export function buildHomeDescription(
    input: IdentityInput,
    overrides: IdentityOverrides = {},
): string {
    const override = toPlainText(overrides.seoDescription);
    if (override) {
        return truncateAtWord(override, MAX_DESCRIPTION_LENGTH);
    }
    const phrases = phrasesFor(input.lang);
    const name = toPlainText(input.name);
    const roles = rolesLabel(input.headline);
    const about = toPlainText(input.about);
    const parts: string[] = [];
    const fits = (sentence: string) =>
        [...parts, sentence].join(' ').length <= MAX_DESCRIPTION_LENGTH;
    const push = (sentence: string) => {
        if (sentence && fits(sentence)) {
            parts.push(sentence);
        }
    };

    if (roles) {
        push(phrases.is(name, roles, shortLocation(input.location)));
    }
    const ranked = rankSkills(input.skills, input.headline, input.about).map(skillLabel);
    for (let count = Math.min(4, ranked.length); count > 0; count--) {
        const sentence = phrases.skills(joinList(ranked.slice(0, count), phrases.and));
        if (fits(sentence)) {
            parts.push(sentence);
            break;
        }
    }
    push(phrases.availability[input.availability ?? ''] ?? '');
    for (const sentence of sentences(about)) {
        push(sentence);
    }
    const composed = parts.join(' ');
    // Nothing composable (no headline, no skills): the about text, word-cut.
    return composed || truncateAtWord(about || name, MAX_DESCRIPTION_LENGTH);
}

/**
 * The `keywords` meta: the roles, the city and the top skills — short, real
 * terms, never the raw headline (the live page shipped the whole pipe-joined
 * LinkedIn headline and all 77 skills here).
 */
export function buildKeywords(input: IdentityInput, overrides: IdentityOverrides = {}): string {
    const override = toPlainText(overrides.seoKeywords);
    if (override) {
        return override;
    }
    const terms = [
        ...extractRoles(input.headline).slice(0, 2),
        locality(input.location),
        ...rankSkills(input.skills, input.headline, input.about)
            .slice(0, MAX_KEYWORD_SKILLS)
            .map(skillLabel),
    ];
    const seen = new Set<string>();
    return terms
        .filter((term) => {
            const key = term.toLowerCase();
            if (!term || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        })
        .join(', ');
}
