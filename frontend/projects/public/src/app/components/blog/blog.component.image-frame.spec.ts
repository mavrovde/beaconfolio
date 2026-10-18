import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BlogComponent } from './blog.component';
import { BlogService, LanguageService } from '@beaconfolio/shared';
import { of } from 'rxjs';
import { MockTranslatePipe, provideTestBrand } from '@beaconfolio/shared/testing';
import { SiteConfigService } from '../../services/site-config.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Blog list thumbnails use the same top-anchored crop frame as the post page's cover: a fixed
 * 16:9 box (the old `max-h-32` with an auto width rendered a portrait upload as a tall sliver).
 * The search-result 64x64 square keeps its size and gains the same top anchor.
 *
 * jsdom applies no stylesheet, so this pins the MARKUP contract only; the rendered geometry is
 * pinned in a real browser by `frontend/e2e/public/post-image-crop.spec.ts`.
 */
describe('BlogComponent — post image frames', () => {
  let fixture: ComponentFixture<BlogComponent>;
  let fetchSpy: any;

  const post = {
    id: '1', title: 'Portrait Post', slug: 'portrait-post', summary: 'S', content: '<p>C</p>',
    language: 'en', tags: [], created_at: '2026-01-24', image_url: '/api/app/posts/1/image',
  };
  const page = { items: [post], total: 1, page: 1, page_size: 10, total_pages: 1 };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockReturnValue(
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(page) } as Response),
    );
    await TestBed.configureTestingModule({
      imports: [BlogComponent, MockTranslatePipe],
      providers: [
        ...provideTestBrand(),
        {
          provide: BlogService,
          useValue: {
            getPosts: vi.fn().mockReturnValue(of(page)),
            searchPosts: vi.fn().mockReturnValue(of([])),
            getStaticPosts: vi.fn().mockReturnValue(of(page)),
          },
        },
        {
          provide: LanguageService,
          useValue: {
            currentLang$: of('en'), translations$: of({}),
            translate: (key: string) => of(key), getCurrentLanguage: () => 'en',
          },
        },
        {
          provide: SiteConfigService,
          useValue: {
            config$: of({
              siteName: 'beaconfolio.com', siteUrl: 'https://beaconfolio.com',
              ownerName: 'Mock Owner', ownerHeadline: 'Engineer',
              ownerDescription: 'Desc.', socialLinks: [], analyticsId: '',
            }),
          },
        },
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BlogComponent);
  });

  afterEach(() => fetchSpy.mockRestore());

  it('renders the list thumbnail as a fixed 16:9 box cropped from the top', async () => {
    fixture.detectChanges();
    await flush();
    await flush();
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector(
      '[data-testid="post-item"] img',
    ) as HTMLImageElement;
    expect(img).toBeTruthy();
    for (const cls of ['h-32', 'aspect-video', 'object-cover', 'object-top']) {
      expect(img.classList).toContain(cls);
    }
    // A max-height with a free width is what let a portrait image keep its tall shape.
    expect(img.className).not.toContain('max-h-');
    const w = Number(img.getAttribute('width'));
    const h = Number(img.getAttribute('height'));
    expect(h).toBe(128);
    expect(w / h).toBeCloseTo(16 / 9, 2);
  });

  it('anchors the search-result square thumbnail at the top too', async () => {
    fixture.componentInstance.searchResults$ = of([
      { id: 1, title: 'Portrait Post', slug: 'portrait-post', summary: 'S', relevance: 0.9,
        image_url: '/api/app/posts/1/image' },
    ] as any);
    fixture.componentInstance.currentQuery = 'portrait';
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img.w-16') as HTMLImageElement;
    expect(img).toBeTruthy();
    for (const cls of ['h-16', 'object-cover', 'object-top']) {
      expect(img.classList).toContain(cls);
    }
  });
});
