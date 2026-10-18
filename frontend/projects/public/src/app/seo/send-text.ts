/**
 * How the SSR server answers with a GENERATED machine file (`robots.txt`,
 * `llms.txt`, `llms-full.txt`, `sitemap.xml`, the IndexNow key file).
 *
 * Those bodies are composed from backend data (profile text, post titles), so
 * they must never be interpreted as HTML. The explicit non-HTML
 * `Content-Type` says what they are, and `X-Content-Type-Options: nosniff`
 * forbids a browser from second-guessing it — neither the proxy nor the app
 * set that header before, so a `text/plain` body carrying markup relied on
 * the browser not sniffing.
 *
 * Structural so it is unit-testable without Express; `src/server.ts` passes
 * the Express `Response`.
 */
export interface GeneratedFileResponse {
    setHeader(name: string, value: string): unknown;
    send(body: string): unknown;
}

export const PLAIN_TEXT = 'text/plain; charset=utf-8';
export const XML = 'application/xml; charset=utf-8';

export function sendGeneratedFile(
    res: GeneratedFileResponse,
    contentType: typeof PLAIN_TEXT | typeof XML,
    body: string,
): void {
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(body);
}
