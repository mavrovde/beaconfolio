import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, ReplaySubject, Subject, of } from 'rxjs';

import { TranslatePipe } from '@beaconfolio/shared';
import { MockTranslatePipe } from '@beaconfolio/shared/testing';

import { ProjectDetailComponent } from './project-detail.component';
import { Profile, ProfileService } from '../../../services/profile.service';
import { SeoService } from '../../../services/seo.service';
import {
    DEFAULT_SITE_CONFIG,
    SiteConfig,
    SiteConfigService,
} from '../../../services/site-config.service';
import { Project } from '../../../projects-model/projects';

const PROJECTS: Project[] = [
    {
        title: 'Beaconfolio',
        summary: 'A portfolio template',
        description: 'Long form\nacross lines',
        role: 'Creator',
        startDate: '2025',
        endDate: 'present',
        techStack: ['Angular', 'FastAPI'],
        links: { source: 'https://github.com/janedoe/b', demo: 'https://example.com' },
        image: 'assets/shot.png',
    },
    { title: 'Portfolio' },
    { title: 'Portfolio' },
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

// `projects` is REQUIRED, deliberately. It was written with a `= PROJECTS`
// default, and the `it.each` row that passes an explicit `undefined` then hit
// that default instead — so the "profile carries no projects" case rendered the
// full list and asserted the opposite of its name. A default parameter cannot
// distinguish "omitted" from "explicitly undefined"; making it required removes
// the ambiguity at the call site rather than documenting it.
async function render(
    slug: string | undefined,
    projects: Project[] | undefined,
    served?: Profile | null,
    options: {
        platformId?: object;
        responseInit?: ResponseInit | null;
        siteUrl?: string;
        // The two streams the view is combined from, injectable so a test can
        // control their ORDER (and their absence). Both are synchronous in the
        // default case, which is precisely why the ordering bug this pins was
        // invisible to every other spec in the file.
        profile$?: Observable<Profile | null>;
        config$?: Observable<SiteConfig>;
    } = {}
) {
    const params = new BehaviorSubject(
        convertToParamMap(slug === undefined ? {} : { slug })
    );
    const profile = served === undefined ? profileWith(projects) : served;
    const seo = {
        updateSeo: vi.fn(),
        setJsonLd: vi.fn(),
        setNotFound: vi.fn(),
    };
    const responseInit: ResponseInit | null =
        options.responseInit === undefined ? {} : options.responseInit;
    await TestBed.configureTestingModule({
        imports: [ProjectDetailComponent],
        providers: [
            provideRouter([]),
            {
                provide: ProfileService,
                useValue: { getProfile: () => options.profile$ ?? of(profile) },
            },
            { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
            { provide: SeoService, useValue: seo },
            {
                provide: SiteConfigService,
                useValue: {
                    config$:
                        options.config$ ??
                        of({
                            ...DEFAULT_SITE_CONFIG,
                            siteUrl: options.siteUrl ?? 'https://example.com',
                        }),
                },
            },
            { provide: PLATFORM_ID, useValue: options.platformId ?? 'browser' },
            { provide: RESPONSE_INIT, useValue: responseInit },
        ],
    })
        .overrideComponent(ProjectDetailComponent, {
            remove: { imports: [TranslatePipe] },
            add: { imports: [MockTranslatePipe] },
        })
        .compileComponents();

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, params, seo, responseInit, el: fixture.nativeElement as HTMLElement };
}

describe('ProjectDetailComponent', () => {
    beforeEach(() => {
        TestBed.resetTestingModule();
        vi.restoreAllMocks();
    });

    it('renders the project named by the slug', async () => {
        const { el } = await render('beaconfolio', PROJECTS);
        expect(el.querySelector('[data-testid="project-detail"]')).not.toBeNull();
        expect(el.textContent).toContain('Beaconfolio');
        expect(el.textContent).toContain('A portfolio template');
        expect(el.textContent).toContain('Long form');
        expect(el.textContent).toContain('Creator');
        expect(el.textContent).toContain('2025 — present');
        expect(el.querySelectorAll('[data-testid="detail-stack"] li').length).toEqual(2);
        expect(el.querySelector('[data-testid="detail-source"]')?.getAttribute('href')).toEqual(
            'https://github.com/janedoe/b'
        );
        expect(el.querySelector('[data-testid="detail-demo"]')?.getAttribute('href')).toEqual(
            'https://example.com/'
        );
        expect(el.querySelector('img')?.getAttribute('src')).toEqual('assets/shot.png');
    });

    // The whole reason the lookup runs the projection instead of indexing the
    // raw array: the list LINKS to the de-duplicated slug, so without it both
    // "Portfolio" projects would resolve to the first one.
    it('resolves a de-duplicated slug to the second project, not the first', async () => {
        const { el } = await render('portfolio-2', PROJECTS);
        expect(el.querySelector('[data-testid="project-detail"]')).not.toBeNull();
        expect(el.querySelector('[data-testid="project-missing"]')).toBeNull();
    });

    it.each([
        ['an unknown slug', 'no-such-project', PROJECTS],
        ['an empty slug', '', PROJECTS],
        ['a profile with no projects', 'beaconfolio', undefined],
    ])('shows the not-found panel for %s', async (_label, slug, projects) => {
        const { el } = await render(slug, projects as Project[] | undefined);
        expect(el.querySelector('[data-testid="project-missing"]')).not.toBeNull();
        expect(el.querySelector('[data-testid="project-detail"]')).toBeNull();
    });

    it('omits the optional blocks a sparse project does not carry', async () => {
        const { el } = await render('bare', [{ title: 'Bare' }]);
        expect(el.querySelector('[data-testid="project-detail"]')).not.toBeNull();
        expect(el.querySelector('[data-testid="detail-stack"]')).toBeNull();
        expect(el.querySelector('[data-testid="detail-source"]')).toBeNull();
        expect(el.querySelector('[data-testid="detail-demo"]')).toBeNull();
        expect(el.querySelector('img')).toBeNull();
    });

    // The component combines the profile with paramMap, so a slug change within
    // the same component instance must re-resolve. Angular reuses the component
    // when only the parameter changes, so this is the live case, not a contrived
    // one.
    it('re-resolves when the route parameter changes', async () => {
        const { fixture, params, el } = await render('beaconfolio', PROJECTS);
        expect(el.textContent).toContain('A portfolio template');

        params.next(convertToParamMap({ slug: 'portfolio' }));
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(el.textContent).not.toContain('A portfolio template');
        expect(el.querySelector('[data-testid="project-detail"]')).not.toBeNull();
    });

    // `getProfile()` is DECLARED `Observable<Profile>`, but the declaration is
    // not a validation: it is `http.get<Profile>()` over the API with a fallback
    // to a bundled JSON file a forker edits by hand, and either can deliver a
    // `null` body. Without the optional chain that lands as a TypeError inside
    // the `map`, which kills the stream and renders neither panel.
    it('shows the not-found panel when the profile itself is null', async () => {
        const { el } = await render('beaconfolio', undefined, null);
        expect(el.querySelector('[data-testid="project-missing"]')).not.toBeNull();
        expect(el.querySelector('[data-testid="project-detail"]')).toBeNull();
    });

    // `paramMap.get` returns `null`, not `undefined`, for a parameter the URL
    // does not carry — so the `?? ''` is what keeps a missing segment out of
    // `findProject` as a null.
    it('shows the not-found panel when the route carries no slug at all', async () => {
        const { el } = await render(undefined, PROJECTS);
        expect(el.querySelector('[data-testid="project-missing"]')).not.toBeNull();
    });

    it('renders a period with only one date', async () => {
        const { el } = await render('solo', [{ title: 'Solo', startDate: '2019' }]);
        expect(el.textContent).toContain('[2019]');
    });

    it('never renders a non-http(s) link', async () => {
        const { el } = await render('risky', [
            { title: 'Risky', links: { source: 'javascript:alert(1)' } },
        ]);
        // Scoped to the ARTICLE. An unscoped `a[href]` also collects the
        // header's nav, whose fragment links (`#blog`, `#about`) are not what
        // this test is about and made the assertion fail for the wrong reason.
        const hrefs = Array.from(
            el.querySelectorAll('[data-testid="project-detail"] a[href]')
        ).map((a) => a.getAttribute('href'));
        expect(hrefs.length).toBeGreaterThan(0);
        expect(hrefs.every((h) => /^(https?:\/\/|\/)/.test(h ?? ''))).toBe(true);
    });

    // --- SEO / structured data (#92 proposed action 7, cross-ref #71) --------

    it('publishes the page metadata and a SoftwareSourceCode node', async () => {
        const { seo } = await render('beaconfolio', PROJECTS);
        expect(seo.updateSeo).toHaveBeenCalledWith({
            title: 'Beaconfolio',
            description: 'A portfolio template',
            url: '/projects/beaconfolio',
            image: 'assets/shot.png',
            keywords: 'Angular, FastAPI',
        });
        expect(seo.setJsonLd).toHaveBeenCalledWith(
            expect.objectContaining({
                '@type': 'SoftwareSourceCode',
                name: 'Beaconfolio',
                url: 'https://example.com/projects/beaconfolio',
                codeRepository: 'https://github.com/janedoe/b',
                // Taken from the PROFILE, not from config: the schema names the
                // person whose portfolio this is.
                author: { '@type': 'Person', name: 'Jane Doe' },
            })
        );
        expect(seo.setNotFound).not.toHaveBeenCalled();
    });

    // A missing project must be a REAL 404, not a soft 404 served as 200 — the
    // same contract `blog-post` carries for a missing post (#109). A soft 404
    // gets the not-found body indexed as a live page.
    it('sets a 404 status when the slug is unknown and the render is on the server', async () => {
        const { seo, responseInit } = await render('no-such-project', PROJECTS, undefined, {
            platformId: 'server',
        });
        expect(seo.setNotFound).toHaveBeenCalledWith('Project');
        expect(responseInit?.status).toEqual(404);
        expect(seo.setJsonLd).not.toHaveBeenCalled();
    });

    it.each([
        ['in the browser', { platformId: 'browser' }],
        ['on a server with no response to write to', { platformId: 'server', responseInit: null }],
    ])('marks not-found without a status %s', async (_label, options) => {
        const { seo, responseInit } = await render('no-such-project', PROJECTS, undefined, options);
        expect(seo.setNotFound).toHaveBeenCalledWith('Project');
        expect(responseInit?.status).toBeUndefined();
    });

    // The bug this pins: the config used to be latched into a field by its own
    // `subscribe`, so whichever HTTP stream resolved FIRST decided what the
    // JSON-LD claimed. A profile that arrived before the config built the node
    // against `DEFAULT_SITE_CONFIG.siteUrl === ''` — `schema.url` omitted — and
    // nothing ever rebuilt it. Every other spec in this file injects a
    // synchronous `of(...)` for both, which is exactly why none of them could
    // see it (#451 review round 1, finding 5).
    it('builds the JSON-LD from the config even when the profile resolves first', async () => {
        const config$ = new ReplaySubject<SiteConfig>(1);
        const { seo } = await render('beaconfolio', PROJECTS, undefined, { config$ });

        // Profile in, config not yet: nothing may be published on a config the
        // component has not seen.
        expect(seo.setJsonLd).not.toHaveBeenCalled();

        config$.next({ ...DEFAULT_SITE_CONFIG, siteUrl: 'https://late.example' });
        await Promise.resolve();

        expect(seo.setJsonLd).toHaveBeenCalledTimes(1);
        const node = seo.setJsonLd.mock.calls[0][0] as Record<string, unknown>;
        expect(node['url']).toEqual('https://late.example/projects/beaconfolio');
    });

    // A two-state template renders its `@else` while the profile is still in
    // flight, so navigating to a project that DOES exist flashed "That project
    // no longer exists." first. `loading` is a real third arm, as `blog-post`
    // has carried since #25.
    it('renders the loading arm — not the not-found panel — before the profile arrives', async () => {
        const profile$ = new Subject<Profile | null>();
        const { el, seo, responseInit } = await render('beaconfolio', PROJECTS, undefined, {
            profile$,
            platformId: 'server',
        });

        expect(el.querySelector('[data-testid="project-loading"]')).not.toBeNull();
        expect(el.querySelector('[data-testid="project-missing"]')).toBeNull();
        expect(el.querySelector('[data-testid="project-detail"]')).toBeNull();
        // …and the pending state must not have written a 404 to the response.
        expect(seo.setNotFound).not.toHaveBeenCalled();
        expect(responseInit?.status).toBeUndefined();
    });

    // The config default is an empty `siteUrl`; the node must still be emitted,
    // simply without claiming an absolute URL.
    it('still emits a node when no site URL is configured', async () => {
        const { seo } = await render('beaconfolio', PROJECTS, undefined, { siteUrl: '' });
        const node = seo.setJsonLd.mock.calls[0][0] as Record<string, unknown>;
        expect(node['name']).toEqual('Beaconfolio');
        expect(node['url']).toBeUndefined();
    });
});
