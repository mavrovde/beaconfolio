import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { GoogleAnalyticsService } from './services/google-analytics.service';
import { SeoService } from './services/seo.service';
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
    <router-outlet></router-outlet>
    <app-cookie-consent></app-cookie-consent>
    <app-system-stats></app-system-stats>
    `,
})
export class AppComponent implements OnInit {
  private googleAnalyticsService = inject(GoogleAnalyticsService);
  private viewportScroller = inject(ViewportScroller);
  private seoService = inject(SeoService);
  private sanitizer = inject(DomSanitizer);

  jsonLd$?: Observable<SafeHtml | null>;

  ngOnInit() {
    this.googleAnalyticsService.initialize();
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
