import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GoogleAnalyticsService } from './services/google-analytics.service';
import { SeoService } from './services/seo.service';
import { BrandAssetsService, LanguageService, ThemeService } from '@beaconfolio/shared';
import { CookieConsentComponent } from './components/cookie-consent/cookie-consent.component';
import { SystemStatsComponent } from './components/stats/stats.component';

import { ViewportScroller } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CookieConsentComponent, SystemStatsComponent],
  template: `
    <!-- The JSON-LD block lives in <head> (SeoService) and the GTM <noscript>
         at the top of <body> (GoogleAnalyticsService.renderNoscript) — both
         written into the injected document, so neither needs a sanitizer
         bypass. -->
    <router-outlet></router-outlet>
    <app-cookie-consent></app-cookie-consent>
    <app-system-stats></app-system-stats>
    `,
})
export class AppComponent implements OnInit {
  private googleAnalyticsService = inject(GoogleAnalyticsService);
  private viewportScroller = inject(ViewportScroller);
  private seoService = inject(SeoService);
  private themeService = inject(ThemeService);
  private brandAssets = inject(BrandAssetsService);
  private languageService = inject(LanguageService);

  ngOnInit() {
    this.googleAnalyticsService.initialize();
    // #447: the <noscript> half — server-only, see the service.
    this.googleAnalyticsService.renderNoscript();
    // The preset theme (#339), stamped on the root element from here rather
    // than from an app initializer — see ThemeService for the build failure
    // that rules the initializer out. It sits beside the GA call because both
    // read the same `config$` at the same point in the render.
    //
    // The service is the SHARED one (#67). Neither call passes a stream:
    // `app.config.ts` provides `SITE_BRAND_SOURCE`, so the shared library
    // reads THIS app's existing `config$` and opens no request of its own —
    // and a second request for a handful of fields would be a second thing
    // that can hang the route-extraction build.
    this.themeService.initialize();
    // The brand ASSETS (#67) — favicon, webfont, font family. Same call site
    // and same reasoning as the theme: both mutate the document's head from
    // the one config read, during the render rather than after it.
    this.brandAssets.initialize();
    this.viewportScroller.setOffset([0, 80]);
    // `<html lang>` + `og:locale` follow the RENDERED language. A DOM write
    // through the injected document (SeoService), not a template binding, so
    // no change-detection trigger is needed in the zoneless app; the root
    // component lives as long as the app, so the subscription needs no teardown.
    this.languageService.currentLang$.subscribe((lang) => this.seoService.setLanguage(lang));
  }
}
