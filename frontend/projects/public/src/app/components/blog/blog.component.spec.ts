import { ChangeDetectorRef, PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BlogComponent } from './blog.component';
import { BlogService } from '@beaconfolio/shared';
import { LanguageService } from '@beaconfolio/shared';
import { of, throwError } from 'rxjs';
import { createInInjectionContext, MockTranslatePipe } from '@beaconfolio/shared/testing';
import { SeoService } from '../../services/seo.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('BlogComponent', () => {
  let component: BlogComponent;
  let fixture: ComponentFixture<BlogComponent>;
  let blogServiceSpy: any;
  let languageServiceMock: any;
  let fetchSpy: any;

  const mockPosts = [
    {
      id: '1',
      title: 'Test Post',
      slug: 'test-post',
      date: '2026-01-24',
      summary: 'Summary',
      content: '<p>Content</p>',
      language: 'en',
    },
  ];

  const mockSearchResults = [
    {
      id: 1,
      title: 'Search Result',
      slug: 'search-result',
      summary: 'Search Summary',
      relevance: 0.95,
    },
  ];

  /** The SSR/non-browser cases: same stubs the fixture uses, but on the 'server' platform.
   *  Built through the injection context because the component takes no constructor args (#425). */
  const makeServerComponent = () =>
    createInInjectionContext(BlogComponent, [
      { provide: BlogService, useValue: blogServiceSpy },
      { provide: SeoService, useValue: {} },
      { provide: Router, useValue: {} },
      { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } },
      { provide: PLATFORM_ID, useValue: 'server' },
    ]);

  // Helper to flush all microtasks (Promises)
  const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

  // Helper to create a mock fetch Response
  const mockFetchResponse = (data: any) => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    } as Response);
  };

  const mockFetchError = () => {
    return Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    } as Response);
  };

  const initialFetchData = {
    items: mockPosts,
    total: mockPosts.length,
    page: 1,
    page_size: 10,
    total_pages: 1
  };

  beforeEach(async () => {
    blogServiceSpy = {
      getPosts: vi.fn().mockReturnValue(of({
        items: mockPosts,
        total: mockPosts.length,
        page: 1,
        page_size: 10,
        total_pages: 1
      })),
      searchPosts: vi.fn().mockReturnValue(of(mockSearchResults)),
      getStaticPosts: vi.fn().mockReturnValue(of({
        items: mockPosts,
        total: mockPosts.length,
        page: 1,
        page_size: 10,
        total_pages: 1
      })),
    };

    languageServiceMock = {
      currentLang$: of('en'),
      translations$: of({}),
      translate: (key: string) => of(key),
      getCurrentLanguage: () => 'en',
    };

    // Mock global fetch - initial load uses fetch on browser
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockReturnValue(mockFetchResponse(initialFetchData));

    await TestBed.configureTestingModule({
      imports: [BlogComponent, MockTranslatePipe],
      providers: [
        { provide: BlogService, useValue: blogServiceSpy },
        { provide: LanguageService, useValue: languageServiceMock },
        provideRouter([])
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BlogComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load initial posts via fetch', async () => {
    fixture.detectChanges();
    await flushPromises();
    await flushPromises();

    expect(component.posts.length).toBe(1);
    expect(component.posts[0].title).toBe('Test Post');
    expect(component.currentPage).toBe(1);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('should append posts on loadMore with loadMoreSize=5', async () => {
    fixture.detectChanges();
    await flushPromises();
    await flushPromises();

    // Mock fetch for load-more
    const nextPosts = [{ ...mockPosts[0], id: '2', title: 'Next Post' }];
    fetchSpy.mockReturnValueOnce(mockFetchResponse({
      items: nextPosts,
      total: 20,
      page: 1,
      page_size: 5,
      total_pages: 4
    }));

    // Trigger load more
    component.hasMore = true;
    component.loadMore();

    await flushPromises();
    await flushPromises();

    expect(component.currentPage).toBe(2);
    expect(component.posts.length).toBe(2);
    expect(component.posts[1].title).toBe('Next Post');
  });

  it('should fall back to static posts on fetch error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

    // Reset fetch to return error
    fetchSpy.mockReset();
    fetchSpy.mockReturnValue(mockFetchError());

    const staticPosts = [{ ...mockPosts[0], id: '99', title: 'Static Post' }];
    blogServiceSpy.getStaticPosts.mockReturnValue(of({
      items: staticPosts,
      total: 5,
      page: 1,
      page_size: 10,
      total_pages: 1
    }));

    fixture.detectChanges();
    await flushPromises();
    await flushPromises();

    expect((component as any).usingFallback).toBe(true);
    expect(component.posts.length).toBe(1);
    expect(component.posts[0].title).toBe('Static Post');
    expect(component.isLoading).toBe(false);
    errorSpy.mockRestore();
  });

  it('should handle end of list', async () => {
    fixture.detectChanges();
    await flushPromises();
    await flushPromises();

    fetchSpy.mockReturnValueOnce(mockFetchResponse({
      items: [],
      total: 1,
      page: 2,
      page_size: 5,
      total_pages: 1
    }));

    component.hasMore = true;
    component.loadMore();

    await flushPromises();
    await flushPromises();

    expect(component.hasMore).toBe(false);
  });

  it('should not load more if isLoading or no more posts', async () => {
    fixture.detectChanges();
    await flushPromises();
    await flushPromises();

    const fetchCallCount = fetchSpy.mock.calls.length;

    // Case 1: isLoading
    component.isLoading = true;
    component.loadMore();
    expect(fetchSpy.mock.calls.length).toBe(fetchCallCount);

    // Case 2: !hasMore
    component.isLoading = false;
    component.hasMore = false;
    component.loadMore();
    expect(fetchSpy.mock.calls.length).toBe(fetchCallCount);
  });

  it('should handle load error on load-more', async () => {
    fixture.detectChanges();
    await flushPromises();
    await flushPromises();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

    fetchSpy.mockReturnValueOnce(mockFetchError());

    component.hasMore = true;
    component.loadMore();

    await flushPromises();
    await flushPromises();

    expect(component.isLoading).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('should filter by tag and reset pagination', async () => {
    fixture.detectChanges();
    await flushPromises();
    await flushPromises();

    fetchSpy.mockClear();
    fetchSpy.mockReturnValueOnce(mockFetchResponse({
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
      total_pages: 0
    }));

    component.filterByTag('angular');

    expect(component.activeTag).toBe('angular');
    expect(component.currentPage).toBe(1);
    expect(component.posts).toEqual([]);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('should clear tag filter and reset pagination', async () => {
    component.activeTag = 'angular';
    fixture.detectChanges();
    await flushPromises();
    await flushPromises();

    fetchSpy.mockClear();
    fetchSpy.mockReturnValueOnce(mockFetchResponse(initialFetchData));

    component.clearTagFilter();

    expect(component.activeTag).toBeNull();
    expect(component.currentPage).toBe(1);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('should use blogService.getPosts in non-browser SSR environments', async () => {
    // Re-create the component with 'server' instead of an object to trigger SSR logic path
    const serverComponent = makeServerComponent();
    serverComponent.loadPosts();
    expect(blogServiceSpy.getPosts).toHaveBeenCalledWith(true, null, null, 1, 10);
  });

  it('should fall back to using static posts when SSR blogService.getPosts fails', async () => {
    const serverComponent = makeServerComponent();
    blogServiceSpy.getPosts.mockReturnValueOnce(throwError(() => new Error('SSR load error')));
    serverComponent.loadPosts();
    expect(blogServiceSpy.getStaticPosts).toHaveBeenCalledWith(1, 10);
  });

  it('should handle onSearch and debounce with timeout', () => {
    vi.useFakeTimers();
    const event = { target: { value: 'search query' } };
    component.onSearch(event);
    vi.advanceTimersByTime(10);
    expect(component.isSearching).toBe(true);
    expect(blogServiceSpy.searchPosts).toHaveBeenCalledWith('search query');

    component.searchResults$?.subscribe(); // Trigger the pipe mapping
    expect(component.isSearching).toBe(false);
    vi.useRealTimers();
  });

  it('should handle onSearch early exit if query is small', () => {
    vi.useFakeTimers();
    const event = { target: { value: 'xy' } };
    component.onSearch(event);
    vi.advanceTimersByTime(10);
    expect(component.isSearching).toBe(false);
    expect(component.searchResults$).toBeNull();
    vi.useRealTimers();
  });

  it('should handle clearSearch correctly with timeouts', () => {
    vi.useFakeTimers();
    const inputMock = { value: 'search text' } as HTMLInputElement;
    component.clearSearch(inputMock);
    vi.advanceTimersByTime(10);
    expect(inputMock.value).toBe('');
    expect(component.currentQuery).toBe('');
    expect(component.searchResults$).toBeNull();
    expect(component.isSearching).toBe(false);
    vi.useRealTimers();
  });

  it('should collapse an already expanded post when toggled again', async () => {
    fixture.detectChanges();
    await flushPromises();
    const post = { ...mockPosts[0], slug: 'test-post' } as any;

    component.toggleOrNavigate(post);
    expect(component.isExpanded(post.id)).toBe(true);

    // Call internal togglePost manually with same ID to trigger collapse logic
    component.togglePost(post.id);
    expect(component.expandedPostId).toBeNull();
  });

  it('should expand post on first click via toggleOrNavigate', async () => {
    fixture.detectChanges();
    await flushPromises();
    await flushPromises();

    const post = { ...mockPosts[0], slug: 'test-post' } as any;

    component.toggleOrNavigate(post);
    expect(component.isExpanded(post.id)).toBe(true);
  });

  it('should navigate to post on second click via toggleOrNavigate', async () => {
    fixture.detectChanges();
    await flushPromises();
    await flushPromises();

    const router = TestBed.inject(Router) as any;
    vi.spyOn(router, 'navigate');
    const post = { ...mockPosts[0], slug: 'test-post' } as any;

    // First click: expand
    component.toggleOrNavigate(post);
    expect(component.isExpanded(post.id)).toBe(true);

    // Second click: navigate
    component.toggleOrNavigate(post);
    expect(router.navigate).toHaveBeenCalledWith(['/blog', 'test-post']);
  });

  it('should copy URL to clipboard on sharePost', async () => {
    fixture.detectChanges();
    await flushPromises();
    await flushPromises();

    const post = { ...mockPosts[0], slug: 'test-post', title: 'Test Post' } as any;

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      writable: true,
      configurable: true,
    });
    // Ensure navigator.share is undefined to fallback to clipboard
    Object.defineProperty(navigator, 'share', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    await component.sharePost(post);
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('/blog/test-post'));
  });

  it('should use navigator.share if available', async () => {
    fixture.detectChanges();
    await flushPromises();
    const post = { ...mockPosts[0], slug: 'test-post', title: 'Test Post' } as any;

    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      writable: true,
      configurable: true,
    });

    await component.sharePost(post);
    expect(shareSpy).toHaveBeenCalledWith({
      title: 'Test Post',
      url: expect.stringContaining('/blog/test-post'),
    });
  });
});
