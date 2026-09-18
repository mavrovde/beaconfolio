import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * The public half of a tailored application link (#250).
 *
 * Mirrors `TailoredViewOut` in `backend/app/api/tailored_links.py` field for
 * field. It carries what the tailored page renders and NOTHING about the
 * owner's pipeline — no visit counters, no expiry, no opportunity id — because
 * the recipient of the link is the audience of this payload.
 */
export interface TailoredView {
    slug: string;
    company: string;
    role_title: string;
    headline_note: string | null;
    highlighted_skills: string[];
    highlighted_projects: string[];
    cv_version: string | null;
    /** API path of the pinned CV variant, or `null` → fall back to `/cv`. */
    cv_download_path: string | null;
}

@Injectable({ providedIn: 'root' })
export class TailoredLinkService {
    private http = inject(HttpClient);

    private readonly baseUrl = `${environment.apiUrl}${environment.apiPrefix}/for`;

    /** The tailored view for a slug. Unknown / disabled / expired all 404. */
    getView(slug: string): Observable<TailoredView> {
        return this.http.get<TailoredView>(`${this.baseUrl}/${encodeURIComponent(slug)}`);
    }

    /**
     * Count one opening of the link.
     *
     * Callers must invoke this from the BROWSER only: during SSR the server
     * renders the very same page, so counting there would double every real
     * visit and turn a crawler prefetch into a "recruiter opened it".
     */
    recordVisit(slug: string): Observable<void> {
        return this.http.post<void>(`${this.baseUrl}/${encodeURIComponent(slug)}/visit`, {});
    }

    /** Absolute-enough URL for the CV CTA; the backend pins the variant. */
    cvDownloadUrl(view: TailoredView): string | null {
        return view.cv_download_path ? `${environment.apiUrl}${view.cv_download_path}` : null;
    }
}
