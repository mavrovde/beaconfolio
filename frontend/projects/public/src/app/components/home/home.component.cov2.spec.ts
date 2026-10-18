import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { vi } from 'vitest';
import { of } from 'rxjs';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { HomeComponent } from './home.component';
import { ProfileService } from '../../services/profile.service';
import { SeoService } from '../../services/seo.service';
import { SiteConfigService } from '../../services/site-config.service';
import { LanguageService, provideSharedEnvironment } from '@beaconfolio/shared';
import { MockLanguageService } from '@beaconfolio/shared/testing';

function makeProfile(overrides: any = {}) {
  return {
    name: 'Test',
    headline: 'Headline',
    location: 'Loc',
    about: 'About',
    contact: { email: 'e', linkedin: 'l' },
    experience: [],
    education: [],
    skills: ['Angular', 'TypeScript'],
    certifications: [],
    languages: [],
    recommendations: [],
    ...overrides,
  };
}

// The profile$ and route.fragment observables are synchronous (of(...)),
// so the SEO logic under test runs synchronously during detectChanges().
async function configure(opts: {
  profile: any;
  fragment: any;
  snapshotFragment?: any;
  platformId?: any;
  lastModified?: string | null;
}) {
  const profileService = {
    getProfile: () => of(opts.profile),
    getLastModified: () => of(opts.lastModified ?? null),
  };
  const mockActivatedRoute = {
    // no fragment in snapshot -> scroll interval clears immediately on browser
    snapshot: { fragment: opts.snapshotFragment ?? null },
    fragment: of(opts.fragment),
  };

  await TestBed.configureTestingModule({
    imports: [HomeComponent, HttpClientTestingModule],
    providers: [
      provideSharedEnvironment({ production: false, apiUrl: '', apiPrefix: '/api/app', googleAnalyticsId: '' }),
      { provide: ProfileService, useValue: profileService },
      { provide: LanguageService, useClass: MockLanguageService },
      { provide: ActivatedRoute, useValue: mockActivatedRoute },
      { provide: PLATFORM_ID, useValue: opts.platformId ?? 'browser' },
      {
        provide: SiteConfigService,
        useValue: {
          config$: of({
            siteName: 'beaconfolio.com', siteUrl: 'https://beaconfolio.com',
            ownerName: 'Mock Owner', ownerHeadline: 'Principal Software Engineer',
            ownerDescription: 'Desc.',
            socialLinks: ['https://social.example/mock', 'https://github.com/janedoe'],
            analyticsId: '',
                availability: 'listening',
            }),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(HomeComponent);
  const seoService = TestBed.inject(SeoService) as any;
  seoService.updateSeo = vi.fn();
  seoService.setJsonLd = vi.fn();
  return { fixture, seoService };
}

describe('HomeComponent coverage (branches)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('does nothing when profile is falsy', async () => {
    const { fixture, seoService } = await configure({
      profile: null,
      fragment: 'about',
    });
    fixture.detectChanges();
    expect(seoService.updateSeo).not.toHaveBeenCalled();
    expect(seoService.setJsonLd).not.toHaveBeenCalled();
  });

  it('uses the COMPOSED home title when there is no fragment', async () => {
    const { fixture, seoService } = await configure({
      profile: makeProfile({ name: 'Jane Doe', headline: 'Staff Engineer @ Acme | Go', location: 'Berlin, Germany' }),
      fragment: null,
    });
    fixture.detectChanges();
    expect(seoService.updateSeo).toHaveBeenCalledWith(
      expect.objectContaining({ fullTitle: 'Jane Doe - Staff Engineer | Berlin' })
    );
  });

  it('uses the composed home title when the fragment is not a known section', async () => {
    const { fixture, seoService } = await configure({
      profile: makeProfile({ name: 'Jane Doe', headline: 'Staff Engineer' }),
      fragment: 'unknown-section',
    });
    fixture.detectChanges();
    const call = seoService.updateSeo.mock.calls[0][0];
    expect(call.fullTitle).toBe('Jane Doe - Staff Engineer | Loc');
    expect(call.title).toBeUndefined();
  });

  it('titles a known section by its name', async () => {
    const { fixture, seoService } = await configure({
      profile: makeProfile(),
      fragment: 'about',
    });
    fixture.detectChanges();
    expect(seoService.updateSeo).toHaveBeenCalledWith(expect.objectContaining({ title: 'About' }));
  });

  it('composes a plain-text description and tidy keywords from the profile', async () => {
    const { fixture, seoService } = await configure({
      profile: makeProfile({
        name: 'Jane Doe',
        headline: 'Staff Engineer @ Acme | Angular, TypeScript',
        location: 'Berlin, Germany',
        about: 'Builds &amp; ships web platforms.',
      }),
      fragment: null,
    });
    fixture.detectChanges();
    const call = seoService.updateSeo.mock.calls[0][0];
    expect(call.description).toBe(
      'Jane Doe is a Staff Engineer based in Berlin, Germany. Specialises in Angular and TypeScript. ' +
        'Open to hearing about new opportunities.'
    );
    expect(call.description).not.toContain('&amp;');
    expect(call.keywords).toBe('Staff Engineer, Berlin, Angular, TypeScript');
  });

  it('emits Person + WebSite + ProfilePage as ONE graph, dated by the profile', async () => {
    const { fixture, seoService } = await configure({
      profile: makeProfile(),
      fragment: null,
      lastModified: '2026-09-10T11:46:15+00:00',
    });
    fixture.detectChanges();
    const graph = seoService.setJsonLd.mock.calls[0][0];
    expect(graph['@context']).toBe('https://schema.org');
    expect(graph['@graph'].map((node: any) => node['@type'])).toEqual(['Person', 'WebSite', 'ProfilePage']);
    const page = graph['@graph'][2];
    expect(page.dateModified).toBe('2026-09-10T11:46:15+00:00');
    expect(page.mainEntity).toEqual({ '@id': 'https://beaconfolio.com/#person' });
  });

  it('does not run scroll logic on server platform', async () => {
    const initSpy = vi.spyOn(HomeComponent.prototype as any, 'initScrollLogic');
    const { fixture, seoService } = await configure({
      profile: makeProfile(),
      fragment: 'about',
      platformId: 'server',
    });
    fixture.detectChanges();
    expect(initSpy).not.toHaveBeenCalled();
    // JSON-LD is still set on the server
    expect(seoService.setJsonLd).toHaveBeenCalled();
    initSpy.mockRestore();
  });

  it('does not start the scroll logic in the browser when the profile is empty', async () => {
    const initSpy = vi.spyOn(HomeComponent.prototype as any, 'initScrollLogic');
    const { fixture } = await configure({ profile: null, fragment: null });
    fixture.detectChanges();
    expect(initSpy).not.toHaveBeenCalled();
    initSpy.mockRestore();
  });
});
