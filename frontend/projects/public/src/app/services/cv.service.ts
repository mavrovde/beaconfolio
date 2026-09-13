import { Injectable } from '@angular/core';
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
    private apiUrl = `${environment.apiUrl}${environment.apiPrefix}/cv`;

    constructor(private http: HttpClient) { }

    requestCv(payload: CvRequestPayload): Observable<CvResponse> {
        return this.http.post<CvResponse>(`${this.apiUrl}/request`, payload);
    }

    getDownloadUrl(relativePath: string): string {
        // OPEN REDIRECT (Snyk `javascript/OR`). The previous form began with
        //     if (relativePath.startsWith('http')) return relativePath;
        // which handed any absolute URL in the API response straight to
        // `window.open`. The backend only ever emits a RELATIVE path
        // (`backend/app/api/cv.py`), so that branch bought nothing and turned a
        // compromised or spoofed response into a redirect to any origin.
        //
        // Now the origin is ours by construction: an absolute URL is reduced to
        // its path before the base is applied. `new URL(...)` needs a base for
        // relative input, hence the dummy — only `.pathname`/`.search` are used.
        let path = relativePath;
        if (/^[a-z][a-z0-9+.-]*:/i.test(relativePath) || relativePath.startsWith('//')) {
            const parsed = new URL(relativePath, 'https://placeholder.invalid');
            path = `${parsed.pathname}${parsed.search}`;
        }
        if (!path.startsWith('/')) {
            path = `/${path}`;
        }
        return environment.apiUrl ? `${environment.apiUrl}${path}` : path;
    }
}
