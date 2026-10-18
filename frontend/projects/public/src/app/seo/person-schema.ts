import { Certification, Education, Experience, Profile } from '../services/profile.service';
import { SiteConfig } from '../services/site-config.service';
import { MAX_SCHEMA_SKILLS, primaryRole, rankSkills } from './identity';
import { decodeEntities, toPlainText, trimTrailingSlashes } from './text';

/**
 * schema.org `Person` structured data for the home page (#71).
 *
 * Pure, DI-free functions so the mapping is unit-testable in isolation and the
 * component stays dumb (rule 5). Every value is derived from the active profile
 * and the runtime site config (#65) — nothing about the owner is hardcoded, so
 * a forker's own data produces their own rich result with no code edits.
 *
 * Types are explicit object *type aliases* (not interfaces) on purpose: an
 * alias gets an implicit index signature and is therefore assignable to
 * `JsonLd` (`Record<string, unknown>`), which keeps `SeoService.setJsonLd`
 * free of `any` (rule 4).
 */

export type PostalAddressSchema = {
    '@type': 'PostalAddress';
    addressLocality: string;
    addressCountry?: string;
};

export type OrganizationSchema = {
    '@type': 'Organization';
    name: string;
    url?: string;
};

export type EducationalOrganizationSchema = {
    '@type': 'EducationalOrganization';
    name: string;
};

export type OccupationSchema = {
    '@type': 'Occupation';
    name: string;
    skills?: string[];
};

/**
 * The machine-readable "open to work" signal (#71 AC5). schema.org models a
 * person LOOKING for something as `Person.seeks` → `Demand`. `JobPosting` is
 * deliberately NOT used: it describes a vacancy offered by a hiring
 * organization (Google's job-posting rich result requires `hiringOrganization`,
 * `datePosted`, `jobLocation`), so a candidate emitting one would be publishing
 * a fake vacancy.
 */
export type DemandSchema = {
    '@type': 'Demand';
    name: string;
};

export type CredentialSchema = {
    '@type': 'EducationalOccupationalCredential';
    name: string;
    credentialCategory: 'certificate';
    recognizedBy?: OrganizationSchema;
    dateCreated?: string;
    expires?: string;
    url?: string;
};

/**
 * A node inside an `@graph`: no `@context` of its own — the graph's envelope
 * carries the one context (see `seo/graph.ts`).
 */
export type PersonSchema = {
    '@type': 'Person';
    '@id'?: string;
    name: string;
    jobTitle?: string;
    url?: string;
    image?: string;
    description?: string;
    sameAs?: string[];
    knowsAbout?: string[];
    knowsLanguage?: string[];
    hasOccupation?: OccupationSchema;
    hasCredential?: CredentialSchema[];
    worksFor?: OrganizationSchema;
    alumniOf?: EducationalOrganizationSchema[];
    address?: PostalAddressSchema;
    seeks?: DemandSchema;
};

/** How many credentials `hasCredential` carries — the newest verifiable ones. */
export const MAX_CREDENTIALS = 10;

/** Path of the uploaded portrait (#333), the same URL the hero renders. */
export const PROFILE_PHOTO_PATH = '/api/app/profile/photo';

/** `https://site` → `https://site/#person` — ONE identifier for every page's graph. */
export function personId(siteUrl: string): string {
    return `${trimTrailingSlashes(siteUrl)}/#person`;
}

/**
 * A four-digit year anywhere in `endDate` means the role has ENDED; its absence
 * means it is ongoing. Locale-independent by design — the demo profiles alone
 * say "Present" (en) and "Heute" (de), and a scraped profile may say anything,
 * so matching a word list would silently mis-classify a forker's data. Same
 * idea as `YearExtractPipe`.
 */
const YEAR = /\b(19|20)\d{2}\b/;

/** Labels for the availability states that constitute an open-to-work signal. */
const SEEKS_LABEL: Record<string, string | undefined> = {
    open: 'Open to new opportunities',
    listening: 'Open to hearing about new opportunities',
};

export function isOngoingRole(experience: Experience): boolean {
    return !YEAR.test(experience.endDate ?? '');
}

/** `"Berlin, Germany"` → locality + country; a single token yields locality only. */
export function buildAddress(location: string | undefined): PostalAddressSchema | undefined {
    const parts = decodeEntities(location ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    if (parts.length === 0) {
        return undefined;
    }
    const address: PostalAddressSchema = { '@type': 'PostalAddress', addressLocality: parts[0] };
    if (parts.length > 1) {
        address.addressCountry = parts[parts.length - 1];
    }
    return address;
}

/** The current employer: the first named role that has not ended. */
export function buildWorksFor(experience: Experience[] | undefined): OrganizationSchema | undefined {
    const current = (experience ?? []).find((role) => role.company && isOngoingRole(role));
    if (!current) {
        return undefined;
    }
    const organization: OrganizationSchema = {
        '@type': 'Organization',
        name: decodeEntities(current.company),
    };
    const url = (current.companyLinkedInUrl ?? '').trim();
    if (url) {
        organization.url = url;
    }
    return organization;
}

export function buildAlumniOf(
    education: Education[] | undefined,
): EducationalOrganizationSchema[] | undefined {
    const schools = (education ?? [])
        .map((entry) => decodeEntities(entry.school ?? '').trim())
        .filter((school) => school.length > 0);
    return schools.length
        ? schools.map((name) => ({ '@type': 'EducationalOrganization' as const, name }))
        : undefined;
}

export function buildSeeks(availability: string): DemandSchema | undefined {
    const name = SEEKS_LABEL[availability];
    return name ? { '@type': 'Demand', name } : undefined;
}

const MONTHS: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    // German profile exports (the de demo persona): the abbreviations that
    // differ from English.
    mär: '03', mrz: '03', mai: '05', okt: '10', dez: '12',
};

