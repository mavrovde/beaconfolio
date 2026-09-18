import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Admin job-search pipeline (#247). */
export interface OpportunityNote {
    id: string;
    interaction_id: string | null;
    body: string;
    created_at: string;
}

export interface Opportunity {
    id: string;
    company: string;
    role_title: string;
    stage: string;
    source: string;
    recruiter_name: string | null;
    recruiter_email: string | null;
    link: string | null;
    salary_note: string | null;
    next_action: string | null;
    next_action_date: string | null;
    sent_cv_id: string | null;
    sent_cv_at: string | null;
    created_at: string;
    updated_at: string;
    notes: OpportunityNote[];
}

export interface OpportunityPage {
    items: Opportunity[];
    total: number;
    page: number;
    pages: number;
}

export interface OpportunityInput {
    company: string;
    role_title: string;
    stage?: string;
    source?: string;
    recruiter_name?: string | null;
    recruiter_email?: string | null;
    link?: string | null;
    salary_note?: string | null;
    next_action?: string | null;
    next_action_date?: string | null;
}

export const OPPORTUNITY_STAGES = [
    'lead',
    'contacted',
    'screening',
    'interviewing',
    'offer',
    'closed_won',
    'closed_lost',
] as const;

export const OPPORTUNITY_SOURCES = [
    'recruiter_outreach',
    'self_applied',
    'referral',
    'discovery',
] as const;

@Injectable({
    providedIn: 'root'
})
export class OpportunitiesService {
    private http = inject(HttpClient);

    private apiUrl = `${environment.apiUrl}${environment.apiPrefix}/admin/opportunities`;

    list(options: { stage?: string; page?: number; pageSize?: number } = {}): Observable<OpportunityPage> {
        let params = new HttpParams()
            .set('page', options.page ?? 1)
            .set('page_size', options.pageSize ?? 200);
        if (options.stage) {
            params = params.set('stage', options.stage);
        }
        return this.http.get<OpportunityPage>(this.apiUrl, { params });
    }

    get(id: string): Observable<Opportunity> {
        return this.http.get<Opportunity>(`${this.apiUrl}/${id}`);
    }

    create(input: OpportunityInput): Observable<Opportunity> {
        return this.http.post<Opportunity>(this.apiUrl, input);
    }

    moveStage(id: string, stage: string): Observable<Opportunity> {
        return this.http.patch<Opportunity>(`${this.apiUrl}/${id}/stage`, { stage });
    }

    /** Record which CV variant went to this company (#247 criterion 4).
     *  The backend sets the timestamp, updates the pointer, and appends the
     *  durable "CV sent: version (filename)" note to the timeline. */
    recordCvSent(opportunityId: string, cvDocumentId: string): Observable<Opportunity> {
        return this.http.post<Opportunity>(`${this.apiUrl}/${opportunityId}/cv-sent`, {
            cv_document_id: cvDocumentId,
        });
    }

    addNote(id: string, body: string): Observable<Opportunity> {
        return this.http.post<Opportunity>(`${this.apiUrl}/${id}/notes`, { body });
    }

    promote(interactionId: string, roleTitle?: string): Observable<Opportunity> {
        return this.http.post<Opportunity>(`${this.apiUrl}/promote`, {
            interaction_id: interactionId,
            role_title: roleTitle ?? null,
        });
    }
}
