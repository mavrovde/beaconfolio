/**
 * The canonical Project shape and the pure projections the components render
 * (#92).
 *
 * Projects arrive inside an UPLOADED profile JSON — the admin profile-upload
 * flow stores the document raw (`ProfileSnapshot.data`) and the public endpoint
 * serves the allowlisted top-level fields straight through. Nothing between the
 * upload form and this module validates the SHAPE of a project, so everything
 * here treats each field as untrusted input rather than as a typed object that
 * merely happens to be late-bound. That is why the logic lives in a pure module
 * with its own tests instead of inside a template: a template cannot express
 * "drop this entry", and `@for` cannot survive a duplicate track key.
 */

/** One project, as authored in the profile JSON. Every field but the title is optional. */
export interface Project {
    title: string;
    summary?: string;
    description?: string;
    techStack?: string[];
    links?: { source?: string; demo?: string };
    image?: string;
    role?: string;
    startDate?: string;
    endDate?: string;
    /** Optional author-supplied slug; derived from the title when absent. */
    slug?: string;
}

/** A project after projection: safe to render, guaranteed unique `slug`. */
export interface RenderableProject extends Project {
    slug: string;
    techStack: string[];
    links: { source?: string; demo?: string };
}

/**
 * Slugify a title for the detail route.
 *
 * Deliberately ASCII-only and lossy: the slug is a URL, and a title like
 * "Böse Ümlaute & Co." must not produce a percent-encoded path that differs
 * between the SSR render and the browser's own encoding. Anything that is not
 * an ASCII letter or digit collapses to a single hyphen.
 */
export function slugify(title: string): string {
    return (
        title
            .normalize('NFKD')
            // Strip combining marks so "ü" -> "u" rather than vanishing.
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
    );
}

/**
 * Accept only absolute `http(s)` URLs, exactly as the profile-links projection
 * does and for the same reason: these land in an `[href]`, and `javascript:`
 * in an href is the oldest XSS there is. Angular's sanitizer is the second line
 * of defence here, not the first — and this input is weaker than site config,
 * because any admin-uploaded JSON can carry it.
 */
export function safeHttpUrl(value: string | undefined): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    let parsed: URL;
    try {
        parsed = new URL(value.trim());
    } catch {
        return undefined;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? parsed.toString()
        : undefined;
}

/**
 * Project the uploaded list onto renderable entries.
 *
 * An entry without a usable title is DROPPED: the title is the link text, the
 * heading and the slug source, so a project without one cannot be rendered or
 * addressed, and showing an empty card would be worse than omitting it.
 */
export function toRenderableProjects(
    projects: readonly Project[] | undefined
): RenderableProject[] {
    if (!projects?.length) {
        return [];
    }
    const out: RenderableProject[] = [];
    // The template tracks `@for` by `project.slug` and the detail route looks a
    // project up BY that slug, so a collision is two bugs rather than one: a
    // reconciliation fault in the list, and a detail page that silently serves
    // the wrong project. Two projects called "Portfolio" is an ordinary thing
    // for a person to have, so this is a real case and not a hypothetical.
    const seen = new Set<string>();
    for (const raw of projects) {
        if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) {
            continue;
        }
        const title = raw.title.trim();
        const base = (typeof raw.slug === 'string' && slugify(raw.slug)) || slugify(title);
        // A title of only punctuation slugifies to "" — fall back to a stable
        // positional slug rather than emitting an entry that cannot be linked.
        let slug = base || `project-${out.length + 1}`;
        let n = 2;
        while (seen.has(slug)) {
            slug = `${base || 'project'}-${n++}`;
        }
        seen.add(slug);
        const image = safeHttpUrl(raw.image);
        out.push({
            ...raw,
            title,
            slug,
            // De-duplicated for exactly the reason the SLUG is: both templates
            // render this list with `track tech`, and a repeated entry makes
            // that track key non-unique — Angular logs NG0955 and reconciles
            // the wrong node. `techStack` is as hand-authored as the titles
            // are, so "React" twice is an ordinary typo, not a hypothetical.
            // A Set preserves first-seen order, which is the authored order.
            techStack: [
                ...new Set(
                    (raw.techStack ?? []).filter(
                        (t): t is string => typeof t === 'string' && t.trim() !== ''
                    )
                ),
            ],
            links: {
                source: safeHttpUrl(raw.links?.source),
                demo: safeHttpUrl(raw.links?.demo),
            },
            // An absolute URL must pass the same http(s) gate as the links. A
            // RELATIVE path (`assets/…`) is the normal case for a bundled demo
            // asset and cannot carry a scheme at all, so it is kept as authored.
            // A PROTOCOL-RELATIVE url (`//tracker.example/pixel.png`) also
            // carries no colon, so the colon test alone let a third-party
            // absolute URL through the gate it was written to close — it
            // inherits the page's scheme and loads off-site all the same.
            image:
                image ??
                (typeof raw.image === 'string' &&
                !raw.image.includes(':') &&
                !raw.image.startsWith('//')
                    ? raw.image
                    : undefined),
        });
    }
    return out;
}

/** Find one project by slug, for the detail route. */
export function findProject(
    projects: readonly Project[] | undefined,
    slug: string
): RenderableProject | undefined {
    return toRenderableProjects(projects).find((p) => p.slug === slug);
}

/**
 * The displayed date range. Returns `undefined` rather than an empty string so
 * the template can hide the element entirely instead of rendering a blank one.
 */
export function formatPeriod(project: Project): string | undefined {
    const start = project.startDate?.trim();
    const end = project.endDate?.trim();
    if (start && end) {
        return `${start} — ${end}`;
    }
    return start || end || undefined;
}
