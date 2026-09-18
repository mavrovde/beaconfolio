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
import { DomSanitizer } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { CookieConsentComponent } from './components/cookie-consent/cookie-consent.component';
import { SystemStatsComponent } from './components/stats/stats.component';

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
  let mockSeoService: { schemaSubject: BehaviorSubject<any>, jsonLdSchema$: any };
  let mockSanitizer: any;
  let gaService: { initialize: any; gtmNoscriptUrl$: BehaviorSubject<any> };
  let trustUrl: (url: string) => any;

  beforeEach(async () => {
    const mockGaService = {
      initialize: vi.fn(),
      gtmNoscriptUrl$: new BehaviorSubject<any>(null),
    };
    gaService = mockGaService;

    mockSeoService = {
      schemaSubject: new BehaviorSubject<any>(null),
      get jsonLdSchema$() { return this.schemaSubject.asObservable(); }
    };

    // A resource-URL binding is sanitized by Angular itself, and only a value
    // produced by the REAL DomSanitizer survives it (the check is an
    // `instanceof`, so a duck-typed stub throws NG0904). Capture a real
    // instance from a scratch TestBed before this suite overrides the token.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const realSanitizer = TestBed.inject(DomSanitizer);
    TestBed.resetTestingModule();

    mockSanitizer = {
      bypassSecurityTrustHtml: vi.fn().mockReturnValue('safe-html'),
      bypassSecurityTrustResourceUrl: (url: string) =>
        realSanitizer.bypassSecurityTrustResourceUrl(url)
    };
    trustUrl = mockSanitizer.bypassSecurityTrustResourceUrl;

    await TestBed.configureTestingModule({
      imports: [AppComponent, RouterTestingModule],
      providers: [
        { provide: GoogleAnalyticsService, useValue: mockGaService },
        { provide: ViewportScroller, useValue: { setOffset: vi.fn() } },
        { provide: SeoService, useValue: mockSeoService },
        { provide: DomSanitizer, useValue: mockSanitizer }
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

  // The GTM <noscript> must render from the TEMPLATE, not as a side effect of
  // initialize() (#447). The real initialize() installs nothing under SSR — it
  // is guarded by isPlatformBrowser and returns early — so a visitor with
  // JavaScript disabled receives only what the server put in the HTML. Here
  // initialize() is a no-op mock, which stands in for exactly that: the iframe
  // below is produced by the stream alone. Wire the iframe to initialize()'s
  // side effects and this case goes red.
  it('renders the GTM noscript iframe from the stream, not from initialize()', () => {
    expect(fixture.debugElement.query(By.css('noscript iframe'))).toBeNull();

    gaService.gtmNoscriptUrl$.next(
      trustUrl('https://www.googletagmanager.com/ns.html?id=GTM-ABC1234')
    );
    fixture.detectChanges();

    const iframe = fixture.debugElement.query(By.css('noscript iframe'));
    expect(iframe).not.toBeNull();
    expect(iframe.nativeElement.getAttribute('src'))
      .toBe('https://www.googletagmanager.com/ns.html?id=GTM-ABC1234');
  });

  it('should create the app', () => {
    expect(component).toBeTruthy();
  });

  it('should have a router-outlet', () => {
    const debugElement = fixture.debugElement.query(By.directive(RouterOutlet));
    expect(debugElement).toBeTruthy();
  });

  it('should return null when schema is falsy', async () => {
    mockSeoService.schemaSubject.next(null);
    return new Promise<void>((resolve) => {
      component.jsonLd$?.subscribe((val: any) => {
        expect(val).toBeNull();
        resolve();
      });
    });
  });

  it('should bypass security trust html when schema is provided', async () => {
    mockSeoService.schemaSubject.next({ "@context": "https://schema.org" });
    return new Promise<void>((resolve) => {
      component.jsonLd$?.subscribe((val: any) => {
        expect(mockSanitizer.bypassSecurityTrustHtml).toHaveBeenCalledWith(
          '<script type="application/ld+json">{\n  "@context": "https://schema.org"\n}</script>'
        );
        expect(val).toBe('safe-html');
        resolve();
      });
    });
  });
});
