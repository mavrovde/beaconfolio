import { TestBed } from '@angular/core/testing';
import { BlogPostComponent } from './blog-post.component';
import { BlogService } from '@beaconfolio/shared';
import { SeoService } from '../../../services/seo.service';
import { SiteConfigService } from '../../../services/site-config.service';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, BehaviorSubject } from 'rxjs';
import { MockTranslatePipe, provideTestBrand } from '@beaconfolio/shared/testing';
import { PLATFORM_ID } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The post cover image renders inside a fixed 16:9 frame, cropped from the top.
 *
 * The old markup (`w-full h-auto object-cover max-h-[500px]`) upscaled a portrait upload
 * (the reported post's image is 480x596) to the full column width and then let the 500px cap
 * cut its MIDDLE out — the subject's head was cropped away.
 *
 * What this file can and cannot claim: jsdom applies no stylesheet, so it pins the MARKUP
 * contract only (the classes and the width/height attributes that reserve the box). The rendered
 * geometry — a 16:9 box whose crop starts at the top — is pinned in a real browser by
 * `frontend/e2e/public/post-image-crop.spec.ts`.
 */
describe('BlogPostComponent — cover image frame', () => {
  const post = {
    id: 1,
    title: 'Portrait Post',
    slug: 'portrait-post',
    summary: 'Summary',
    content: '<p>Content</p>',
    language: 'en',
    tags: [],
    created_at: '2026-01-24T10:00:00Z',
    image_url: '/api/app/posts/1/image',
  };

  function render(p: Record<string, unknown>) {
    TestBed.configureTestingModule({
      imports: [BlogPostComponent, MockTranslatePipe],
      providers: [
        ...provideTestBrand(),
        provideRouter([]),
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
        { provide: BlogService, useValue: { getPost: vi.fn().mockReturnValue(of(p)) } },
        { provide: SeoService, useValue: { updateSeo: vi.fn(), setJsonLd: vi.fn(), setNotFound: vi.fn() } },
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject({ get: () => 'portrait-post' }).asObservable(),
            snapshot: { paramMap: { get: () => 'portrait-post' } },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(BlogPostComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('frames the cover in a 16:9 box cropped from the top, with no height cap', () => {
    const img = render(post).querySelector('article img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/api/app/posts/1/image');
    for (const cls of ['w-full', 'aspect-video', 'object-cover', 'object-top']) {
      expect(img.classList).toContain(cls);
    }
    // The cap is what cut the middle out of a tall image; the frame replaces it.
    expect(img.className).not.toContain('max-h-');
  });

  it('reserves the 16:9 box before the image loads (width/height attributes, no layout shift)', () => {
    const img = render(post).querySelector('article img') as HTMLImageElement;
    const w = Number(img.getAttribute('width'));
    const h = Number(img.getAttribute('height'));
    expect(w).toBeGreaterThan(0);
    expect(w / h).toBeCloseTo(16 / 9, 2);
  });

  it('renders no cover image at all when the post has none', () => {
    expect(render({ ...post, image_url: undefined }).querySelector('article img')).toBeNull();
  });
});
