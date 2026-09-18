import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { RouterTestingModule } from '@angular/router/testing';
import { GoogleAnalyticsService } from './services/google-analytics.service';
import { SeoService } from './services/seo.service';
import { SiteConfigService } from './services/site-config.service';
import { ViewportScroller } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { firstValueFrom, of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Component } from '@angular/core';
import { ThemeService } from '@beaconfolio/shared';
import { CookieConsentComponent } from './components/cookie-consent/cookie-consent.component';
import { SystemStatsComponent } from './components/stats/stats.component';
import { provideTestBrand } from '@beaconfolio/shared/testing';

@Component({ selector: 'app-cookie-consent', standalone: true, template: '' })
class MockCookieConsentComponent { }

@Component({ selector: 'app-system-stats', standalone: true, template: '' })
class MockSystemStatsComponent { }

describe('AppComponent jsonLd stream', () => {
  let seoService: SeoService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent, RouterTestingModule],
      providers: [
        ...provideTestBrand(),
        { provide: GoogleAnalyticsService, useValue: { initialize: vi.fn() } },
        { provide: ViewportScroller, useValue: { setOffset: vi.fn() } },
        // The shared ThemeService (#67) — stubbed here because this spec is
        // about the JSON-LD stream; its own behaviour is covered in the
        // shared library, against a real DOCUMENT.
        { provide: ThemeService, useValue: { initialize: vi.fn(), apply: vi.fn() } },
        {
          provide: SiteConfigService,
          useValue: {
            config$: of({
              siteName: 'beaconfolio.com', siteUrl: 'https://beaconfolio.com',
              ownerName: 'Mock Owner', ownerHeadline: 'Principal Software Engineer',
              ownerDescription: 'Desc.', socialLinks: [],
              analyticsId: '',
            }),
          },
        },
      ],
    })
      .overrideComponent(AppComponent, {
        remove: { imports: [CookieConsentComponent, SystemStatsComponent] },
        add: { imports: [MockCookieConsentComponent, MockSystemStatsComponent] },
      })
      .compileComponents();

    seoService = TestBed.inject(SeoService);
  });

  it('should build sanitized jsonLd script when schema is present', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    const sanitizer = TestBed.inject(DomSanitizer);
    const bypassSpy = vi.spyOn(sanitizer, 'bypassSecurityTrustHtml');

    seoService.setJsonLd({ '@type': 'Person', name: 'Test' });
    fixture.detectChanges();

    const emitted = await firstValueFrom(component.jsonLd$);

    expect(bypassSpy).toHaveBeenCalled();
    const arg = bypassSpy.mock.calls[0][0];
    expect(arg).toContain('application/ld+json');
    expect(arg).toContain('"name": "Test"');
    expect(emitted).toBeTruthy();
  });

  it('should emit null when schema is null', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const emitted = await firstValueFrom(component.jsonLd$);
    expect(emitted).toBeNull();
  });
});
