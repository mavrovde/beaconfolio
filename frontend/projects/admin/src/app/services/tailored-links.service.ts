import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Tailored application links (#250) — the admin half.
 *
 * Mirrors `TailoredLinkOut` / `TailoredLinkIn` in
 * `backend/app/api/tailored_links.py`. Unlike the public payload, this one
 * carries the owner's own signal (visits, downloads) — it is never served to a
 * recipient.
 */
export interface TailoredLink {
    id: string;
    opportunity_id: string;
    slug: string;
    /** Site-relative path, e.g. `/for/acme-staff-eng`. */
    path: string;
    /** Absolute URL built from the runtime SITE_URL — the copyable one. */
    url: string;
    cv_document_id: string | null;
    cv_version: string | null;
    cv_filename: string | null;
    headline_note: string | null;
    highlighted_skills: string[];
    highlighted_projects: string[];
    enabled: boolean;
    expires_at: string | null;
    visit_count: number;
    cv_download_count: number;
    last_visited_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface TailoredLinkInput {
    opportunity_id: string;
    slug?: string | null;
    cv_document_id?: string | null;
    headline_note?: string | null;
    highlighted_skills?: string[];
    highlighted_projects?: string[];
    expires_at?: string | null;
}

export interface TailoredLinkPatch {
    enabled?: boolean;
    cv_document_id?: string | null;
    clear_cv?: boolean;
    headline_note?: string | null;
    highlighted_skills?: string[];
    highlighted_projects?: string[];
    expires_at?: string | null;
    clear_expiry?: boolean;
}

@Injectable({ providedIn: 'root' })
export class TailoredLinksService {
    private http = inject(HttpClient);

    private apiUrl = `${environment.apiUrl}${environment.apiPrefix}/admin/tailored-links`;

    listFor(opportunityId: string): Observable<TailoredLink[]> {
        const params = new HttpParams().set('opportunity_id', opportunityId);
        return this.http.get<TailoredLink[]>(this.apiUrl, { params });
    }

    create(input: TailoredLinkInput): Observable<TailoredLink> {
        return this.http.post<TailoredLink>(this.apiUrl, input);
    }

    update(id: string, patch: TailoredLinkPatch): Observable<TailoredLink> {
        return this.http.patch<TailoredLink>(`${this.apiUrl}/${id}`, patch);
    }

    remove(id: string): Observable<void> {
        return this.http.delete<void>(`${this.apiUrl}/${id}`);
    }
}

/**
 * Split a comma-separated highlight field into the array the API expects.
 * A free-text control is the right input here — the owner types the skills
 * that matter for THIS role, which need not exist verbatim in the profile.
 */
export function parseHighlights(value: string): string[] {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}
