/**
 * The container-internal address of the backend on the compose network, used by
 * everything that talks to the API from inside the SSR process.
 *
 * It lives alone in this module because it is a DEPLOYMENT fact with two
 * independent consumers — `interceptors/ssr-http-backend.ts` (rewrites the
 * Angular app's relative API URLs during SSR) and `seo/sitemap.ts` (reads the
 * site config and post list for `sitemap.xml`/`robots.txt`). Neither can own it:
 * `sitemap.ts` is server-only, so importing it into the interceptor would drag
 * the XML renderer into the BROWSER bundle, and importing the interceptor into
 * `sitemap.ts` would put an `@Injectable` inside a deliberately DI-free module.
 * A third, dependency-free module lets both share one copy — two copies of one
 * deployment fact drift (#317 review round 1).
 *
 * Note the *test* specs deliberately keep the literal spelled out: an assertion
 * that imports the value it asserts would pass against any value.
 *
 * Plain `http` is deliberate (Sonar `typescript:S5332`, reviewed): `backend` is
 * a Docker DNS name that only resolves on the private compose network, so the
 * hop never leaves the host — `docker-compose.prod.yml` publishes no backend
 * port at all (only the dev file maps 8000, for local debugging) and TLS
 * terminates at the `proxy` edge. Uvicorn serves no TLS, so an
 * `https://` origin here would simply fail every SSR read. Visitors' traffic
 * never takes this path; it is SSR-process → container only.
 */
export const SSR_BACKEND_ORIGIN = 'http://backend:8000'; // NOSONAR — container-internal hop, see above
