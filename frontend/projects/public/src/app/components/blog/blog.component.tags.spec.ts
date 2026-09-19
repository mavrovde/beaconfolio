import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BlogComponent } from './blog.component';
import { BlogService, LanguageService } from '@beaconfolio/shared';
import { of } from 'rxjs';
import { MockTranslatePipe, provideTestBrand } from '@beaconfolio/shared/testing';
import { SiteConfigService } from '../../services/site-config.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * #460 — the tag chips used to be pointer-only `<span (click)=…>` elements nested INSIDE the
 * row's `role="button"`, with two eslint suppressions standing in for a keyboard path. They are
 * now `<button type="button">` SIBLINGS of that row control.
 *
 * Two behaviours have to survive together, so both are pinned here: activating a chip filters
 * and must NOT navigate, and the row still navigates when activated outside a chip.
 *
 * What this file deliberately does NOT claim: jsdom does not implement a button's native
 * keyboard activation behaviour — dispatching `keydown Enter` on a `<button>` fires no `click`
 * there, so a jsdom "Enter filters" case would pass against a `<div>` just as happily and pin
 * nothing (the lessons-learned §51 shape). What jsdom CAN observe is the element TYPE, which is
 * the whole mechanism: a real `<button type="button">` is focusable and Enter/Space-activated by
 * the browser itself. The keystrokes are pinned in a real browser by
 * `frontend/e2e/public/blog-tag-filter.spec.ts`.
 */
describe('BlogComponent tag chips (#460)', () => {
  let component: BlogComponent;
  let fixture: ComponentFixture<BlogComponent>;
  let blogServiceSpy: any;
  let fetchSpy: any;

  const taggedPost = {
    id: '1',
    title: 'Tagged Post',
    slug: 'tagged-post',
    summary: 'Summary',
    content: '<p>Content</p>',
    language: 'en',
    tags: ['angular', 'ssr'],
    created_at: '2026-01-24',
  };

  // The `@if` false branches: an empty list, and — the defensive half — a payload where the
  // browser fetch path delivered no `tags` key at all (it hands the raw API JSON to the
  // template, without the `tags: p.tags || []` normalisation the service applies elsewhere).
  const untaggedPost = { ...taggedPost, id: '2', title: 'Untagged Post', slug: 'untagged-post', tags: [] };
  const tagsMissingPost = { ...taggedPost, id: '3', title: 'Tagless Post', slug: 'tagless-post', tags: undefined };

  const posts = [taggedPost, untaggedPost, tagsMissingPost];

  const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

  const mockFetchResponse = (data: any) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) } as Response);

  /** The rendered list, after the browser fetch that `ngOnInit` kicks off has settled. */
  const render = async () => {
    fixture.detectChanges();
    await flushPromises();
    await flushPromises();
    fixture.detectChanges();
  };

  const groups = () =>
    fixture.nativeElement.querySelectorAll('[data-testid="post-item"]') as NodeListOf<HTMLElement>;
  /** The row control: the only element carrying an explicit `role="button"`. */
  const rowControl = (group: HTMLElement) => group.querySelector('[role="button"]') as HTMLElement;
  const chips = (group: HTMLElement) =>
    Array.from(group.querySelectorAll('[data-testid="post-tag"]')) as HTMLElement[];

  beforeEach(async () => {
    const page = { items: posts, total: posts.length, page: 1, page_size: 10, total_pages: 1 };
    blogServiceSpy = {
      getPosts: vi.fn().mockReturnValue(of(page)),
      searchPosts: vi.fn().mockReturnValue(of([])),
      getStaticPosts: vi.fn().mockReturnValue(of(page)),
    };

    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockReturnValue(mockFetchResponse(page));

    await TestBed.configureTestingModule({
      imports: [BlogComponent, MockTranslatePipe],
      providers: [
        ...provideTestBrand(),
        { provide: BlogService, useValue: blogServiceSpy },
        {
          provide: LanguageService,
          useValue: {
            currentLang$: of('en'),
            translations$: of({}),
            translate: (key: string) => of(key),
            getCurrentLanguage: () => 'en',
          },
        },
        {
          provide: SiteConfigService,
          useValue: {
            config$: of({
              siteName: 'beaconfolio.com', siteUrl: 'https://beaconfolio.com',
              ownerName: 'Mock Owner', ownerHeadline: 'Principal Software Engineer',
              ownerDescription: 'Desc.', socialLinks: [], analyticsId: '',
            }),
          },
        },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BlogComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('renders each tag as a native <button type="button">, with no tabindex/role stand-ins', async () => {
    await render();

    const tagChips = chips(groups()[0]);
    expect(tagChips.map((c) => c.textContent!.trim())).toEqual(['#angular', '#ssr']);
    for (const chip of tagChips) {
      expect(chip.tagName).toBe('BUTTON');
      // `type="button"` matters inside a form: the default is `submit`.
      expect(chip.getAttribute('type')).toBe('button');
      // A native button needs neither of the crutches the old <span> would have required.
      expect(chip.hasAttribute('tabindex')).toBe(false);
      expect(chip.hasAttribute('role')).toBe(false);
    }
  });

  it('places the chips OUTSIDE the row control, so no interactive element is nested in another', async () => {
    await render();

    const group = groups()[0];
    const row = rowControl(group);
    expect(row).toBeTruthy();
    for (const chip of chips(group)) {
      expect(row.contains(chip)).toBe(false);
    }
    // ...and the row control itself contains no interactive descendant at all.
    expect(row.querySelector('button, a, [role="button"], [tabindex]')).toBeNull();
  });

  it('renders no chip row for a post with no tags, nor for one whose payload omits them', async () => {
    await render();

    expect(groups().length).toBe(3);
    expect(chips(groups()[1])).toEqual([]);
    expect(chips(groups()[2])).toEqual([]);
    // ...and the row itself still paints. MEASURED: dropping the `post.tags &&` guard makes
    // this file exit 1 with `TypeError: Cannot read properties of undefined (reading 'length')`
    // from the template — Angular reports it as an unhandled error from a later change-detection
    // pass rather than as a failure of this expect, so the kill is the RUN, not the assertion.
    fixture.detectChanges();
    expect(groups()[2].textContent).toContain('Tagless Post');
  });

  it('filters by the clicked tag and does not navigate or expand the post', async () => {
    await render();
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    chips(groups()[0])[1].click();
    await flushPromises();

    expect(component.activeTag).toBe('ssr');
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(component.expandedPostId).toBeNull();
  });

  it('still navigates when the row is activated outside a chip', async () => {
    await render();
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    // First activation expands the row, the second navigates (`toggleOrNavigate`).
    rowControl(groups()[0]).click();
    expect(component.expandedPostId).toBe('1');
    expect(navigateSpy).not.toHaveBeenCalled();

    rowControl(groups()[0]).click();
    expect(navigateSpy).toHaveBeenCalledWith(['/blog', 'tagged-post']);
    expect(component.activeTag).toBeNull();
  });
});
