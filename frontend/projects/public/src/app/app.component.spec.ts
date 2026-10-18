import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { RouterTestingModule } from '@angular/router/testing';
import { RouterOutlet } from '@angular/router';
import { By } from '@angular/platform-browser';
import { GoogleAnalyticsService } from './services/google-analytics.service';
import { ViewportScroller } from '@angular/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Component } from '@angular/core';
import { SeoService } from './services/seo.service';
import { DEFAULT_SITE_CONFIG, SiteConfigService } from './services/site-config.service';
import { BrandAssetsService, ThemeService } from '@beaconfolio/shared';
import { of } from 'rxjs';
import { CookieConsentComponent } from './components/cookie-consent/cookie-consent.component';
import { SystemStatsComponent } from './components/stats/stats.component';
import { provideTestBrand } from '@beaconfolio/shared/testing';

@Component({
  selector: 'app-cookie-consent',
  standalone: true,
  template: ''
})
class MockCookieConsentComponent { }

@Component({
  selector: 'app-system-stats',
  standalone: true,
  template: ''
})
class MockSystemStatsComponent { }

describe('AppComponent', () => {
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;
  let mockSeoService: { setLanguage: any };
  let gaService: { initialize: any; renderNoscript: any };
  let themeService: { initialize: any; apply: any };
  let brandAssets: { initialize: any; apply: any };

  beforeEach(async () => {
    const mockGaService = {
      initialize: vi.fn(),
      renderNoscript: vi.fn(),
    };
    gaService = mockGaService;

    themeService = { initialize: vi.fn(), apply: vi.fn() };
    brandAssets = { initialize: vi.fn(), apply: vi.fn() };

    mockSeoService = {
      setLanguage: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AppComponent, RouterTestingModule],
      providers: [
        ...provideTestBrand(),
        { provide: GoogleAnalyticsService, useValue: mockGaService },
        { provide: ViewportScroller, useValue: { setOffset: vi.fn() } },
        { provide: SeoService, useValue: mockSeoService },
        {
          provide: SiteConfigService,
          useValue: { config$: of({ ...DEFAULT_SITE_CONFIG, theme: 'classic' }) },
        },
        { provide: ThemeService, useValue: themeService },
        { provide: BrandAssetsService, useValue: brandAssets }
      ]
    })
      .overrideComponent(AppComponent, {
        remove: { imports: [CookieConsentComponent, SystemStatsComponent] },
        add: { imports: [MockCookieConsentComponent, MockSystemStatsComponent] }
      })
      .compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // The GTM <noscript> half is requested from ngOnInit (#447) — the service
  // writes it into the SERVER-rendered body (see its own spec); the template
  // carries no iframe binding any more, so no sanitizer bypass is needed.
  it('asks the GA service for the server-rendered GTM noscript', () => {
    expect(gaService.renderNoscript).toHaveBeenCalledTimes(1);
    expect(fixture.debugElement.query(By.css('noscript iframe'))).toBeNull();
  });

  // No JSON-LD in the component's own DOM: the block lives in <head>, written
  // by SeoService (seo.service.jsonld.spec.ts).
  it('renders no structured-data markup itself', () => {
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
  });

  // `<html lang>` / `og:locale` follow the rendered language: the root
  // component pushes every language emission into SeoService.
  it('pushes the rendered language into SeoService', () => {
    expect(mockSeoService.setLanguage).toHaveBeenCalledWith('en');
  });

  it('should create the app', () => {
    expect(component).toBeTruthy();
  });

  it('should have a router-outlet', () => {
    const debugElement = fixture.debugElement.query(By.directive(RouterOutlet));
    expect(debugElement).toBeTruthy();
  });

  // #339: the theme is stamped from HERE, not from an app initializer — an
  // initializer that touches `config$` aborts `ng build`'s route extraction
  // (there is no backend behind it and `config$` is a shareReplay, so the
  // request never settles and nothing tears it down). This pins the call site
  // itself, because coverage alone would stay at 100% with the line deleted.
  it('stamps the configured theme on the root element from ngOnInit', () => {
    expect(themeService.initialize).toHaveBeenCalledTimes(1);
  });

  // …and it passes NO stream (#67). The shared library reads this app's
  // existing `config$` through the `SITE_BRAND_SOURCE` provider in
  // `app.config.ts` instead — see `app.config.spec.ts`, which proves that
  // wiring costs exactly one HTTP request. An argument here would mean the
  // theme rode on one stream while the brand assets rode on another.
  it('passes the shared service no stream of its own', () => {
    expect(themeService.initialize).toHaveBeenCalledWith();
  });

  // The brand ASSETS come from the same call site as the theme (#67): favicon
  // and webfont are head mutations, and the head has to be right in the bytes
  // the server sends, not one repaint later.
  it('initializes the brand assets from ngOnInit too', () => {
    expect(brandAssets.initialize).toHaveBeenCalledTimes(1);
    expect(brandAssets.initialize).toHaveBeenCalledWith();
  });

});
