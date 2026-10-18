import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ProjectsComponent } from './projects.component';
import { Profile, ProfileService } from '../../services/profile.service';
import { Project } from '../../projects-model/projects';
import { TranslatePipe } from '@beaconfolio/shared';
import { MockTranslatePipe, provideTestBrand } from '@beaconfolio/shared/testing';
import { SeoService } from '../../services/seo.service';
import { DEFAULT_SITE_CONFIG, SiteConfig, SiteConfigService } from '../../services/site-config.service';

const SITE: SiteConfig = {
    ...DEFAULT_SITE_CONFIG,
    siteUrl: 'https://example.com',
    ownerName: 'Jane Doe',
    ownerHeadline: 'Staff Engineer @ Acme',
};

const PROJECTS: Project[] = [
    {
        title: 'Beaconfolio',
        summary: 'A portfolio template',
        role: 'Creator',
        startDate: '2025',
        endDate: 'present',
        techStack: ['Angular', 'FastAPI'],
        links: { source: 'https://github.com/janedoe/b', demo: 'https://example.com' },
    },
    { title: 'Second Project' },
];

function profileWith(projects?: Project[]): Profile {
    return {
        name: 'Jane Doe',
        headline: 'Engineer',
        location: 'Berlin',
        about: '',
        experience: [],
        education: [],
        skills: [],
        projects,
    };
}

async function render(options: {
    standalone: boolean;
    profile?: Profile | null;
    served?: Profile;
    site?: SiteConfig;
}) {
    const getProfile = vi.fn().mockReturnValue(of(options.served ?? profileWith(PROJECTS)));
    const seo = { updateSeo: vi.fn(), setJsonLd: vi.fn() };
    await TestBed.configureTestingModule({
        imports: [ProjectsComponent],
        providers: [
            // `<app-header>` is embedded here, and since #67 its chrome comes
            // from `ShellChromeService` -> `SiteBrandService`, which needs
            // `SHARED_ENVIRONMENT`. The brand source is supplied synchronously
            // so no spec in this file makes an HTTP request for the site config.
            ...provideTestBrand(),
            provideRouter([]),
            { provide: ProfileService, useValue: { getProfile } },
            { provide: SeoService, useValue: seo },
            { provide: SiteConfigService, useValue: { config$: of(options.site ?? SITE) } },
        ],
    })
        // House idiom (see `education.component.spec.ts`): without this the real
        // pipe fetches `/assets/i18n/en.json`, which has no origin under the
        // test runner and floods the output with URL-parse failures.
        .overrideComponent(ProjectsComponent, {
            remove: { imports: [TranslatePipe] },
            add: { imports: [MockTranslatePipe] },
        })
        .compileComponents();

    const fixture = TestBed.createComponent(ProjectsComponent);
    fixture.componentInstance.standalone = options.standalone;
    fixture.componentInstance.profile = options.profile ?? null;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, getProfile, seo, el: fixture.nativeElement as HTMLElement };
}

