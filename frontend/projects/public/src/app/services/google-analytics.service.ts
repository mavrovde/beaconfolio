import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter, take } from 'rxjs/operators';
import { SiteConfigService } from './site-config.service';

// Declare gtag as a global variable
declare const gtag: (...args: unknown[]) => void;

@Injectable({
    providedIn: 'root'
})
export class GoogleAnalyticsService {
    private platformId = inject(PLATFORM_ID);
    private router = inject(Router);
    private siteConfig = inject(SiteConfigService);

    // The measurement id comes from the runtime site config (#65) — empty
    // disables analytics entirely; no id is ever baked into the bundle.
    private googleAnalyticsId = '';

    private isInitialized = false;

    public initialize() {
        if (!isPlatformBrowser(this.platformId) || this.isInitialized) {
            return;
        }
        // config$ is a one-shot shareReplay stream; take(1) both bounds the
        // subscription and re-checks the guards once the id is known.
        this.siteConfig.config$.pipe(take(1)).subscribe((cfg) => {
            // The id is interpolated into an inline <script> and a URL — a
            // config value must never be able to smuggle markup/JS. GA
            // measurement ids are [A-Za-z0-9-]; anything else is dropped.
            // eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: assigns a private service field and injects <script> tags — nothing template-bound.
            this.googleAnalyticsId = /^[A-Za-z0-9-]+$/.test(cfg.analyticsId)
                ? cfg.analyticsId
                : '';
            if (this.googleAnalyticsId) {
                this.loadScript();
                this.initGtag();
                this.trackPageViews();
                // eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: private guard flag, nothing template-bound.
                this.isInitialized = true;
            }
        });
    }

    private loadScript() {
        const scriptId = 'google-analytics-script';
        if (document.getElementById(scriptId)) {
            return;
        }
        const script = document.createElement('script');
        script.id = scriptId;
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${this.googleAnalyticsId}`;
        document.head.appendChild(script);
    }

    private initGtag() {
        const scriptId = 'google-analytics-init';
        if (document.getElementById(scriptId)) {
            return;
        }
        const script = document.createElement('script');
        script.id = scriptId;
        script.innerHTML = `
      window.dataLayer = window.dataLayer || [];
      if (!window.gtag) {
        function gtag(){dataLayer.push(arguments);}
        window.gtag = gtag;
        gtag('js', new Date());
        gtag('config', '${this.googleAnalyticsId}');
      }
    `;
        document.head.appendChild(script);
    }

    private trackPageViews() {
        this.router.events
            .pipe(filter(event => event instanceof NavigationEnd))
            .subscribe((event) => {
                if (typeof gtag !== 'undefined') {
                    gtag('config', this.googleAnalyticsId, {
                        'page_path': (event as NavigationEnd).urlAfterRedirects
                    });
                }
            });
    }
}
