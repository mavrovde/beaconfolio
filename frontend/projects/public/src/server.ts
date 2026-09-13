import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { renderLlmsTxt } from './app/seo/llms-txt';
import {
  createJsonFetcher,
  renderRobotsTxt,
  renderSitemapXml,
  requestOrigin,
} from './app/seo/sitemap';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
// Express advertises `X-Powered-By: Express` on every response by default —
// free reconnaissance, and the exact header the bare 404 leaked before #324
// gave unmatched URLs a real Angular page. Snyk `javascript/DisablePoweredBy`.
app.disable('x-powered-by');

// Angular SSR (>=21.2) hardens the Node engine against SSRF in two ways, and
// BOTH of them silently break pre-rendered SSR behind a reverse proxy unless
// configured explicitly:
//
//  1. Host allowlist: the incoming `Host` / `X-Forwarded-Host` header is checked
//     against `allowedHosts`. Our Docker/CI topology chains two nginx layers
//     (outer proxy -> frontend nginx -> node), and the Host that actually
//     reaches node is the internal service name `frontend`, not the public
//     `localhost`/`beaconfolio.com`. An unlisted host makes the engine return a CSR
//     shell (or a 400), so `<title>`, `<h1>` and body content go missing.
//
//  2. Proxy-header trust: any `x-forwarded-*` header that is NOT in
//     `trustProxyHeaders` (default trusts only `x-forwarded-host` and
//     `x-forwarded-proto`) is treated as untrusted and forces a deopt to CSR.
//     Our proxy adds `x-forwarded-for`, which alone triggers that CSR fallback
//     even when the host passes validation.
//
// This site is only ever served behind trusted reverse-proxy infrastructure
// that already validates the public Host header, so we allow all hosts and
// trust the forwarded headers to keep SSR working end-to-end. `*` is a
// first-class allow-all value in @angular/ssr's `isHostAllowed`.
//
// The host allowlist can still be pinned per-deployment via `NG_ALLOWED_HOSTS`
// (comma-separated). When it is unset — or set to `*` — we allow all hosts.
function resolveAllowedHosts(): readonly string[] {
  const fromEnv = (process.env['NG_ALLOWED_HOSTS'] ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0);

  if (fromEnv.length === 0 || fromEnv.includes('*')) {
    return ['*'];
  }

  return fromEnv;
}

const angularApp = new AngularNodeAppEngine({
  allowedHosts: resolveAllowedHosts(),
  // Trust the standard forwarded headers our proxy injects (incl.
  // `x-forwarded-for`) so proxied requests are not deopted to client-side
  // rendering.
  trustProxyHeaders: true,
});

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Discoverability files, rendered per request from the runtime site config
 * (`SITE_URL`) and the live published-post list instead of shipping a static
 * copy hardcoded to one domain (#71) — `robots.txt` and `sitemap.xml` for
 * classic crawlers, `llms.txt` for AI assistants (#252). All the logic — and
 * its tests — lives in `app/seo/sitemap.ts` and `app/seo/llms-txt.ts`; this
 * file is only the wiring. Registered BEFORE the static handler so a stale
 * bundled copy could never shadow them.
 */
const fetchJson = createJsonFetcher();

app.get('/robots.txt', (req, res, next) => {
  renderRobotsTxt(fetchJson, requestOrigin(req.headers, req.protocol))
    .then((body) => res.type('text/plain; charset=utf-8').send(body))
    .catch(next);
});

app.get('/llms.txt', (req, res, next) => {
  renderLlmsTxt(fetchJson, requestOrigin(req.headers, req.protocol))
    // Markdown by content, `.txt` by convention (llmstxt.org). `text/plain`
    // keeps it readable in a browser tab, which is what agents and humans both
    // do with it first.
    .then((body) => res.type('text/plain; charset=utf-8').send(body))
    .catch(next);
});

app.get('/sitemap.xml', (req, res, next) => {
  renderSitemapXml(fetchJson, requestOrigin(req.headers, req.protocol))
    .then((body) => res.type('application/xml; charset=utf-8').send(body))
    .catch(next);
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
