import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * The configured identity of the stack under test (#65/#71). Nothing here may
 * hardcode a domain or an owner: this suite runs against the demo persona in
 * CI and against a forker's own config anywhere else.
 */
async function siteConfig(request: APIRequestContext) {
    const response = await request.get('/api/app/config/site');
    expect(response.ok()).toBe(true);
    return (await response.json()) as {
        site_url: string;
        owner_name: string;
        owner_headline: string;
        site_name: string;
        availability: string;
        ai_crawler_policy: string;
    };
}

/** Every schema.org node in the server-rendered HTML, `@graph` envelopes flattened. */
function jsonLdNodes(html: string): Record<string, unknown>[] {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(blocks.length, 'no JSON-LD block in the server-rendered HTML').toBeGreaterThan(0);
    return blocks.flatMap(([, raw]) => {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return (parsed['@graph'] as Record<string, unknown>[] | undefined) ?? [parsed];
    });
}

test.describe('SEO & SSR Verification', () => {
    // 1. robots.txt — generated from SITE_URL, still welcoming the AI crawlers
    test('should serve a config-driven robots.txt with AI bot rules', async ({ request }) => {
        const { site_url, ai_crawler_policy } = await siteConfig(request);
        const response = await request.get('/robots.txt');
        expect(response.ok()).toBe(true);
        const text = await response.text();

        expect(text).toContain('User-agent: GPTBot');
        expect(text).toContain('Allow: /');
        expect(text).toContain(`Sitemap: ${site_url}/sitemap.xml`);

        // #252: the AI section follows the deployment's own policy — asserting
        // `Allow` unconditionally would redden this spec on a stack set to deny,
        // where the opposite is the correct output.
        const aiRule = ai_crawler_policy === 'deny' ? 'Disallow: /' : 'Allow: /';
        for (const agent of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'PerplexityBot']) {
            expect(text, `AI rule for ${agent}`).toContain(`User-agent: ${agent}\n${aiRule}`);
        }
        // Tailored links (#250) and the admin surface stay out of every index.
        expect(text).toContain('User-agent: *\nAllow: /\nDisallow: /for/\nDisallow: /admin');
        // The `# llms.txt:` breadcrumb follows the policy too (#252 review,
        // minor 8): a deny deployment stops ADVERTISING the agent map to
        // crawlers, even though the file itself is still served on request.
        // Asserting it unconditionally passed only because the spec had never
        // been run under `deny` after that change landed.
        const breadcrumb = `# llms.txt: ${site_url}/llms.txt`;
        if (ai_crawler_policy === 'deny') {
            expect(text).not.toContain(breadcrumb);
        } else {
            expect(text).toContain(breadcrumb);
        }
    });

    // 1b. llms.txt — the agent-facing site map (#252)
    test('should serve a config-driven llms.txt linking the structured profile', async ({
        request,
    }) => {
        const { site_url, site_name, owner_name, owner_headline } = await siteConfig(request);
        const response = await request.get('/llms.txt');
        expect(response.ok()).toBe(true);
        expect(response.headers()['content-type']).toContain('text/plain');
        const text = await response.text();

        // llmstxt.org format: the H1 is the only required section.
        expect(text.startsWith(`# ${site_name}\n`)).toBe(true);
        expect(text).toContain(`> ${owner_name} — ${owner_headline}`);
        expect(text).toContain(
            `- [Structured profile (JSON Resume v1.0.0)](${site_url}/api/app/profile/resume.json):`,
        );
        expect(text).toContain(`- [CV](${site_url}/cv):`);
        expect(text).toContain(`- [All posts](${site_url}/blog):`);

        // The blog list is the source of truth for what llms.txt must name.
        const posts = await request.get('/api/app/posts?published_only=true&page=1&page_size=5');
        const { items } = (await posts.json()) as { items: { slug: string }[] };
        expect(items.length).toBeGreaterThan(0);
        expect(text).toContain(`](${site_url}/blog/${items[0].slug})`);
    });

    // 1c. The machine-readable profile itself, over real HTTP (#252)
    test('should serve a JSON Resume document consistent with the site config', async ({
        request,
    }) => {
        const { site_url, availability } = await siteConfig(request);
        const response = await request.get('/api/app/profile/resume.json');
        expect(response.ok()).toBe(true);
        expect(response.headers()['content-type']).toContain('application/json');
        const resume = (await response.json()) as {
            $schema: string;
            basics: { name: string; url: string; label?: string };
            work?: unknown[];
            skills?: unknown[];
            meta: { canonical: string; availability: string; contactUrl: string };
        };

        expect(resume.$schema).toContain('resume-schema/v1.0.0/schema.json');
        expect(resume.basics.name).toBeTruthy();
        expect(resume.basics.url).toBe(site_url);
        expect(resume.work?.length).toBeGreaterThan(0);
        expect(resume.skills?.length).toBeGreaterThan(0);
        expect(resume.meta.canonical).toBe(`${site_url}/api/app/profile/resume.json`);
        expect(resume.meta.availability).toBe(availability);
        expect(resume.meta.contactUrl).toBe(`${site_url}/#contact`);

        // "Omit, never invent": no empty string may reach a consumer.
        const emptyStrings = JSON.stringify(resume).match(/:\s*""/g) ?? [];
        expect(emptyStrings, 'empty values must be omitted, not emitted').toHaveLength(0);
    });

    // 2. sitemap.xml — generated from SITE_URL and the live published posts (#71)
    test('should serve a config-driven sitemap.xml listing blog posts', async ({ request }) => {
        const { site_url } = await siteConfig(request);
        const response = await request.get('/sitemap.xml');
        expect(response.ok()).toBe(true);
        const text = await response.text();

        expect(text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(text).toContain('<urlset');
        for (const route of ['/', '/blog', '/cv', '/llm']) {
            expect(text).toContain(`<loc>${site_url}${route}</loc>`);
        }

        // The blog list is the source of truth for what MUST be in the sitemap.
        const posts = await request.get('/api/app/posts?published_only=true&page=1&page_size=5');
        const { items } = (await posts.json()) as { items: { slug: string }[] };
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
            expect(text).toContain(`<loc>${site_url}/blog/${item.slug}</loc>`);
        }
    });

    // 3. Verify SSR (Home Page Initial Paint)
    test('should provide pre-rendered HTML for home page', async ({ request }) => {
        const { owner_name } = await siteConfig(request);
        const response = await request.get('/');
        expect(response.ok()).toBe(true);
        const html = await response.text();

        // Check for rendered content (not just a blank app-root)
        expect(html).toContain('<app-root');
        expect(html).toContain(owner_name);

        // Verify Meta Tags are in the initial HTML (Proof of SSR). The home
        // title is COMPOSED from the profile ("{name} - {role} | {city}"), so
        // only its invariants are asserted: it names the owner, it is not the
        // old literal "Home | …", and it fits a search result.
        const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
        expect(title).toContain(owner_name);
        expect(title.startsWith('Home |')).toBe(false);
        expect(title.length).toBeLessThanOrEqual(60);
        expect(html).not.toContain('&amp;amp;');
        expect(html).toContain('description');
        expect(html).toContain('og:title');
        expect(html).toContain('twitter:card');

        // Verify Structured Data (JSON-LD)
        expect(html).toContain('application/ld+json');
        expect(html).toContain('"@type"');
        expect(html).toContain('"Person"');
        expect(html).toContain(`"${owner_name}"`);
    });

    // 4. The enriched Person node crawlers actually read, in the SERVER HTML (#71)
    test('should server-render enriched Person structured data', async ({ request }) => {
        const { site_url, availability } = await siteConfig(request);
        const html = await (await request.get('/')).text();

        const nodes = jsonLdNodes(html);
        const person = nodes.find((node) => node['@type'] === 'Person')!;
        expect(person, 'no Person node').toBeTruthy();
        // One graph: the Person plus the WebSite and ProfilePage that reference it.
        expect(nodes.map((node) => node['@type'])).toEqual(
            expect.arrayContaining(['Person', 'WebSite', 'ProfilePage']),
        );
        expect(person['@id']).toBe(`${site_url}/#person`);
        expect(person['url']).toBe(`${site_url}/`);
        for (const field of ['hasOccupation', 'knowsAbout', 'alumniOf', 'worksFor', 'address']) {
            expect(person[field], `Person.${field} missing`).toBeTruthy();
        }
        expect(person['hasOccupation']).toMatchObject({ '@type': 'Occupation' });
        expect(person['address']).toMatchObject({ '@type': 'PostalAddress' });
        expect(person['worksFor']).toMatchObject({ '@type': 'Organization' });
        // Open-to-work signal (#71 AC5). Availability is admin-editable (#271), so
        // the expectation is READ FROM CONFIG like the identity above: asserting
        // `seeks` unconditionally reddens this spec on a stack set to `not_looking`,
        // where its absence is the correct output.
        if (availability === 'not_looking') {
            expect(person['seeks'], 'seeks must be omitted when not looking').toBeUndefined();
        } else {
            expect(person['seeks']).toMatchObject({ '@type': 'Demand' });
        }
    });

    // 5. Every public route: unique title + description + canonical + OG/Twitter (#71 AC2)
    for (const [route, path] of [
        ['/', '/'],
        ['/blog', '/blog'],
        ['/cv', '/cv'],
        ['/llm', '/llm'],
    ]) {
        test(`should server-render canonical + OG tags for ${route}`, async ({ request }) => {
            const { site_url } = await siteConfig(request);
            const html = await (await request.get(route)).text();

            expect(html).toContain(`<link rel="canonical" href="${site_url}${path}">`);
            expect(html).toContain(`<meta property="og:url" content="${site_url}${path}">`);
            expect(html).toContain(
                `<meta property="og:image" content="${site_url}/assets/og-image.png">`,
            );
            expect(html).toContain(
                `<meta name="twitter:image" content="${site_url}/assets/og-image.png">`,
            );
            expect(html).toMatch(/<meta name="description" content="[^"]+">/);
            // Open Graph completeness: the bundled card with its real size.
            expect(html).toMatch(/<meta property="og:site_name" content="[^"]+">/);
            expect(html).toMatch(/<meta property="og:locale" content="(en_US|de_DE)">/);
            expect(html).toContain('<meta property="og:image:width" content="1200">');
            expect(html).toContain('<meta property="og:image:height" content="630">');
            expect(html).toContain('max-image-preview:large');
            // #252 AC4: the machine-readable surfaces are advertised in the
            // SERVER-rendered head, on every route.
            expect(html).toContain(
                `<link rel="alternate" type="application/json" title="JSON Resume" href="${site_url}/api/app/profile/resume.json">`,
            );
            expect(html).toContain(
                `<link rel="describedby" type="text/plain" href="${site_url}/llms.txt">`,
            );
        });
    }

    // 5b. llms-full.txt — the whole profile as Markdown, linked from llms.txt
    test('should serve llms-full.txt and link it from llms.txt', async ({ request }) => {
        const { site_url } = await siteConfig(request);
        const full = await request.get('/llms-full.txt');
        expect(full.ok()).toBe(true);
        expect(full.headers()['content-type']).toContain('text/plain');
        expect(await full.text()).toMatch(/^# .+/);
        expect(await (await request.get('/llms.txt')).text()).toContain(`(${site_url}/llms-full.txt)`);
    });

    // 5c. The generated files carry backend text (profile, post titles); each
    // must declare a non-HTML type, and the frontend nginx (`nginx.conf`,
    // `add_header … always`) must forbid sniffing — exactly ONCE: an app-level
    // copy of the header showed up here as "nosniff, nosniff".
    for (const [path, type] of [
        ['/robots.txt', 'text/plain'],
        ['/llms.txt', 'text/plain'],
        ['/llms-full.txt', 'text/plain'],
        ['/sitemap.xml', 'application/xml'],
    ] as const) {
        test(`should serve ${path} as ${type} with nosniff`, async ({ request }) => {
            const response = await request.get(path);
            expect(response.ok()).toBe(true);
            expect(response.headers()['content-type']).toContain(type);
            expect(response.headers()['x-content-type-options']).toBe('nosniff');
        });
    }

    // 6. The OG image must actually exist — it did not before #71
    test('should serve the referenced Open Graph image', async ({ request }) => {
        const response = await request.get('/assets/og-image.png');
        expect(response.ok()).toBe(true);
        expect(response.headers()['content-type']).toContain('image/png');
    });

    // 7. Verify SSR (Blog list Initial Paint)
    test('should provide pre-rendered HTML for a blog post', async ({ request }) => {
        const { owner_name } = await siteConfig(request);
        const html = await (await request.get('/blog')).text();

        // This confirms the blog list is SSR'd
        expect(html).toContain('blog');
        expect(html).toContain(`<title>Blog | ${owner_name}</title>`);
    });

    // 8. Verify semantic HTML in SSR output
    test('should have an h1 tag in initial SSR output', async ({ request }) => {
        const response = await request.get('/');
        const html = await response.text();
        expect(html).toContain('<h1');
        expect(html.match(/<h1/g)?.length).toBe(1);
    });
});
