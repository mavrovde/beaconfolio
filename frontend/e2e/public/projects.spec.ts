import { test, expect, Page } from '@playwright/test';
import { API_PREFIX } from '../config';

/**
 * Projects showcase (#92) in a real browser.
 *
 * The profile is MOCKED at the API boundary rather than read from whatever the
 * stack happens to have activated: the assertions here are about rendering a
 * given projects array, and a spec that asserts the bundled demo content would
 * go red the moment a forker (or the demo-profile work) edits it. The two
 * checks that must be true of the SERVER — the SSR 404 for an unknown slug, and
 * the page being reachable without JavaScript — use `request` instead, because
 * `page.route` cannot intercept what the SSR render fetches server-side.
 */

const PROJECTS = [
    {
        title: 'Beaconfolio',
        summary: 'A portfolio template',
        description: 'The long form of the project description.',
        role: 'Creator',
        startDate: '2025',
        endDate: 'present',
        techStack: ['Angular', 'FastAPI'],
        links: { source: 'https://github.com/janedoe/beaconfolio', demo: 'https://example.com' },
    },
    {
        title: 'Semantic Search Service',
        summary: 'Vector search over documents',
        techStack: ['Python'],
        links: { source: 'https://github.com/janedoe/semantic-search' },
    },
];

function profile(projects: unknown[]) {
    return {
        name: 'Jane Doe',
        headline: 'Engineer',
        location: 'Berlin',
        about: 'Demo persona',
        experience: [],
        education: [],
        skills: ['Angular'],
        certifications: [],
        languages: [],
        recommendations: [],
        projects,
        contact: { email: 'jane@example.com', linkedin: 'https://linkedin.com/in/janedoe' },
    };
}

async function serveProfile(page: Page, projects: unknown[]) {
    await page.route(`**${API_PREFIX}/profile*`, (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(profile(projects)),
        }),
    );
}

test.describe('Projects showcase', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/*analytics*', (route) => route.abort());
        await page.route('**/*googletagmanager*', (route) => route.abort());
        await page.addInitScript(() => window.localStorage.setItem('cookie_consent', 'true'));
    });

    test('lists every project with its stack, links and role on /projects', async ({ page }) => {
        await serveProfile(page, PROJECTS);
        await page.goto('/projects');

        const cards = page.locator('[data-testid="project-card"]');
        await expect(cards).toHaveCount(2);
        await expect(page.locator('[data-testid="projects-page"]')).toBeVisible();

        const first = cards.first();
        await expect(first).toContainText('Beaconfolio');
        await expect(first).toContainText('Creator');
        await expect(first.locator('[data-testid="project-stack"] li')).toHaveCount(2);
        await expect(first.locator('[data-testid="project-source"]')).toHaveAttribute(
            'href',
            'https://github.com/janedoe/beaconfolio',
        );
        await expect(first.locator('[data-testid="project-demo"]')).toHaveAttribute(
            'href',
            'https://example.com/',
        );
        // The second project carries no demo link — the block must be absent,
        // not an empty anchor pointing at the current page.
        await expect(cards.nth(1).locator('[data-testid="project-demo"]')).toHaveCount(0);
    });

    test('navigates from a card to the project detail page', async ({ page }) => {
        await serveProfile(page, PROJECTS);
        await page.goto('/projects');

        await page.locator('[data-testid="project-card"] h3 a').first().click();
        await expect(page).toHaveURL(/\/projects\/beaconfolio$/);

        const detail = page.locator('[data-testid="project-detail"]');
        await expect(detail).toBeVisible();
        await expect(detail).toContainText('The long form of the project description.');
        await expect(detail.locator('[data-testid="detail-stack"] li')).toHaveCount(2);
        await expect(detail.locator('[data-testid="detail-source"]')).toHaveAttribute(
            'href',
            'https://github.com/janedoe/beaconfolio',
        );
    });

    test('emits SoftwareSourceCode structured data on a project detail page', async ({ page }) => {
        await serveProfile(page, PROJECTS);
        await page.goto('/projects/beaconfolio');
        await expect(page.locator('[data-testid="project-detail"]')).toBeVisible();

        // Read the node the page actually carries, and parse it — a substring
        // match would pass on a malformed script the crawler would reject.
        const raw = await page
            .locator('script[type="application/ld+json"]')
            .last()
            .textContent();
        const node = JSON.parse(raw ?? '{}');
        expect(node['@type']).toBe('SoftwareSourceCode');
        expect(node['name']).toBe('Beaconfolio');
        expect(node['codeRepository']).toBe('https://github.com/janedoe/beaconfolio');
        expect(node['author']).toEqual({ '@type': 'Person', name: 'Jane Doe' });
    });

    test('embeds the section on the home page behind a link to the full list', async ({ page }) => {
        await serveProfile(page, PROJECTS);
        await page.goto('/');

        const section = page.locator('[data-testid="projects-section"]');
        await expect(section).toBeVisible();
        await expect(section.locator('[data-testid="project-card"]')).toHaveCount(2);

        await section.locator('[data-testid="projects-all-link"]').click();
        await expect(page).toHaveURL(/\/projects$/);
    });

    test('reaches the list from the header navigation', async ({ page }) => {
        await serveProfile(page, PROJECTS);
        await page.goto('/');
        await page.locator('nav a[href="/projects"]').first().click();
        await expect(page.locator('[data-testid="projects-page"]')).toBeVisible();
    });

    // The out-of-the-box path for a forker who has not written any projects:
    // the home section must not exist at all, while the route the nav always
    // shows must still be a real page that says so.
    test('hides the home section but keeps /projects when there are none', async ({ page }) => {
        await serveProfile(page, []);
        await page.goto('/');
        await expect(page.locator('[data-testid="projects-section"]')).toHaveCount(0);

        await page.goto('/projects');
        await expect(page.locator('[data-testid="projects-page"]')).toBeVisible();
        await expect(page.locator('[data-testid="projects-empty"]')).toBeVisible();
        await expect(page.locator('[data-testid="project-card"]')).toHaveCount(0);
    });

    test('shows the not-found panel for an unknown slug', async ({ page }) => {
        await serveProfile(page, PROJECTS);
        await page.goto('/projects/no-such-project');
        await expect(page.locator('[data-testid="project-missing"]')).toBeVisible();
        await expect(page.locator('[data-testid="project-detail"]')).toHaveCount(0);
    });

    // Asserted against the SERVER's bytes, not the browser's DOM: a soft 404
    // served as 200 renders identically and is exactly the defect (#109). No
    // project of any profile can carry this slug, so the expectation holds
    // whatever the stack has activated.
    test('the server answers an unknown project with a real 404', async ({ request }) => {
        const response = await request.get('/projects/e2e-definitely-not-a-project');
        expect(response.status()).toBe(404);
    });

    // The list must exist in the server-rendered HTML, not only after hydration
    // — a crawler that does not execute JavaScript is the whole audience for
    // the SEO work this section feeds.
    test('server-renders the projects page shell', async ({ request }) => {
        const response = await request.get('/projects');
        expect(response.status()).toBe(200);
        expect(await response.text()).toContain('data-testid="projects-page"');
    });
});
