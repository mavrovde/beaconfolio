import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { Brand, THEME_DEFAULT, normalizeTheme } from '@beaconfolio/shared';

/**
 * Site identity (#65) — everything the public app shows about its owner.
 * Fetched at runtime from the backend so a prebuilt image is rebranded by
 * env vars alone; components never hardcode identity.
 */
export const AVAILABILITY_STATES = ['open', 'listening', 'not_looking'] as const;

/**
 * The theme vocabulary is **not declared here** (#67). It lives once, in
 * `@beaconfolio/shared`, because both apps need it and only the Python copy
 * has a real reason to be separate. Re-exported so existing imports from this
 * service keep working and so there is one obvious place to look from the
 * public app's side.
 */
export { THEME_PRESETS, THEME_DEFAULT, normalizeTheme } from '@beaconfolio/shared';

export interface SiteConfig {
    siteName: string;
    siteUrl: string;
    ownerName: string;
    ownerHeadline: string;
    ownerDescription: string;
    socialLinks: string[];
    analyticsId: string;
    /** GTM container id (#447). When non-empty the app installs the container
     *  and NOT gtag — two installs of one measurement double-count. */
    gtmContainerId: string;
    /** Owner's job-search state (#271): 'open' | 'listening' | 'not_looking'.
     *  GUARANTEED here — the projection normalizes an absent wire value. */
    availability: string;
    /** AI-crawler policy (#252): 'allow' | 'deny'. Consumed by the SSR
     *  robots.txt; exposed here so the browser app reads ONE config shape. */
    aiCrawlerPolicy: string;
    /** The chosen preset theme (#339), one of THEME_PRESETS. GUARANTEED to be
     *  a known preset here — the projection normalizes an absent or unknown
     *  wire value, because an unknown name stamps a `data-theme` that no
     *  stylesheet block matches and the page renders untokenized. */
    theme: string;
    /** Brand assets (#67). Each is GUARANTEED present and may be `''`, which
     *  means "use the bundled asset" — the shipped favicon/OG card, a wordmark
     *  from `ownerName`, the stylesheet `index.html` already links. See
     *  `Brand` in `@beaconfolio/shared` for the full contract. */
    faviconUrl: string;
    logoUrl: string;
    ogImageUrl: string;
    fontCssUrl: string;
    fontFamily: string;
}

/** Backend wire shape (snake_case, see backend/app/api/site_config.py). */
interface SiteConfigDto {
    site_name: string;
    site_url: string;
    owner_name: string;
    owner_headline: string;
    owner_description: string;
    social_links: string[];
    analytics_id: string;
    /** ABSENT on a pre-#447 backend — normalized to '' in the projection. */
    gtm_container_id?: string;
    /** ABSENT on an older backend (deploy-window skew) — normalized to the
     *  default in the projection, per this service's degrade-never-break
     *  contract. */
    availability?: string;
    /** ABSENT on a pre-#252 backend — normalized to 'allow' in the projection. */
    ai_crawler_policy?: string;
    /** ABSENT on a pre-#339 backend — normalized to 'terminal' in the
     *  projection, which is also what that backend's site looked like. */
    theme?: string;
    /** ABSENT on a pre-#67 backend — all five normalize to '' in the
     *  projection, which is the same value as "not configured", so a deploy
     *  window where the frontend leads the backend renders the bundled
     *  assets rather than nothing. */
    brand_favicon_url?: string;
    brand_logo_url?: string;
    brand_og_image_url?: string;
    brand_font_css_url?: string;
    brand_font_family?: string;
}

/**
 * Neutral fallback so the site still renders (unbranded, analytics off) when
 * the backend is unreachable — identity degrades, the page never breaks.
 */