describe('ProjectsComponent', () => {
    beforeEach(() => {
        TestBed.resetTestingModule();
    });

    describe('embedded on the home page', () => {
        it('renders a card per project from the injected profile', async () => {
            const { el } = await render({ standalone: false, profile: profileWith(PROJECTS) });
            expect(el.querySelectorAll('[data-testid="project-card"]').length).toEqual(2);
            expect(el.textContent).toContain('Beaconfolio');
            expect(el.textContent).toContain('Second Project');
        });

        // The criterion: "with projects empty or omitted, the site renders
        // cleanly (section hidden)". The bundled demo shipped an empty array
        // until this change, so this is the DEFAULT path for any forker who has
        // not written projects yet — not an edge case.
        it.each([
            ['an empty array', [] as Project[]],
            ['an omitted field', undefined],
        ])('renders NOTHING when the profile has %s', async (_label, projects) => {
            const { el } = await render({ standalone: false, profile: profileWith(projects) });
            expect(el.querySelector('[data-testid="projects-section"]')).toBeNull();
            expect(el.textContent?.trim()).toEqual('');
        });

        it('renders nothing when no profile has arrived yet', async () => {
            const { el } = await render({ standalone: false, profile: null });
            expect(el.querySelector('[data-testid="projects-section"]')).toBeNull();
        });

        // Embedded, the component must not fetch: the page that hosts it has
        // already loaded the profile, and a second request would be a duplicate
        // round trip on every home-page render.
        it('leaves the head to the home page', async () => {
            const { seo, el } = await render({ standalone: false, profile: profileWith(PROJECTS) });
            expect(seo.updateSeo).not.toHaveBeenCalled();
            expect(el.querySelector('h1')).toBeNull();
        });

        it('does not call the profile service', async () => {
            const { getProfile } = await render({
                standalone: false,
                profile: profileWith(PROJECTS),
            });
            expect(getProfile).not.toHaveBeenCalled();
        });

        it('links to the full list', async () => {
            const { el } = await render({ standalone: false, profile: profileWith(PROJECTS) });
            expect(el.querySelector('[data-testid="projects-all-link"]')).not.toBeNull();
        });
    });

    describe('on its own /projects route', () => {
        // The bug: without its own updateSeo the page inherited the default
        // `{site}/` canonical — declaring /projects a duplicate of home.
        it('declares its own canonical, title, description and breadcrumb', async () => {
            const { seo, el } = await render({ standalone: true });
            expect(seo.updateSeo).toHaveBeenCalledWith({
                title: 'Projects',
                description: 'Projects and case studies by Jane Doe, Staff Engineer.',
                url: '/projects',
            });
            const graph = seo.setJsonLd.mock.calls[0][0];
            expect(graph['@graph'][0]['itemListElement'].map((i: { item: string }) => i.item)).toEqual([
                'https://example.com/',
                'https://example.com/projects',
            ]);
            // Its own route: the section title is the page's one h1.
            expect(el.querySelectorAll('h1')).toHaveLength(1);
        });

        it('omits the role clause when the headline names none', async () => {
            const { seo } = await render({ standalone: true, site: { ...SITE, ownerHeadline: '' } });
            expect(seo.updateSeo).toHaveBeenCalledWith(
                expect.objectContaining({ description: 'Projects and case studies by Jane Doe.' }),
            );
        });

        it('fetches the profile and renders the cards', async () => {
            const { el, getProfile } = await render({ standalone: true });
            expect(getProfile).toHaveBeenCalled();
            expect(el.querySelectorAll('[data-testid="project-card"]').length).toEqual(2);
            expect(el.querySelector('[data-testid="projects-page"]')).not.toBeNull();
        });

        // Standalone the page must still EXIST with no projects — a bare 404
        // for a nav entry that is always visible would be worse than an empty
        // list that says so.
        it('shows an empty state rather than an empty page', async () => {
            const { el } = await render({ standalone: true, served: profileWith([]) });
            expect(el.querySelector('[data-testid="projects-page"]')).not.toBeNull();
            expect(el.querySelector('[data-testid="projects-empty"]')).not.toBeNull();
            expect(el.querySelectorAll('[data-testid="project-card"]').length).toEqual(0);
        });

        it('renders the header chrome', async () => {
            const { el } = await render({ standalone: true });
            expect(el.querySelector('app-header')).not.toBeNull();
        });
    });

    describe('card contents', () => {
        it('renders stack, role, period and both links', async () => {
            const { el } = await render({ standalone: false, profile: profileWith(PROJECTS) });
            const card = el.querySelector('[data-testid="project-card"]') as HTMLElement;
            expect(card.querySelectorAll('[data-testid="project-stack"] li').length).toEqual(2);
            expect(card.textContent).toContain('Creator');
            expect(card.textContent).toContain('2025 — present');
            expect(card.querySelector('[data-testid="project-source"]')?.getAttribute('href')).toEqual(
                'https://github.com/janedoe/b'
            );
            expect(card.querySelector('[data-testid="project-demo"]')?.getAttribute('href')).toEqual(
                'https://example.com/'
            );
        });

        it('omits the optional blocks a sparse project does not carry', async () => {
            const { el } = await render({
                standalone: false,
                profile: profileWith([{ title: 'Bare' }]),
            });
            const card = el.querySelector('[data-testid="project-card"]') as HTMLElement;
            expect(card.querySelector('[data-testid="project-stack"]')).toBeNull();
            expect(card.querySelector('[data-testid="project-source"]')).toBeNull();
            expect(card.querySelector('[data-testid="project-demo"]')).toBeNull();
            expect(card.querySelector('img')).toBeNull();
            expect(card.textContent).toContain('Bare');
        });

        // The projection is what keeps a hostile href out of the DOM; this
        // asserts it survives the trip through the template rather than only
        // in the pure unit.
        it('never renders a non-http(s) link', async () => {
            const { el } = await render({
                standalone: false,
                profile: profileWith([
                    {
                        title: 'Risky',
                        links: { source: 'javascript:alert(1)', demo: 'https://ok.example/' },
                    },
                ]),
            });
            const hrefs = Array.from(el.querySelectorAll('a[href]')).map((a) =>
                a.getAttribute('href')
            );
            expect(hrefs.length).toBeGreaterThan(0);
            expect(hrefs.every((h) => /^(https?:\/\/|\/)/.test(h ?? ''))).toBe(true);
        });

        it('renders an image when the project carries one', async () => {
            const { el } = await render({
                standalone: false,
                profile: profileWith([{ title: 'Shot', image: 'assets/shot.png' }]),
            });
            expect(el.querySelector('img')?.getAttribute('src')).toEqual('assets/shot.png');
        });

        it('renders a period with only one date, and none with neither', async () => {
            const { el } = await render({
                standalone: false,
                profile: profileWith([
                    { title: 'OnlyStart', startDate: '2020' },
                    { title: 'NoDates' },
                ]),
            });
            expect(el.textContent).toContain('[2020]');
        });
    });
});
