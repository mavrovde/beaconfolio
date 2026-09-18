import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { GoogleAnalyticsService } from './services/google-analytics.service';
import { SeoService } from './services/seo.service';
import { BrandAssetsService, ThemeService } from '@beaconfolio/shared';
import { CookieConsentComponent } from './components/cookie-consent/cookie-consent.component';
import { SystemStatsComponent } from './components/stats/stats.component';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Observable, map, delay } from 'rxjs';

import { ViewportScroller } from '@angular/common';

/**
 * Serialize a JSON-LD schema for embedding inside a `<script>` ELEMENT.
 *
 * `JSON.stringify` escapes what JSON needs escaped; it does not escape `<`,
 * because `<` is a perfectly ordinary character in a JSON string. Inside a
 * `<script>` block it is not: the HTML parser ends the element at the first
 * `</script>` it sees, wherever that sits — inside a quoted string included.
 * So a post title reading `</script><img src=x onerror=…>` closes the JSON-LD
 * block early and everything after it is parsed as markup.
 *
 * Measured before this was written, on the real serializer:
 *
 *     JSON.stringify({ headline: 'Post </script><img src=x onerror=alert(1)>' })
 *       // → the rendered block contains a literal </script>: breaks out
 *
 * `\u003c` is a valid JSON escape for `<`, so escaping it costs nothing —
 * `JSON.parse` yields a byte-identical object, verified in the spec — and it
 * is the one character that has to go. Nothing here is exploitable by an
 * untrusted party today: every writer on this path is authenticated (the admin
 * SPA, or the token-gated LinkedIn importer). This is the cheap half of
 * defence in depth, taken while it is still cheap, so that the day some
 * unauthenticated text reaches post content this is not also true.
 *
 * EVERY `<` is escaped, not just the ones that begin a closing tag — and
 * that is not belt-and-braces. The HTML tokenizer leaves script-data
 * state through `<` by TWO doors: `</` ends the element, and `<!--`
 * opens a comment-escape state in which a following `<script` swallows
 * the markup after it. A fix narrowed to the literal `</script>` passes
 * every test in the spec beside this file and still loses the document
 * to a headline reading `<!--<script>`. Escaping the one character both
 * doors need closes both.
 *
 * Flagged as `typescript:S6268` by the v1.16.0 release security triage. The
 * rule fires on every `bypassSecurityTrust*` call; here it was right.
 */
export function jsonForScriptBlock(schema: unknown): string {
  return JSON.stringify(schema, null, 2).replaceAll('<', String.raw`\u003c`);
}

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
  private brandAssets = inject(BrandAssetsService);
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

    this.jsonLd$ = this.seoService.jsonLdSchema$.pipe(
      delay(0),
      map(schema => {
        if (!schema) return null;
        const script = `<script type="application/ld+json">${jsonForScriptBlock(schema)}</script>`;
        return this.sanitizer.bypassSecurityTrustHtml(script);
      })
    );
  }
}
