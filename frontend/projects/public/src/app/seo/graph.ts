import { BlogPost } from '@beaconfolio/shared';
import { SiteConfig } from '../services/site-config.service';
import { personId } from './person-schema';
import { fullPostTitle, MAX_RECOVERED_TITLE, toMetaDescription, toPlainText, truncateAtWord } from './text';

/**
 * The page-level schema.org nodes and the ONE `@graph` envelope they ship in.
 *
 * Several nodes per page (Person + WebSite + ProfilePage on the home page;
 * BlogPosting + BreadcrumbList on a post) are emitted as one
 * `{"@context": …, "@graph": [...]}` document rather than as several script
 * blocks. Nodes reference each other by `@id` — the Person is
 * `{siteUrl}/#person` on EVERY page, which is what lets a crawler resolve the
 * blog's author, the site's publisher and the profile's subject to the same
 * entity.
 *
 * Pure functions over the runtime site config and the API payloads; the same
 * DI-free contract as `person-schema.ts` / `project-schema.ts`.
 */

export type JsonLdNode = Record<string, unknown>;

export type JsonLdGraph = {
    '@context': 'https://schema.org';
    '@graph': JsonLdNode[];
};

/** Wrap nodes in one graph; a node's own `@context` is dropped (the envelope has it). */
export function toGraph(nodes: readonly (JsonLdNode | undefined)[]): JsonLdGraph {
    return {
        '@context': 'https://schema.org',
        '@graph': nodes
            .filter((node): node is JsonLdNode => Boolean(node))
            .map((node) =>
                Object.fromEntries(Object.entries(node).filter(([key]) => key !== '@context')),
            ),
    };
}

function base(site: SiteConfig): string {
    return site.siteUrl.replace(/\/+$/, '');
}

export function websiteId(siteUrl: string): string {
    return `${siteUrl.replace(/\/+$/, '')}/#website`;
}

/** The `WebSite` node; `undefined` without a site URL (an `@id` must be absolute). */
export function buildWebSite(site: SiteConfig, lang: string): JsonLdNode | undefined {
    const url = base(site);
    if (!url) {
        return undefined;
    }
    return {
        '@type': 'WebSite',
        '@id': websiteId(url),
        url: `${url}/`,
        name: site.siteName || site.ownerName,
        inLanguage: lang,
        publisher: { '@id': personId(url) },
    };
}

/**
 * The `ProfilePage` node — Google's markup for "this page is about a person".
 * `dateModified` is the profile data's own timestamp (JSON Resume
 * `meta.lastModified`), and is OMITTED when unknown rather than set to "now".
 */
export function buildProfilePage(
    site: SiteConfig,
    options: { path: string; name: string; lang: string; dateModified?: string | null },
): JsonLdNode | undefined {
    const url = base(site);
    if (!url) {
        return undefined;
    }
    const node: JsonLdNode = {
        '@type': 'ProfilePage',
        '@id': `${url}${options.path}#profilepage`,
        url: `${url}${options.path}`,
        name: options.name,
        inLanguage: options.lang,
        isPartOf: { '@id': websiteId(url) },
        mainEntity: { '@id': personId(url) },
    };
    if (options.dateModified) {
        node['dateModified'] = options.dateModified;
    }
    return node;
}

export interface Crumb {
    name: string;
    /** Site-relative path, e.g. `/blog`. */
    path: string;
}

/** `BreadcrumbList` for a trail; `undefined` without a site URL or a trail. */
export function buildBreadcrumbs(site: SiteConfig, crumbs: readonly Crumb[]): JsonLdNode | undefined {
    const url = base(site);
    if (!url || !crumbs.length) {
        return undefined;
    }
    return {
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((crumb, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: crumb.name,
            item: `${url}${crumb.path}`,
        })),
    };
}

/** When the post was PUBLISHED: the original post date when known, else creation. */
export function postPublishedAt(post: Pick<BlogPost, 'posted_at' | 'created_at'>): string {
    return post.posted_at || post.created_at;
}

/** Resolve a possibly-relative image URL against the site; '' when impossible. */
export function absoluteUrl(site: SiteConfig, path: string | undefined | null): string {
    const value = (path ?? '').trim();
    if (!value) {
        return '';
    }
    if (/^https?:\/\//i.test(value)) {
        return value;
    }
    const url = base(site);
    return url ? `${url}${value.startsWith('/') ? '' : '/'}${value}` : '';
}

/**
 * The `BlogPosting` node.
 *
 * Dates are the post's ORIGINAL publication date (`posted_at`, the LinkedIn
 * post date) with `created_at` as the fallback — for an imported post
 * `created_at` is the import run, and a whole blog dated to one afternoon is
 * what the live sitemap and JSON-LD said before this. `dateModified` uses the
 * same value: an import refresh is not an edit of the article.
 */
export function buildBlogPosting(
    post: BlogPost,
    site: SiteConfig,
    fallbackImage: string,
): JsonLdNode {
    const url = base(site);
    const published = postPublishedAt(post);
    const text = toPlainText(post.content);
    const node: JsonLdNode = {
        '@type': 'BlogPosting',
        headline: truncateAtWord(fullPostTitle(post.title, post.content), MAX_RECOVERED_TITLE),
        datePublished: published,
        dateModified: published,
        inLanguage: post.language,
        wordCount: text ? text.split(' ').length : 0,
        description: toMetaDescription(post.summary || post.content),
        author: authorRef(site),
        publisher: authorRef(site),
    };
    const image = absoluteUrl(site, post.image_url) || fallbackImage;
    if (image) {
        node['image'] = image;
    }
    if (url) {
        node['@id'] = `${url}/blog/${post.slug}#article`;
        node['url'] = `${url}/blog/${post.slug}`;
        node['mainEntityOfPage'] = { '@type': 'WebPage', '@id': `${url}/blog/${post.slug}` };
        node['isPartOf'] = { '@id': websiteId(url) };
    }
    if (post.tags?.length) {
        node['keywords'] = post.tags.join(', ');
    }
    return node;
}

/** The owner as a Person REFERENCE (`@id`) plus the name for consumers that don't join. */
function authorRef(site: SiteConfig): JsonLdNode {
    const url = base(site);
    const ref: JsonLdNode = { '@type': 'Person', name: site.ownerName };
    if (url) {
        ref['@id'] = personId(url);
        ref['url'] = `${url}/`;
    }
    return ref;
}
