/**
 * The theme vocabulary — ONE copy, shared by both apps (#67).
 *
 * #339 shipped this list three times: `backend/app/api/site_settings.py`,
 * `projects/public/.../site-config.service.ts` and
 * `projects/admin/.../site-settings.service.ts`. A backend test pinned the
 * three against each other, which is the right instrument for a list that
 * genuinely cannot be shared — Python cannot import TypeScript — but two of
 * the three copies were TypeScript in one workspace and had no such excuse.
 * The admin copy was the live risk: a preset present there and nowhere else
 * renders a picker button whose write the API rejects with a 422.
 *
 * Now there are two copies in the repository, not three, and the seam between
 * them is the only one a test has to watch.
 *
 * `terminal` is first and is the default: it is the pre-#339 look, and a
 * deployment that never picks a theme has to keep rendering as it does now.
 */
export const THEME_PRESETS = ['terminal', 'dark', 'light', 'modern', 'classic'] as const;

/** The preset a deployment gets when it has never chosen one. */
export const THEME_DEFAULT: string = THEME_PRESETS[0];

/**
 * Narrow any wire value to a known preset.
 *
 * An unknown name is NOT passed through: it would be stamped into
 * `data-theme`, match no `[data-theme="..."]` block in the shared stylesheet,
 * and leave the page on whatever `:root` happens to hold — a half-themed
 * render rather than a clean fallback. The backend normalizes too; this is the
 * second half of the same contract, for the deploy window where the client is
 * newer than the server (or the server older than the vocabulary).
 */
export function normalizeTheme(value: string | undefined): string {
    return value && (THEME_PRESETS as readonly string[]).includes(value)
        ? value
        : THEME_DEFAULT;
}

/**
 * The presets that render SHELL CHROME — `user@host:~$` prompts, `./login.sh`
 * command names, the `>_` wordmark prefix (#67).
 *
 * The chrome is not decoration on top of the palette, it is part of the same
 * costume: `user@portfolio:~$ ./welcome.sh` under a serif `classic` theme
 * reads as a rendering bug, not as a style. #339 could swap the palette
 * without touching it because the strings are in TEMPLATES, where no
 * stylesheet can reach them — so the vocabulary has to say which presets want
 * them and the templates have to ask.
 *
 * Only `terminal` does. The other four declare system or serif families and a
 * conventional palette; see `projects/shared/src/styles/theme.css`.
 */
export const THEME_SHELL_CHROME: readonly string[] = ['terminal'];

/** Does this preset render shell chrome? Unknown names normalize first. */
export function hasShellChrome(theme: string | undefined): boolean {
    return THEME_SHELL_CHROME.includes(normalizeTheme(theme));
}
