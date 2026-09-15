import { Component, Inject, OnInit, PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { CommonModule, isPlatformServer } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { HeaderComponent } from '../header/header.component';
import { SeoService } from '../../services/seo.service';

/**
 * The site's own 404 page, reached through the `**` wildcard route (#324).
 *
 * Before this component the public app declared no wildcard route at all, so an
 * unmatched URL never reached Angular: the SSR engine declined the request and
 * Express answered with its own `Cannot GET /…` body — no branding, no head, no
 * way back into the site (measured on the deployed stack: 404,
 * `x-powered-by: Express`, `content-length: 153`, no `<head>`). `/blog/<unknown>`
 * and `/for/<unknown>` were already correct because their routes *do* match;
 * this closes the asymmetry.
 *
 * Three things are deliberate:
 *
 * 1. **A real HTTP 404.** `RESPONSE_INIT` is the mutable `ResponseInit` the
 *    @angular/ssr engine builds the outgoing `Response` from; mutating `.status`
 *    during the server render is what turns a soft-404 (200 + "not found" text)
 *    into a real 404 — the #109 pattern already used by `blog-post` and
 *    `tailored`. In the browser (and in unit tests) the factory yields `null`.
 * 2. **`noindex, nofollow` and no canonical.** `setNotFound()` marks the body
 *    unindexable and drops any canonical a previous render left behind;
 *    `setNoIndex()` adds `nofollow` on top, because unlike a missing blog post
 *    this page is reachable from *any* mistyped URL and there is nothing here
 *    worth a crawl budget.
 * 3. **The requested path is rendered from an Observable via the `async` pipe.**
 *    The app is zoneless (`provideZonelessChangeDetection()`, #105), so a plain
 *    property assigned from a `subscribe` would never repaint on a client-side
 *    navigation between two unmatched URLs.
 */
@Component({
    selector: 'app-not-found',
    standalone: true,
    imports: [CommonModule, RouterModule, HeaderComponent],
    template: `
    <div class="bg-black min-h-screen text-primary selection:bg-primary selection:text-black font-mono">
      <app-header></app-header>

      <main
        class="max-w-4xl mx-auto px-6 py-16 text-center space-y-6"
        data-testid="page-not-found"
      >
        <div class="text-terminal-highlight text-lg" data-testid="not-found-command">
          $ cat ~{{ path$ | async }}: No such file or directory
        </div>

        <h1 class="text-2xl md:text-3xl font-bold text-primary">404 — page not found</h1>

        <p class="text-secondary">
          That URL does not exist on this site. It may have been moved or renamed —
          or the link that brought you here was already stale.
        </p>

        <nav class="flex flex-wrap justify-center gap-4" aria-label="Where to go next">
          <a
            routerLink="/"
            class="text-terminal-highlight hover:text-white hover:underline decoration-dashed transition-colors"
            data-testid="not-found-home"
          >[ cd ~ ] portfolio</a>
          <a
            routerLink="/blog"
            class="text-terminal-highlight hover:text-white hover:underline decoration-dashed transition-colors"
            data-testid="not-found-blog"
          >[ ls ~/blog ] blog</a>
          <a
            routerLink="/cv"
            class="text-terminal-highlight hover:text-white hover:underline decoration-dashed transition-colors"
            data-testid="not-found-cv"
          >[ cat ~/cv ] request the CV</a>
        </nav>
      </main>
    </div>
  `,
})
export class NotFoundComponent implements OnInit {
    /** The path that matched nothing, echoed back in the terminal line. */
    readonly path$: Observable<string>;

    constructor(
        route: ActivatedRoute,
        private seoService: SeoService,
        @Inject(PLATFORM_ID) private platformId: object,
        @Inject(RESPONSE_INIT) private responseInit: ResponseInit | null,
    ) {
        this.path$ = route.url.pipe(
            map((segments) => `/${segments.map((segment) => segment.path).join('/')}`),
        );
    }

    ngOnInit(): void {
        // "Page", not the 'Post' default: the subject is what the <title> says.
        this.seoService.setNotFound('Page');
        this.seoService.setNoIndex();

        if (isPlatformServer(this.platformId) && this.responseInit) {
            this.responseInit.status = 404;
        }
    }
}
