import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BlogPostComponent } from './blog-post.component';
import { BlogService } from '@beaconfolio/shared';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { SeoService } from '../../../services/seo.service';
import { SiteConfigService } from '../../../services/site-config.service';
import { of, BehaviorSubject } from 'rxjs';
import { MockTranslatePipe } from '@beaconfolio/shared/testing';

describe('BlogPostComponent SEO branches', () => {
  let component: BlogPostComponent;
  let fixture: ComponentFixture<BlogPostComponent>;
  let blogServiceSpy: any;
  let seoService: SeoService;
  let paramMapSubject: BehaviorSubject<any>;

  beforeEach(async () => {
    blogServiceSpy = { getPost: vi.fn() };
    paramMapSubject = new BehaviorSubject({ get: (k: string) => (k === 'slug' ? 'test-post' : null) });

    await TestBed.configureTestingModule({
      imports: [BlogPostComponent, MockTranslatePipe],
      providers: [
        provideRouter([]),
        { provide: BlogService, useValue: blogServiceSpy },
        { provide: ActivatedRoute, useValue: { paramMap: paramMapSubject.asObservable() } },
        {
          provide: SiteConfigService,
          useValue: {
            config$: of({
              siteName: 'beaconfolio.com', siteUrl: 'https://beaconfolio.com',
              ownerName: 'Mock Owner', ownerHeadline: 'Principal Software Engineer',
              ownerDescription: 'Desc.', socialLinks: [],
              analyticsId: '',
            }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BlogPostComponent);
    component = fixture.componentInstance;
    seoService = TestBed.inject(SeoService);
  });

  it('uses content substring and empty keywords when summary/tags are missing (branch coverage of 112-136)', () => {
    const updateSeoSpy = vi.spyOn(seoService, 'updateSeo');
    const setJsonLdSpy = vi.spyOn(seoService, 'setJsonLd');
    const longContent = 'x'.repeat(200);
    blogServiceSpy.getPost.mockReturnValue(
      of({
        id: 1,
        title: 'No Summary Post',
        slug: 'no-summary',
        date: '2026-01-01',
        summary: '', // falsy -> use content.substring(0,160)
        content: longContent,
        language: 'en',
        tags: undefined, // optional chaining -> undefined
      }),
    );

    fixture.detectChanges();
    component.vm$?.subscribe();

    expect(updateSeoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'No Summary Post',
        description: longContent.substring(0, 160),
        keywords: undefined,
      }),
    );
    expect(setJsonLdSpy).toHaveBeenCalled();
  });

  it('does not update SEO when the post is undefined (if(post) false branch)', () => {
    const updateSeoSpy = vi.spyOn(seoService, 'updateSeo');
    blogServiceSpy.getPost.mockReturnValue(of(undefined));

    fixture.detectChanges();
    component.vm$?.subscribe();

    expect(updateSeoSpy).not.toHaveBeenCalled();
  });
});
