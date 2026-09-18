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
}) {
  const profileService = { getProfile: () => of(opts.profile) };
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

  it('does nothing when profile is falsy (line 80 false branch)', async () => {
    const { fixture, seoService } = await configure({
      profile: null,
      fragment: 'about',
    });
    fixture.detectChanges();
    expect(seoService.updateSeo).not.toHaveBeenCalled();
    expect(seoService.setJsonLd).not.toHaveBeenCalled();
  });

  it('uses "Home" title when fragment is null (line 83 false branch)', async () => {
    const { fixture, seoService } = await configure({
      profile: makeProfile(),
      fragment: null,
    });
    fixture.detectChanges();
    expect(seoService.updateSeo).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Home' })
    );
  });

  it('uses "Home" title when fragment is not a known section (line 83 false branch)', async () => {
    const { fixture, seoService } = await configure({
      profile: makeProfile(),
      fragment: 'unknown-section',
    });
    fixture.detectChanges();
    expect(seoService.updateSeo).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Home' })
    );
  });

  it('falls back to headline for description when about is empty (line 89)', async () => {
    const { fixture, seoService } = await configure({
      profile: makeProfile({ about: '', headline: 'Just a headline' }),
      fragment: 'about',
    });
    fixture.detectChanges();
    expect(seoService.updateSeo).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Just a headline' })
    );
  });

  it('falls back to default description when about and headline are empty (line 89)', async () => {
    const { fixture, seoService } = await configure({
      profile: makeProfile({ about: '', headline: '' }),
      fragment: 'about',
    });
    fixture.detectChanges();
    expect(seoService.updateSeo).toHaveBeenCalledWith(
      // With #65 the component no longer hardcodes a fallback description —
      // undefined lets SeoService apply the config-driven default.
      expect.objectContaining({ description: undefined })
    );
  });

  it('does not run scroll logic on server platform (line 94 false branch)', async () => {
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
});
