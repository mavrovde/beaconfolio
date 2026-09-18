import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { GoogleAnalyticsService } from './services/google-analytics.service';
import { SeoService } from './services/seo.service';
import { ThemeService } from './services/theme.service';
import { CookieConsentComponent } from './components/cookie-consent/cookie-consent.component';
import { SystemStatsComponent } from './components/stats/stats.component';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Observable, map, delay } from 'rxjs';

import { ViewportScroller } from '@angular/common';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, CookieConsentComponent, SystemStatsComponent],
  template: `
    @if (jsonLd$ | async; as jsonLd) {
      <div [innerHTML]="jsonLd"></div>
    }
    <!-- GTM <noscript> (#447). Server-rendered on purpose: a visitor with no
         JavaScript never runs Angular, so this is the only tag they can send. -->
    @if (gtmNoscriptUrl$ | async; as gtmUrl) {
      <noscript><iframe [src]="gtmUrl" height="0" width="0"
        style="display:none;visibility:hidden"></iframe></noscript>
    }
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
  private sanitizer = inject(DomSanitizer);

  jsonLd$?: Observable<SafeHtml | null>;

  /** #447 — rendered by the template on BOTH platforms; see the service. */
  readonly gtmNoscriptUrl$ = this.googleAnalyticsService.gtmNoscriptUrl$;

  ngOnInit() {
    this.googleAnalyticsService.initialize();
    // The preset theme (#339), stamped on the root element from here rather
    // than from an app initializer — see ThemeService for the build failure
    // that rules the initializer out. It sits beside the GA call because both
    // read the same `config$` at the same point in the render.
    this.themeService.initialize();
    this.viewportScroller.setOffset([0, 80]);

    this.jsonLd$ = this.seoService.jsonLdSchema$.pipe(
      delay(0),
      map(schema => {
        if (!schema) return null;
        const script = `<script type="application/ld+json">${JSON.stringify(schema, null, 2)}</script>`;
        return this.sanitizer.bypassSecurityTrustHtml(script);
      })
    );
  }
}
