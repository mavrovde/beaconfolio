import { THEME_DEFAULT, normalizeTheme } from './theme-presets';

/**
 * The brand-asset half of the site config (#67), as both apps consume it.
 *
 * #65 made the owner's IDENTITY a runtime value so a prebuilt image could be
 * rebranded with env vars alone. Everything visual stayed baked in: the
 * favicon and the webfont in `index.html`, the social card in `SeoService`,
 * the header mark in a template. This is the same move for those.
 *
 * ## Empty is not "missing" — it is "use the bundled asset"
 *
 * Every string field defaults to `''`, and `''` means the shipped default:
 * the bundled `assets/favicon.png`, the bundled `assets/og-image.png`, the
 * wordmark derived from `ownerName`, and the stylesheet `index.html` already
 * links. An owner who sets nothing sees exactly today's site — these are
 * overrides, never requirements. Consumers must therefore test for emptiness,
 * not for `undefined`; the projection below guarantees the fields exist.
 */
export interface Brand {
    /** One of THEME_PRESETS. Guaranteed valid — see `normalizeBrand`. */
    theme: string;
    siteName: string;
    ownerName: string;
    /** Tab icon. Absolute URL or site-relative path; `''` = the bundled one. */
    faviconUrl: string;
    /** Header mark image; `''` = the text wordmark from `ownerName`. */
    logoUrl: string;
    /** Social-share card; `''` = the bundled `/assets/og-image.png`. */
    ogImageUrl: string;
    /** Webfont STYLESHEET url; `''` = whatever `index.html` already links. */
    fontCssUrl: string;
    /** CSS font-family list overriding the preset's; `''` = the preset's. */
    fontFamily: string;
}

/**
 * What the apps render before the config arrives, and what they keep if it
 * never does. Identical in spirit to the public app's `DEFAULT_SITE_CONFIG`:
 * identity degrades, the page never breaks.
 */
export const DEFAULT_BRAND: Brand = {
    theme: THEME_DEFAULT,
    siteName: 'Portfolio',
    ownerName: 'Portfolio Owner',
    faviconUrl: '',
    logoUrl: '',
    ogImageUrl: '',
    fontCssUrl: '',
    fontFamily: '',
};

/** The backend wire shape (snake_case, `backend/app/api/site_config.py`). */
export interface BrandDto {
    site_name?: string;
    owner_name?: string;
    theme?: string;
    /** ABSENT on a pre-#67 backend — every one of these five. During a deploy
     *  window the admin console can be new while the backend is not, so the
     *  projection treats absent exactly like empty: the bundled asset. */
    brand_favicon_url?: string;
    brand_logo_url?: string;
    brand_og_image_url?: string;
    brand_font_css_url?: string;
    brand_font_family?: string;
}

/**
 * Project the wire payload onto `Brand`, filling every gap.
 *
 * A single normalization point is the reason the consumers below have no
 * `??` chains in them: by the time a favicon url or a theme name reaches the
 * DOM it is already a string, and already a theme name some `[data-theme]`
 * block matches.
 */
export function normalizeBrand(dto: BrandDto | null | undefined): Brand {
    return {
        theme: normalizeTheme(dto?.theme),
        siteName: dto?.site_name?.trim() || DEFAULT_BRAND.siteName,
        ownerName: dto?.owner_name?.trim() || DEFAULT_BRAND.ownerName,
        faviconUrl: dto?.brand_favicon_url?.trim() ?? '',
        logoUrl: dto?.brand_logo_url?.trim() ?? '',
        ogImageUrl: dto?.brand_og_image_url?.trim() ?? '',
        fontCssUrl: dto?.brand_font_css_url?.trim() ?? '',
        fontFamily: dto?.brand_font_family?.trim() ?? '',
    };
}
