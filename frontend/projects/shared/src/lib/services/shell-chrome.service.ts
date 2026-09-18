import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { Brand } from '../theme/brand';
import { hasShellChrome } from '../theme/theme-presets';
import { SiteBrandService } from './site-brand.service';

/**
 * The terminal costume's TEXT, as a stream the templates render (#67).
 *
 * #339 made the palette swappable and stopped there, because the rest of the
 * costume is not in CSS: `user@portfolio:~$` is a literal in
 * `hero.component.html`, `admin@beaconfolio.com:~$ ./login.sh` is a literal in
 * the admin login template, and no `[data-theme]` block can reach either. Pick
 * the `classic` preset today and you get a serif, document-like page that
 * still greets you with a shell prompt — and, in the admin console, with a
 * hostname belonging to whoever forked the project from.
 *
 * So the strings come from here instead, and they come from the CONFIG:
 *
 * - the hostname is derived from `siteName`, never hardcoded — which is what
 *   removes the last literal domain from the two admin templates;
 * - every prompt is `''` under a preset that renders no chrome, so a template
 *   can drop the whole line with `@if (prompt$ | async; as p)`.
 *
 * Templates bind these with the `async` pipe, per the repo's RxJS rule. Bind a
 * FIELD, not a call: `prompt('~/blog')` returns a new observable each time, so
 * calling it from the template would re-subscribe on every change-detection
 * pass. Components assign it once (`readonly prompt$ = shell.prompt('~/blog')`).
 */
@Injectable({ providedIn: 'root' })
export class ShellChromeService {
    private brand = inject(SiteBrandService);

    /** True while the active preset renders shell chrome at all. */
    readonly chrome$: Observable<boolean> = this.brand.brand$.pipe(
        map((b) => hasShellChrome(b.theme)),
    );

    /** The shell hostname, e.g. `my-portfolio` for a site named "My Portfolio". */
    readonly host$: Observable<string> = this.brand.brand$.pipe(map((b) => shellHost(b.siteName)));

    /** The configured site name, for headings a non-chrome preset renders. */
    readonly siteName$: Observable<string> = this.brand.brand$.pipe(map((b) => b.siteName));

    /**
     * The header brand mark's TEXT — the owner's initials, prefixed with the
     * terminal `>_` only where that belongs. Rendered when no logo image is
     * configured; `BrandAssetsService` never touches it, because a text mark
     * is markup, not an asset.
     */
    readonly wordmark$: Observable<string> = this.brand.brand$.pipe(
        map((b) => (hasShellChrome(b.theme) ? `>_ ${initials(b)}` : initials(b))),
    );

    /** The configured logo image URL, or `''` to render the wordmark instead. */
    readonly logoUrl$: Observable<string> = this.brand.brand$.pipe(map((b) => b.logoUrl));

    /**
     * One shell prompt, or `''` under a preset that renders no chrome.
     *
     * @param path the working directory shown, e.g. `~` or `~/blog`
     * @param user the account shown; the admin console passes `admin`
     */
    prompt(path = '~', user = 'user'): Observable<string> {
        return this.brand.brand$.pipe(
            map((b) => (hasShellChrome(b.theme) ? `${user}@${shellHost(b.siteName)}:${path}$` : '')),
        );
    }

    /**
     * The `user@host` half of a prompt alone, or `''` without chrome.
     *
     * Two templates colour the account, the path and the `$` differently
     * (the blog search bar, the LLM console header). They keep doing so — this
     * is the piece that used to be the literal `user@portfolio`, and the AC
     * that the `terminal` preset look UNCHANGED is easier to hold when the
     * markup around it is untouched.
     */
    account(user = 'user'): Observable<string> {
        return this.brand.brand$.pipe(
            map((b) => (hasShellChrome(b.theme) ? `${user}@${shellHost(b.siteName)}` : '')),
        );
    }

    /**
     * A whole prompt line — `admin@host:~$ ./login.sh` — or, without chrome,
     * a plain caption (`plain`, defaulting to the site name).
     *
     * For the two admin panel titles, where the element must render SOMETHING
     * under every preset: an empty title bar above a login form reads as a
     * broken page, not as a restrained one.
     */
    commandLine(
        command: string,
        opts: { path?: string; user?: string; plain?: string } = {},
    ): Observable<string> {
        const { path = '~', user = 'user', plain } = opts;
        return this.brand.brand$.pipe(
            map((b) =>
                hasShellChrome(b.theme)
                    ? `${user}@${shellHost(b.siteName)}:${path}$ ${command}`
                    : (plain ?? b.siteName),
            ),
        );
    }
}

/**
 * A site name as a plausible hostname: lowercase, spaces to hyphens, and
 * nothing outside `[a-z0-9.-]` — so "My Portfolio" is `my-portfolio` and a
 * name that is already a domain survives intact. Falls back to `portfolio`
 * (the string every public template hardcoded before this) rather than
 * rendering `user@:~$` for a name made entirely of punctuation.
 */
function shellHost(siteName: string): string {
    const host = siteName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9.-]/g, '');
    return host || 'portfolio';
}

/**
 * Up to two initials from the owner's name, e.g. `JD` for "Jane Doe". A
 * single-word name gives one letter; a name with no letters at all gives the
 * first character of the site name, so the header is never blank.
 */
function initials(brand: Brand): string {
    const letters = brand.ownerName
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => word[0])
        .filter((ch) => /[a-z0-9]/i.test(ch))
        .slice(0, 2)
        .join('')
        .toUpperCase();
    return letters || brand.siteName.trim().slice(0, 2).toUpperCase() || '??';
}
