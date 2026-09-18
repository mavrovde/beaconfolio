import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Admin side of the recruiter communication hub (#69). */
export interface Interaction {
    id: string;
    source: string;
    status: string;
    name: string;
    email: string;
    company: string | null;
    message: string;
    payload: Record<string, unknown> | null;
    /** Transparent translation (#248): the ORIGINAL message above is never
     *  mutated; these are separate, machine-generated, re-runnable. Null =
     *  predates the feature or the flag is off. */
    detected_language: string | null;
    translated_message: string | null;
    translated_to: string | null;
    translation_status: string | null;
    created_at: string;
    updated_at: string;
}

export interface InteractionPage {
    items: Interaction[];
    total: number;
    page: number;
    pages: number;
}

export const INTERACTION_STATUSES = ['new', 'contacted', 'in_progress', 'closed'] as const;
export const INTERACTION_SOURCES = ['contact_form', 'cv_request', 'booking'] as const;

@Injectable({
    providedIn: 'root'
})
export class InteractionsService {
    private http = inject(HttpClient);

    private apiUrl = `${environment.apiUrl}${environment.apiPrefix}/admin/interactions`;

    list(options: {
        status?: string;
        source?: string;
        page?: number;
        pageSize?: number;
    } = {}): Observable<InteractionPage> {
        let params = new HttpParams()
            .set('page', options.page ?? 1)
            .set('page_size', options.pageSize ?? 20);
        if (options.status) {
            params = params.set('status', options.status);
        }
        if (options.source) {
            params = params.set('source', options.source);
        }
        return this.http.get<InteractionPage>(this.apiUrl, { params });
    }

    /** Re-run machine translation for one interaction (#248). */
    rerunTranslation(id: string): Observable<Interaction> {
        return this.http.post<Interaction>(`${this.apiUrl}/${id}/translate`, {});
    }

    updateStatus(id: string, status: string): Observable<Interaction> {
        return this.http.patch<Interaction>(`${this.apiUrl}/${id}`, { status });
    }
}