export const DEFAULT_SITE_CONFIG: SiteConfig = {
    siteName: 'Portfolio',
    siteUrl: '',
    ownerName: 'Portfolio Owner',
    ownerHeadline: 'Software Engineer',
    ownerDescription: 'Professional software engineering portfolio.',
    socialLinks: [],
    analyticsId: '',
    gtmContainerId: '',
    availability: 'listening',
    aiCrawlerPolicy: 'allow',
    theme: THEME_DEFAULT,
    faviconUrl: '',
    logoUrl: '',
    ogImageUrl: '',
    fontCssUrl: '',
    fontFamily: '',
};

/**
 * This app's config as the shared library's brand contract (#67).
 *
 * The public app already fetches `/config/site`; handing the projection to
 * `@beaconfolio/shared` through `SITE_BRAND_SOURCE` (wired in `app.config.ts`)
 * is what stops `ThemeService`, `BrandAssetsService` and `ShellChromeService`
 * from each opening a second request for fields this stream already carries.
 */
export function toBrand(config: SiteConfig): Brand {
    return {
        theme: config.theme,
        siteName: config.siteName,
        ownerName: config.ownerName,
        faviconUrl: config.faviconUrl,
        logoUrl: config.logoUrl,
        ogImageUrl: config.ogImageUrl,
        fontCssUrl: config.fontCssUrl,
        fontFamily: config.fontFamily,
    };
}

@Injectable({
    providedIn: 'root'
})
export class SiteConfigService {
    private http = inject(HttpClient);

    /** One fetch per app lifecycle; late subscribers replay the value. */
    public readonly config$: Observable<SiteConfig>;

    constructor() {
        const url = `${environment.apiUrl}${environment.apiPrefix}/config/site`;
        this.config$ = this.http.get<SiteConfigDto>(url).pipe(
            map((dto) => ({
                siteName: dto.site_name,
                siteUrl: dto.site_url,
                ownerName: dto.owner_name,
                ownerHeadline: dto.owner_headline,
                ownerDescription: dto.owner_description,
                socialLinks: dto.social_links,
                analyticsId: dto.analytics_id,
                // Absent on a pre-#447 backend (deploy-window skew); '' is this
                // field's documented off switch, so the fallback and the
                // "disabled" value are deliberately the same thing.
                gtmContainerId: dto.gtm_container_id ?? '',
                // An older backend omits this (deploy-window skew). Without the
                // fallback, undefined reached toUpperCase() downstream and the
                // WHOLE availability stream errored — the indicator silently
                // vanished while the rest of the hero rendered (measured against
                // the running v1.12 container).
                // Absent OR unknown both normalize (#295 review nit 8): a
                // hand-edited DB row with a state outside the vocabulary
                // would otherwise render a raw AVAILABILITY.<X> key with no
                // dot colour. The write path validates; the read path
                // degrades.
                availability:
                    dto.availability &&
                    (AVAILABILITY_STATES as readonly string[]).includes(dto.availability)
                        ? dto.availability
                        : DEFAULT_SITE_CONFIG.availability,
                // Only 'deny' turns the AI crawlers away; absent/unknown means
                // allow, matching the backend's own normalization (#252).
                aiCrawlerPolicy:
                    dto.ai_crawler_policy?.toLowerCase() === 'deny'
                        ? 'deny'
                        : DEFAULT_SITE_CONFIG.aiCrawlerPolicy,
                // Absent (older backend) OR unknown both normalize (#339) —
                // see `normalizeTheme` for why passing an unknown name through
                // is worse than ignoring it.
                theme: normalizeTheme(dto.theme),
                // Absent on a pre-#67 backend, and '' is this field's own
                // "use the bundled asset" value — so, exactly as with
                // `gtm_container_id`, the fallback and the documented
                // off-switch are deliberately the same thing.
                faviconUrl: dto.brand_favicon_url?.trim() ?? '',
                logoUrl: dto.brand_logo_url?.trim() ?? '',
                ogImageUrl: dto.brand_og_image_url?.trim() ?? '',
                fontCssUrl: dto.brand_font_css_url?.trim() ?? '',
                fontFamily: dto.brand_font_family?.trim() ?? '',
            })),
            catchError(() => of(DEFAULT_SITE_CONFIG)),
            shareReplay(1)
        );
    }
}
