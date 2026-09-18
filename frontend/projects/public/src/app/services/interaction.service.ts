import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Public side of the recruiter communication hub (#69). */
export interface ContactPayload {
    name: string;
    email: string;
    company?: string | null;
    message: string;
}

export interface InteractionResponse {
    id: string;
    source: string;
    status: string;
    name: string;
    email: string;
    company: string | null;
    message: string;
    created_at: string;
}

@Injectable({
    providedIn: 'root'
})
export class InteractionService {
    private http = inject(HttpClient);


    submitContact(payload: ContactPayload): Observable<InteractionResponse> {
        const url = `${environment.apiUrl}${environment.apiPrefix}/interactions/contact`;
        return this.http.post<InteractionResponse>(url, payload);
    }
}
