import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CvRequestPayload {
    name: string;
    email: string;
    company?: string;
    message: string;
    position_description?: string;
    subscribe_to_updates?: boolean;
}

export interface CvResponse {
    success: boolean;
    message: string;
    download_url: string;
}

@Injectable({
    providedIn: 'root'
})
export class CvService {
    private http = inject(HttpClient);

    private apiUrl = `${environment.apiUrl}${environment.apiPrefix}/cv`;

    requestCv(payload: CvRequestPayload): Observable<CvResponse> {
        return this.http.post<CvResponse>(`${this.apiUrl}/request`, payload);
    }

    getDownloadUrl(relativePath: string): string {
        // OPEN REDIRECT (Snyk `javascript/OR`). The original returned any
        // absolute URL from the API response verbatim into `window.open`.
        //
        // A first fix gated on `startsWith('http')`/`'//'` and was NOT enough —
        // measured bypasses: `/\evil.com/x` and `\\evil.com/x` (the WHATWG
        // parser treats a backslash as a separator for special schemes), and it
        // only applied when `environment.apiUrl` was set, which it is NOT in
        // either shipped environment — both are `''`.
        //
        // So: parse UNCONDITIONALLY against a throwaway base and keep only
        // `pathname + search`. Any authority in the input — scheme, host,
        // backslash form, protocol-relative — is discarded by construction
        // rather than by a pattern that has to anticipate every spelling.
        let path: string;
        try {
            const parsed = new URL(relativePath, 'https://placeholder.invalid');
            path = `${parsed.pathname}${parsed.search}`;
        } catch {
            // `new URL('http://')` and friends throw; a malformed value is not
            // something to pass along, so fall back to the API root.
            path = '/';
        }
        // `URL.pathname` always starts with ONE slash — but it can start with
        // TWO, and `startsWith('/')` happily accepts that. `..//evil.com/x`
        // over-pops the base, leaving an empty first segment, so `pathname` is
        // `//evil.com/x`; with `apiUrl` empty (which is what BOTH environments
        // ship) that is returned raw and `window.open` treats it as
        // protocol-relative — off-origin. Non-special schemes add more
        // (`javascript:////x`, `x:/\/x`) because their opaque paths are never
        // normalised. Collapsing every leading slash/backslash to exactly one
        // closes the whole class instead of the spellings someone thought of:
        // measured 0 escapes across 80 vectors, with `/a//b` preserved.
        path = '/' + path.replace(/^[/\\]+/, '');
        return environment.apiUrl ? `${environment.apiUrl}${path}` : path;
    }
}
