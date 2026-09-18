import { Component, OnInit, Input, PLATFORM_ID, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { BlogService, BlogPost, BlogSearchResult } from '@beaconfolio/shared';
import { Observable, map, of, take } from 'rxjs';
import { TranslatePipe } from '@beaconfolio/shared';
import { Router, RouterModule } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { SiteConfigService, DEFAULT_SITE_CONFIG, SiteConfig } from '../../services/site-config.service';

import { HeaderComponent } from '../header/header.component';

@Component({
  selector: 'app-blog',
  standalone: true,
  imports: [CommonModule, TranslatePipe, RouterModule, HeaderComponent],
  templateUrl: './blog.component.html',
  styleUrls: ['./blog.component.css'],
})
export class BlogComponent implements OnInit {
  private blogService = inject(BlogService);
  private seoService = inject(SeoService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private platformId = inject(PLATFORM_ID);
  // `{ optional: true }` preserves the pre-#425 constructor signature, where this dependency
  // was `private siteConfig?: SiteConfigService`. The `inject` codemod drops optionality, and a
  // plain `inject()` THROWS where the old code simply saw `undefined` — the component reads it as
  // `this.siteConfig?.config$` precisely because the public app can render without it.
  private siteConfig = inject(SiteConfigService, { optional: true });

  @Input() standalone = true;
  // Pagination State
  posts: BlogPost[] = [];
  currentPage = 1;
  pageSize = 10;
  loadMoreSize = 5;
  hasMore = false;
  isLoading = false;
  private usingFallback = false;

  // Search State
  searchResults$: Observable<BlogSearchResult[]> | null = null;
  expandedPostId: string | null = null;
  isSearching = false;
  currentQuery = '';
  activeTag: string | null = null;

  // Identity for SEO/share URLs comes from the runtime site config (#65).
  private site: SiteConfig = DEFAULT_SITE_CONFIG;

  /** Terminal-style username for the template (#66) — async pipe (rule 5),
   *  so the row repaints when the runtime identity arrives. */
  readonly unixUser$: Observable<string>;

  constructor() {
    // eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: assigns a private field consumed only inside later callbacks — nothing template-bound.
    this.siteConfig?.config$?.subscribe((cfg) => (this.site = cfg));
    this.unixUser$ = (this.siteConfig?.config$ ?? of(DEFAULT_SITE_CONFIG)).pipe(
      map((c) => (c.ownerName.split(' ')[0] || 'owner').toLowerCase())
    );
  }

  ngOnInit() {
    if (this.standalone) {
      // SEO strings must COMPOSE off the config stream (#255 review blocker 1):
      // reading `this.site` synchronously here races the constructor's async
      // fetch and bakes the placeholder into the SSR meta — SeoService's
      // re-apply cannot repair strings already interpolated. take(1) bounds the
      // one-shot shareReplay stream; SSR waits on the pending HTTP request, so
      // the server-rendered head carries the real identity.
      const seo$ = this.siteConfig?.config$ ?? of(DEFAULT_SITE_CONFIG);
      seo$.pipe(take(1)).subscribe((site) => {
        this.seoService.updateSeo({
          title: 'Blog',
          description: `Read the latest insights and professional reflections from ${site.ownerName}, covering Cloud Architecture, AI, and Software Engineering.`,
          url: '/blog',
          keywords: `Blog, Technology, Software Engineering, AI, Cloud, ${site.ownerName}`
        });
      });
    }
    this.loadInitialPosts();
  }

  loadInitialPosts() {
    this.posts = [];
    this.currentPage = 1;
    this.hasMore = false;
    this.loadPosts();
  }

  loadPosts() {
    if (this.isLoading) return;
    this.isLoading = true;

    const effectivePageSize = this.currentPage === 1 ? this.pageSize : this.loadMoreSize;
    let apiPage: number;
    let apiPageSize: number;
    if (this.currentPage === 1) {
      apiPage = 1;
      apiPageSize = this.pageSize;
    } else {
      apiPageSize = this.loadMoreSize;
      apiPage = Math.floor(this.posts.length / apiPageSize) + 1;
    }

    if (this.usingFallback) {
      this.loadFallbackPosts(effectivePageSize);
      return;
    }

    // Use native fetch on browser to bypass Angular HttpClient SSR hydration issues
    if (isPlatformBrowser(this.platformId)) {
      this.loadMoreWithFetch(apiPage, apiPageSize);
      return;
    }

    this.blogService.getPosts(true, null, this.activeTag, apiPage, apiPageSize).subscribe({
      next: (response) => {
        const existingIds = new Set(this.posts.map(p => p.id));
        const newPosts = response.items.filter(p => !existingIds.has(p.id));
        this.posts = [...this.posts, ...newPosts];
        this.hasMore = this.posts.length < response.total;
        this.isLoading = false;
        // Only the server reaches this subscribe (the isPlatformBrowser branch
        // above returns first) and SSR serializes after pending tasks settle —
        // but markForCheck is free there, matches loadFallbackPosts, and keeps
        // this correct if the platform guard is ever refactored.
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to load posts from API, using fallback', err);
        // eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: private field, nothing template-bound; loadFallbackPosts repaints via its own handlers.
        this.usingFallback = true;
        this.loadFallbackPosts(effectivePageSize);
      }
    });
  }

  private async loadMoreWithFetch(apiPage: number, apiPageSize: number) {
    try {
      const params = new URLSearchParams({
        page: apiPage.toString(),
        page_size: apiPageSize.toString(),
        sort_by: 'created_at',
        sort_order: 'desc',
        published_only: 'true',
      });
      if (this.activeTag) {
        params.set('tag', this.activeTag);
      }
      /* v8 ignore start -- origin is never literally 'null' and window is non-configurable in jsdom; SSR/opaque-origin sandbox fallback only */
      const hasUsableOrigin = typeof window !== 'undefined' && window.location.origin !== 'null';
      const baseUrl = hasUsableOrigin ? window.location.origin : 'http://localhost';
      /* v8 ignore stop */
      const resp = await fetch(`${baseUrl}/api/app/posts?${params.toString()}`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const response = await resp.json();
      // Zoneless app (#105): the `async`/`fetch` callback mutates plain props read
      // by the template — trigger change detection explicitly via `markForCheck()`
      // (the old `NgZone.run` wrapper was dead code: NgZone is a no-op here).
      const existingIds = new Set(this.posts.map((p: BlogPost) => p.id));
      const newPosts = (response.items || []).filter((p: BlogPost) => !existingIds.has(p.id));
      this.posts = [...this.posts, ...newPosts];
      this.hasMore = this.posts.length < response.total;
      this.isLoading = false;
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to load more posts via fetch, using fallback', err);
      this.usingFallback = true;
      this.loadFallbackPosts(this.loadMoreSize);
    }
  }

  private loadFallbackPosts(effectivePageSize: number) {
    this.blogService.getStaticPosts(this.currentPage, effectivePageSize).subscribe({
      next: (response) => {
        this.posts = [...this.posts, ...response.items];
        this.hasMore = this.posts.length < response.total;
        this.isLoading = false;
        // Zoneless (#105): async subscribe mutating template props needs an explicit
        // CD trigger — the old NgZone.run wrapper that used to drive this is gone.
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  loadMore() {
    if (!this.hasMore || this.isLoading) return;
    this.currentPage++;
    this.loadPosts();
  }

  filterByTag(tag: string) {
    this.activeTag = tag;
    this.currentQuery = ''; // Clear text search
    this.searchResults$ = null;
    this.loadInitialPosts();
  }

  clearTagFilter() {
    this.activeTag = null;
    this.loadInitialPosts();
  }

  onSearch(event: Event) {
    const query = (event.target as HTMLInputElement).value;
    // Use standard timeout for debouncing (simple implementation)
    setTimeout(() => {
      this.currentQuery = query;
      if (!query || query.trim().length < 3) {
        this.searchResults$ = null;
        this.isSearching = false;
        this.cdr.markForCheck(); // zoneless: repaint after async debounce mutation
        return;
      }

      this.isSearching = true;
      this.searchResults$ = this.blogService.searchPosts(query).pipe(
        map((results) => {
          this.isSearching = false;
          return results;
        }),
      );
      this.cdr.markForCheck(); // zoneless: let the async pipe pick up the new results stream
    });
  }

  clearSearch(input: HTMLInputElement) {
    setTimeout(() => {
      input.value = '';
      this.currentQuery = '';
      this.searchResults$ = null;
      this.isSearching = false;
      this.cdr.markForCheck(); // zoneless: repaint after async clear
    });
  }

  togglePost(id: number | string) {
    const idStr = String(id);
    if (this.expandedPostId === idStr) {
      this.expandedPostId = null;
    } else {
      this.expandedPostId = idStr;
    }
  }

  toggleOrNavigate(post: BlogPost) {
    if (this.isExpanded(post.id)) {
      this.router.navigate(['/blog', post.slug]);
    } else {
      this.togglePost(post.id);
    }
  }

  isExpanded(id: number | string): boolean {
    return this.expandedPostId === String(id);
  }

  async sharePost(post: BlogPost) {
    const url = `${isPlatformBrowser(this.platformId) ? window.location.origin : this.site.siteUrl}/blog/${post.slug}`;
    if (isPlatformBrowser(this.platformId) && navigator.share) {
      try {
        await navigator.share({ title: post.title, url });
      } catch { /* the user dismissing the share sheet is not an error */ }
    } else if (isPlatformBrowser(this.platformId)) {
      await navigator.clipboard.writeText(url);
    }
  }
}
