import { RenderableProject } from '../projects-model/projects';
import { SiteConfig } from '../services/site-config.service';

/**
 * schema.org structured data for one project detail page (#92, cross-ref #71).
 *
 * Pure, DI-free functions, same contract as `person-schema.ts`: explicit object
 * *type aliases* (not interfaces) so they carry an implicit index signature and
 * stay assignable to `SeoService`'s `JsonLd` without an `any` (rule 4).
 *
 * The `@type` is CHOSEN, not fixed: a project with a source repository is
 * `SoftwareSourceCode`, which is what `codeRepository` and
 * `programmingLanguage` actually belong to; anything else is a plain
 * `CreativeWork`. Emitting `SoftwareSourceCode` for a design case study, or
 * hanging `codeRepository` off a `CreativeWork`, is invalid either way round.
 */

export type PersonRefSchema = {
    '@type': 'Person';
    name: string;
};

export type ProjectSchema = {
    '@context': 'https://schema.org';
    '@type': 'SoftwareSourceCode' | 'CreativeWork';
    name: string;
    url?: string;
    description?: string;
    image?: string;
    keywords?: string[];
    codeRepository?: string;
    programmingLanguage?: string[];
    author?: PersonRefSchema;
    creator?: PersonRefSchema;
    temporalCoverage?: string;
};

/**
 * schema.org `temporalCoverage` wants an ISO 8601 interval (`start/end`), and
 * an open-ended one is written `start/..` — NOT with the profile's display word
 * ("present"/"Heute"). The dates here are free text a forker types, so the
 * property is OMITTED rather than coerced whenever the value is not a shape
 * schema.org accepts: a non-ISO START yields `undefined` (no interval can be
 * anchored), and a non-ISO END becomes the open-ended `..`. Nothing is passed
 * through untouched — an earlier version of this comment claimed it was, which
 * the code never did (#451 review round 1, nit 13).
 */
const ISO_DATE = /^\d{4}(-\d{2})?(-\d{2})?$/;

export function buildTemporalCoverage(
    startDate: string | undefined,
    endDate: string | undefined,
): string | undefined {
    const start = (startDate ?? '').trim();
    if (!ISO_DATE.test(start)) {
        return undefined;
    }
    const end = (endDate ?? '').trim();
    return `${start}/${ISO_DATE.test(end) ? end : '..'}`;
}

/** `/projects/<slug>` resolved against the configured site URL, if there is one. */
export function buildProjectUrl(siteUrl: string | undefined, slug: string): string | undefined {
    const base = (siteUrl ?? '').trim().replace(/\/+$/, '');
    return base ? `${base}/projects/${slug}` : undefined;
}

/**
 * Assemble the node. Every optional property is OMITTED rather than emitted
 * empty — `"image": null` fails validation while an absent property simply
 * makes no claim (the rule `person-schema.ts` already follows).
 */
export function buildProjectSchema(
    project: RenderableProject,
    site: SiteConfig,
    authorName?: string,
): ProjectSchema {
    const isCode = Boolean(project.links.source);
    const schema: ProjectSchema = {
        '@context': 'https://schema.org',
        '@type': isCode ? 'SoftwareSourceCode' : 'CreativeWork',
        name: project.title,
    };

    const url = buildProjectUrl(site.siteUrl, project.slug);
    if (url) {
        schema.url = url;
    }
    const description = project.description || project.summary;
    if (description) {
        schema.description = description;
    }
    if (project.image) {
        schema.image = project.image;
    }
    if (project.techStack.length) {
        schema.keywords = project.techStack;
        if (isCode) {
            // `programmingLanguage` is a SoftwareSourceCode property. The stack
            // is a mixed bag (languages, frameworks, databases) and schema.org
            // accepts plain text here, so it is the honest home for it; on a
            // CreativeWork it would simply be an invalid property.
            schema.programmingLanguage = project.techStack;
        }
    }
    if (project.links.source) {
        schema.codeRepository = project.links.source;
    }
    const name = (authorName ?? '').trim();
    if (name) {
        // `author` on the code, `creator` on the work — the two types name the
        // same relation differently, and neither accepts the other's property.
        const person: PersonRefSchema = { '@type': 'Person', name };
        if (isCode) {
            schema.author = person;
        } else {
            schema.creator = person;
        }
    }
    const temporalCoverage = buildTemporalCoverage(project.startDate, project.endDate);
    if (temporalCoverage) {
        schema.temporalCoverage = temporalCoverage;
    }

    return schema;
}
