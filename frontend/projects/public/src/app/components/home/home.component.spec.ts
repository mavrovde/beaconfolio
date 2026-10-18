import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { vi } from 'vitest';
import { HomeComponent } from './home.component';
import { Profile, ProfileService } from '../../services/profile.service';
import { SeoService } from '../../services/seo.service';
import { SiteConfig, SiteConfigService } from '../../services/site-config.service';
import { buildPersonSchema } from '../../seo/person-schema';
import { buildProfilePage, buildWebSite, toGraph } from '../../seo/graph';
import { LanguageService, provideSharedEnvironment } from '@beaconfolio/shared';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { MockLanguageService } from '@beaconfolio/shared/testing';

/** Hoisted so the JSON-LD test can assert the EXACT node built from them (#71). */
const MOCK_PROFILE: Profile = {
  name: 'Test',
  headline: 'Headline',
  location: 'Loc',
  about: 'About',
  contact: { email: 'e', linkedin: 'l' },
  experience: [],
  education: [],
  skills: [],
  certifications: [],
  languages: [],
  recommendations: [],
};

const MOCK_SITE: SiteConfig = {
  siteName: 'beaconfolio.com', siteUrl: 'https://beaconfolio.com',
  ownerName: 'Mock Owner', ownerHeadline: 'Principal Software Engineer',
  ownerDescription: 'Desc.', socialLinks: [],
  analyticsId: '',
  availability: 'listening',
};

// Mock Services
class MockProfileService {
  getProfile() {
    return of(MOCK_PROFILE);
  }
  getLastModified() {
    return of(null);
  }
}

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;

  let mockActivatedRoute: any;

  beforeEach(async () => {
    mockActivatedRoute = {
      snapshot: {
        fragment: 'about'
      },
      fragment: of('about')
    };

    await TestBed.configureTestingModule({
      imports: [
        HomeComponent,
        HttpClientTestingModule,
      ],
      providers: [
        provideSharedEnvironment({ production: false, apiUrl: '', apiPrefix: '/api/app', googleAnalyticsId: '' }),
        { provide: ProfileService, useClass: MockProfileService },
        { provide: LanguageService, useClass: MockLanguageService },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        {
          provide: SiteConfigService,
          useValue: { config$: of(MOCK_SITE) },
        }
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    // fixture.detectChanges(); // Removed to allow tests to configure mock before init
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should fetch profile on init', () => {
    fixture.detectChanges();
    expect(component.profile$).toBeTruthy();
  });

  it('should update SEO and JSON-LD on init when profile is loaded', fakeAsync(() => {
    const seoService = TestBed.inject(SeoService) as unknown as any;
    seoService.updateSeo = vi.fn();
    seoService.setJsonLd = vi.fn();

    fixture.detectChanges();
    tick(); // resolve the pipe(take(1)) observable and fragment subscription
    expect(seoService.updateSeo).toHaveBeenCalled();
    // Pin the WIRING, not just the call: asserting only `toHaveBeenCalled()` let a
    // hand-rolled minimal Person node pass the whole suite (#317 review round 1),
    // because `person-schema.ts` stays fully covered by its own spec either way.
    expect(seoService.setJsonLd).toHaveBeenCalledWith(
      toGraph([
        buildPersonSchema(MOCK_PROFILE, MOCK_SITE),
        buildWebSite(MOCK_SITE, 'en'),
        buildProfilePage(MOCK_SITE, { path: '/', name: 'Test - Headline | Loc', lang: 'en', dateModified: null }),
      ])
    );
  }));

  it('should attempt scrolling if fragment exists', fakeAsync(() => {
    // We mocked 'about' in providers
    const viewportScroller = TestBed.inject(ViewportScroller);
    const scrollSpy = vi.spyOn(viewportScroller, 'scrollToAnchor');

    // Create a dummy element for the fragment
    const div = document.createElement('div');
    div.id = 'about';
    document.body.appendChild(div);

    fixture.detectChanges(); // triggers ngOnInit

    // First interval tick: scrollAttempts === 0 branch
    tick(100);
    expect(scrollSpy).toHaveBeenCalledWith('about');

    // Multiple ticks: scrollAttempts > 0 branch
    tick(100);
    tick(100);

    // Fast forward to finish loop: maxScrollAttempts branch
    tick(1500);

    document.body.removeChild(div);
  }));

  it('should stop trying after max attempts if element not found', fakeAsync(() => {
    mockActivatedRoute.snapshot.fragment = 'non-existent';
    const viewportScroller = TestBed.inject(ViewportScroller);
    const scrollSpy = vi.spyOn(viewportScroller, 'scrollToAnchor');

    fixture.detectChanges(); // triggers ngOnInit

    // Fast forward just below max attempts
    tick(2900);
    expect(scrollSpy).not.toHaveBeenCalled();

    // Hit max attempts (30)
    tick(100);

    // Verify it doesn't run anymore
    tick(1000);

    expect(scrollSpy).not.toHaveBeenCalled();
  }));

  it('should do nothing if no fragment', fakeAsync(() => {
    mockActivatedRoute.snapshot.fragment = null;
    fixture.detectChanges();
    tick(1000);
    // No interval started/everything cleared
  }));
});
