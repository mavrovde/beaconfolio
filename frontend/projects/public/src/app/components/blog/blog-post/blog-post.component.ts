import { Component, OnInit, PLATFORM_ID, RESPONSE_INIT, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser, isPlatformServer } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { BlogService, BlogPost } from '@beaconfolio/shared';
import { Observable, switchMap, catchError, of, tap, map, startWith } from 'rxjs';
import { HeaderComponent } from '../../header/header.component';
import { SeoService } from '../../../services/seo.service';
import { SiteConfigService, DEFAULT_SITE_CONFIG, SiteConfig } from '../../../services/site-config.service';

/**
 * View state for the blog-post page. A genuine "not found" (unknown slug → 404,
 * or a transient fetch error) resolves to `notfound` and renders a graceful
 * not-found panel — it no longer bounces the visitor to the home page, which
 * (combined with the SSR transfer-cache fix in `SsrHttpBackend`) is what caused
 * the "flash to home" of issue #25.
 */
export interface BlogPostVm {
  status: 'loading' | 'found' | 'notfound';
  post?: BlogPost;
}

@Component({
  selector: 'app-blog-post',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent],
  template: `
    <div class="min-h-screen bg-black font-mono text-primary">
      <app-header></app-header>
      <div class="p-6 md:p-12">
        <div class="max-w-4xl mx-auto" *ngIf="vm$ | async as vm">
          <!-- Header / Navigation -->
          <div class="mb-8 flex items-center gap-4 text-sm md:text-base border-b border-dashed border-terminal-dim pb-4">
            <button
              (click)="goBack()"
              class="text-secondary hover:text-white transition-colors flex items-center gap-2 group"
            >
              <span class="text-terminal-highlight group-hover:-translate-x-1 transition-transform">&lt;</span>
              [ cd .. ]
            </button>
            <span class="text-terminal-dim">|</span>
            <span class="text-secondary">~/blog/{{ vm.post?.slug }}</span>
          </div>

          <ng-container [ngSwitch]="vm.status">
            <!-- Found -->
            <ng-container *ngSwitchCase="'found'">
              <!-- Post Metadata -->
              <div class="mb-8 space-y-2">
                <h1 class="text-2xl md:text-4xl font-bold text-primary mb-4">{{ vm.post!.title }}</h1>

                <div class="flex flex-wrap items-center gap-4 text-sm text-secondary">
                  <span class="flex items-center gap-2">
                    <span class="text-terminal-highlight">author:</span> {{ (unixUser$ | async) ?? 'owner' }}
                  </span>
                  <span class="flex items-center gap-2">
                    <span class="text-terminal-highlight">date:</span> {{ vm.post!.created_at | date }}
                  </span>
                  <span class="flex items-center gap-2">
                     <span class="text-terminal-highlight">lang:</span> {{ vm.post!.language }}
                  </span>
                </div>

                <!-- Tags -->
                <div class="flex flex-wrap gap-2 mt-4">
                  <span *ngFor="let tag of vm.post!.tags" class="text-xs border border-terminal-dim text-secondary px-2 py-1 rounded">
                    #{{ tag }}
                  </span>
                </div>
              </div>

              <!-- Content -->
              <article class="prose prose-invert prose-p:text-primary prose-a:text-terminal-highlight prose-headings:text-primary prose-pre:bg-terminal-dim/20 prose-pre:border prose-pre:border-terminal-dim max-w-none">
                <div *ngIf="vm.post!.image_url" class="mb-8">
                  <img [src]="vm.post!.image_url" [alt]="vm.post!.title" class="w-full h-auto rounded border border-terminal-dim shadow-lg object-cover max-h-[500px]">
                </div>
                <div [innerHTML]="vm.post!.content" class="whitespace-pre-wrap"></div>
              </article>

              <!-- Footer -->
              <div class="mt-12 pt-8 border-t border-dashed border-terminal-dim text-center text-secondary">
                <span class="animate-pulse">_</span>
                <span class="ml-2">End of file</span>
                <div class="mt-4 flex flex-wrap justify-center gap-4">
                   <button
                    (click)="goBack()"
                    class="text-terminal-highlight hover:text-white hover:underline decoration-dashed transition-colors"
                  >
                    [ cd .. ]
                  </button>
                  <button
                    (click)="sharePost()"
                    class="text-secondary hover:text-terminal-highlight hover:underline decoration-dashed transition-colors"
                  >
                    $ cp post.url /clipboard →
                  </button>
                </div>
              </div>
            </ng-container>

            <!-- Not found (unknown slug or transient fetch error) — graceful, no home bounce -->
            <div *ngSwitchCase="'notfound'" class="py-16 text-center space-y-6" data-testid="post-not-found">
              <div class="text-terminal-highlight text-lg">$ cat ~/blog/{{ vm.post?.slug }}: No such file or directory</div>
              <h1 class="text-2xl md:text-3xl font-bold text-primary">404 — post not found</h1>
              <p class="text-secondary">The post you are looking for does not exist or is no longer published.</p>
              <button
                (click)="goBack()"
                class="text-terminal-highlight hover:text-white hover:underline decoration-dashed transition-colors"
              >
                [ cd .. ] back to blog
              </button>
            </div>

            <!-- Loading -->
            <div *ngSwitchDefault class="text-secondary animate-pulse">
              $ loading resource...
            </div>
          </ng-container>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class BlogPostComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private blogService = inject(BlogService);
  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  private responseInit = inject<ResponseInit | null>(RESPONSE_INIT);

  vm$: Observable<BlogPostVm> | null = null;
  /** Terminal-style username for the template (#66) — async pipe (rule 5). */
  readonly unixUser$: Observable<string>;
  // Identity for JSON-LD/share URLs comes from the runtime site config (#65).
  private site: SiteConfig = DEFAULT_SITE_CONFIG;

  constructor() {
    const siteConfig = inject(SiteConfigService);

    // eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: assigns a private field consumed only inside later callbacks — nothing template-bound.
    siteConfig.config$.subscribe((cfg) => (this.site = cfg));
    this.unixUser$ = siteConfig.config$.pipe(
      map((c) => (c.ownerName.split(' ')[0] || 'owner').toLowerCase())
    );
  }

  ngOnInit() {
    this.vm$ = this.route.paramMap.pipe(
      switchMap(params => {
        const slug = params.get('slug');
        if (!slug) {
          // No slug in the route is a routing error (not a content 404) — go home.
          this.router.navigate(['/']);
          return of<BlogPostVm>({ status: 'notfound' });
        }
        return this.blogService.getPost(slug).pipe(
          map(post => (post
            ? { status: 'found' as const, post }
            : { status: 'notfound' as const })),
          tap(vm => {
            if (vm.status === 'found') {
              this.applySeo(vm.post);
            } else {
              // Empty-body (published-but-missing) not-found.
              this.handleNotFound();
            }
          }),
          // A missing/unpublished post (404 from the API → HttpClient throws) or a
          // transient error resolves to a graceful not-found panel instead of
          // redirecting home (#25). Runs the same not-found side-effects (noindex
          // SEO + SSR 404, #109) for the thrown-error path.
          catchError(() => {
            this.handleNotFound();
            return of<BlogPostVm>({ status: 'notfound' as const });
          }),
          startWith<BlogPostVm>({ status: 'loading' })
        );
      })
    );
  }

  /**
   * Not-found handling for an unknown/unpublished slug: emit a `noindex` robots
   * meta + not-found title (so a 404 body is never indexed), and — when this
   * resolves on the SERVER during SSR — set the outgoing HTTP status to 404 so
   * the response is a real 404 rather than a soft-404 served as 200 (#109).
   */
  private handleNotFound(): void {
    this.seoService.setNotFound();
    if (isPlatformServer(this.platformId) && this.responseInit) {
      this.responseInit.status = 404;
    }
  }

  private applySeo(post: BlogPost): void {
    this.seoService.updateSeo({
      title: post.title,
      description: post.summary || post.content.substring(0, 160),
      url: `/blog/${post.slug}`,
      type: 'article',
      keywords: post.tags?.join(', ')
    });

    this.seoService.setJsonLd({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": post.title,
      "datePublished": post.created_at,
      "author": {
        "@type": "Person",
        "name": this.site.ownerName,
        "url": this.site.siteUrl
      },
      "description": post.summary || post.content.substring(0, 160),
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": `${this.site.siteUrl}/blog/${post.slug}`
      },
      "keywords": post.tags?.join(', ')
    });
  }

  goBack() {
    this.router.navigate(['/'], { fragment: 'blog' });
  }

  async sharePost() {
    const slug = this.route.snapshot.paramMap.get('slug');
    const url = `${isPlatformBrowser(this.platformId) ? window.location.origin : this.site.siteUrl}/blog/${slug}`;
    if (isPlatformBrowser(this.platformId) && navigator.share) {
      try {
        await navigator.share({ title: document.title, url });
      } catch { /* the user dismissing the share sheet is not an error */ }
    } else if (isPlatformBrowser(this.platformId)) {
      await navigator.clipboard.writeText(url);
    }
  }
}