/**
 * A free-text profile date as ISO 8601, or `undefined` when it is not one.
 * `"Aug 2026"` → `"2026-08"`, `"2024"` → `"2024"`, `"2024-05-01"` as-is. A
 * value schema.org would reject is OMITTED, never guessed.
 */
export function toIsoDate(value: string | undefined): string | undefined {
    const text = (value ?? '').trim();
    if (/^\d{4}(-\d{2}){0,2}$/.test(text)) {
        return text;
    }
    const match = /^(\p{L}{3})\p{L}*\.?\s+(\d{4})$/iu.exec(text);
    const month = match ? MONTHS[match[1].toLowerCase()] : undefined;
    return month ? `${match![2]}-${month}` : undefined;
}

/** HTTPS only, deduplicated on host+path (case, `www.` and trailing `/` ignored). */
export function buildSameAs(urls: readonly (string | undefined)[]): string[] | undefined {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of urls) {
        const url = (raw ?? '').trim();
        if (!/^https:\/\//i.test(url)) {
            continue;
        }
        const key = trimTrailingSlashes(url.toLowerCase().replace(/^https:\/\/(www\.)?/, ''));
        if (!seen.has(key)) {
            seen.add(key);
            result.push(url);
        }
    }
    return result.length ? result : undefined;
}

/**
 * The owner's certifications as schema.org credentials: the VERIFIABLE ones
 * (with a credential URL) first, newest first within that, at most ten — a
 * long tail of course-completion records adds bytes, not trust.
 */
export function buildCredentials(
    certifications: readonly Certification[] | undefined,
): CredentialSchema[] | undefined {
    const ranked = (certifications ?? [])
        .map((cert, index) => ({
            cert,
            index,
            date: toIsoDate(cert.issueDate ?? cert.date) ?? '',
            name: toPlainText(cert.name),
        }))
        .filter(({ name }) => name.length > 0)
        .sort(
            (a, b) =>
                Number(Boolean(b.cert.credentialUrl)) - Number(Boolean(a.cert.credentialUrl)) ||
                b.date.localeCompare(a.date) ||
                a.index - b.index,
        )
        .slice(0, MAX_CREDENTIALS);
    if (!ranked.length) {
        return undefined;
    }
    return ranked.map(({ cert, date, name }) => {
        const credential: CredentialSchema = {
            '@type': 'EducationalOccupationalCredential',
            name,
            credentialCategory: 'certificate',
        };
        const issuer = toPlainText(cert.issuer);
        if (issuer) {
            credential.recognizedBy = { '@type': 'Organization', name: issuer };
        }
        if (date) {
            credential.dateCreated = date;
        }
        const expires = toIsoDate(cert.expirationDate);
        if (expires) {
            credential.expires = expires;
        }
        if (/^https:\/\//i.test(cert.credentialUrl ?? '')) {
            credential.url = cert.credentialUrl;
        }
        return credential;
    });
}

/**
 * Assemble the enriched `Person` node. Every optional property is OMITTED
 * rather than emitted empty — a `"worksFor": {}` or `"address": null` fails
 * schema.org validation, while an absent property is simply not claimed.
 */
export function buildPersonSchema(profile: Profile, site: SiteConfig): PersonSchema {
    const schema: PersonSchema = {
        '@type': 'Person',
        name: toPlainText(profile.name) || site.ownerName,
    };
    const siteUrl = trimTrailingSlashes(site.siteUrl);
    // The TOP skills, not all of them: the headline/about decide what matters
    // (see `rankSkills`), and 77 undifferentiated terms dilute every one.
    const skills = rankSkills(profile.skills, profile.headline, profile.about).slice(
        0,
        MAX_SCHEMA_SKILLS,
    );
    // `jobTitle` is the ROLE ("Principal Engineer"), never the whole pipe-joined
    // LinkedIn headline with its employer and skill list.
    const role = primaryRole(profile.headline);

    if (siteUrl) {
        schema['@id'] = personId(siteUrl);
        schema.url = `${siteUrl}/`;
        schema.image = `${siteUrl}${PROFILE_PHOTO_PATH}`;
    }
    if (role) {
        schema.jobTitle = role;
        schema.hasOccupation = { '@type': 'Occupation', name: role };
        if (skills.length) {
            schema.hasOccupation.skills = skills;
        }
    }
    const about = toPlainText(profile.about);
    if (about) {
        schema.description = about;
    }
    const sameAs = buildSameAs([...(site.socialLinks ?? []), profile.contact?.linkedin]);
    if (sameAs) {
        schema.sameAs = sameAs;
    }
    if (skills.length) {
        schema.knowsAbout = skills;
    }
    const languages = (profile.languages ?? [])
        .map((language) => toPlainText(language.name))
        .filter(Boolean);
    if (languages.length) {
        schema.knowsLanguage = languages;
    }
    const credentials = buildCredentials(profile.certifications);
    if (credentials) {
        schema.hasCredential = credentials;
    }

    const worksFor = buildWorksFor(profile.experience);
    if (worksFor) {
        schema.worksFor = worksFor;
    }
    const alumniOf = buildAlumniOf(profile.education);
    if (alumniOf) {
        schema.alumniOf = alumniOf;
    }
    const address = buildAddress(profile.location);
    if (address) {
        schema.address = address;
    }
    const seeks = buildSeeks(site.availability);
    if (seeks) {
        schema.seeks = seeks;
    }

    return schema;
}
