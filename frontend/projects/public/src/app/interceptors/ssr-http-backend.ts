import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { HttpBackend, HttpEvent, HttpRequest, HttpXhrBackend } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SSR_BACKEND_ORIGIN } from '../ssr-backend-origin';

/**
 * Rewrites relative API/asset URLs to absolute, container-internal addresses
 * during SSR — but only at the point the request is actually dispatched to the
 * network, i.e. inside the `HttpBackend`, **not** in an `HttpInterceptorFn`.
 *
 * ## Why the rewrite must live here (issue #25 — blog "flash to home")
 *
 * Interceptors registered via `withInterceptors()` run *before* Angular's HTTP
 * transfer-cache interceptor (a root-level interceptor appended after all
 * feature interceptors in the chain). When the rewrite lived in an interceptor
 * (the removed `ssr.interceptor.ts`):
 *  - during SSR, the transfer cache computed its key from the *rewritten*
 *    absolute URL (`http://backend:8000/api/app/posts/x`);
 *  - during hydration, the browser computed its key from the *original*
 *    relative URL (`/api/app/posts/x`).
 *
 * The keys never matched, so the browser never found the SSR-cached response
 * and re-fetched every request on hydration. A transient failure of that
 * needless blog-post re-fetch then hit `BlogPostComponent`'s `catchError`,
 * which navigates back to `/` — the "flash to home" of issue #25.
 *
 * Rewriting here, in the `HttpBackend`, happens *after* the transfer-cache
 * interceptor has already read/written its entry keyed on the original URL
 * (identical on server and client), so the client reuses the SSR response.
 *
 * ## Why we delegate to `HttpXhrBackend`, not `FetchBackend` (issue #94)
 *
 * The first attempt at this fix (PR #84) delegated to `FetchBackend`, which
 * forced the *browser* off Angular's XHR backend and deterministically broke
 * the public site's only genuine browser fetch (`GET /api/app/stats/public`
 * → `net::ERR_FAILED`), failing `footer-stats.spec.ts` and blocking the
 * deploy. This backend instead delegates to `HttpXhrBackend` — the exact
 * backend the app has always used on both platforms (browser: `BrowserXhr`;
 * server: platform-server's xhr2 factory) — so the browser dispatch is
 * byte-identical to the working baseline. Only the *server-side* URL rewrite
 * changes location (interceptor → backend); nothing about the browser path
 * changes, so #94 cannot regress.
 */
@Injectable()
export class SsrHttpBackend implements HttpBackend {
  constructor(
    private readonly xhrBackend: HttpXhrBackend,
    @Inject(PLATFORM_ID) private readonly platformId: object,
  ) {}

  handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    if (isPlatformServer(this.platformId) && !req.url.startsWith('http')) {
      let absoluteUrl: string;
      if (req.url.startsWith('/api')) {
        absoluteUrl = `${SSR_BACKEND_ORIGIN}${req.url}`;
      } else if (req.url.startsWith('api/')) {
        absoluteUrl = `${SSR_BACKEND_ORIGIN}/${req.url}`;
      } else {
        // Assets / other non-API routes are served by the Angular SSR server itself.
        const prefix = req.url.startsWith('/') ? '' : '/';
        absoluteUrl = `http://127.0.0.1:4000${prefix}${req.url}`;
      }

      req = req.clone({ url: absoluteUrl });
    }

    return this.xhrBackend.handle(req);
  }
}
