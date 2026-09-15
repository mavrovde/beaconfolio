import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CvRequestSummary {
    id: string;
    name: string;
    email: string;
    company: string;
    message: string;
    created_at: string;
    consent_given: boolean;
    cv_version: string;
    position_description?: string;
    subscribe_to_updates?: boolean;
    downloaded_at?: string;
    download_count?: number;
}

export interface CvVersion {
    id: string;
    filename: string;
    version: string;
    is_active: boolean;
    created_at: string;
}

export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
}

@Injectable({
    providedIn: 'root'
})
export class AdminCvService {
    private apiUrl = `${environment.apiUrl}${environment.apiPrefix}/admin/cv`;

    constructor(private http: HttpClient) { }

    /** `activate=false` uploads a VARIANT (#247 criterion 4): the public
     *  download keeps serving the current default. Default true = the
     *  historical make-it-the-default behavior. */
    uploadCv(file: File, version: string, activate: boolean = true): Observable<unknown> {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('version', version);
        formData.append('activate', String(activate));
        return this.http.post(`${this.apiUrl}/upload`, formData);
    }

    getRequests(
        page: number = 1,
        pageSize: number = 10,
        sortBy: string = 'created_at',
        sortOrder: 'asc' | 'desc' = 'desc',
        search: string | null = null
    ): Observable<PaginatedResponse<CvRequestSummary>> {
        const params: Record<string, string> = {
            page: page.toString(),
            page_size: pageSize.toString(),
            sort_by: sortBy,
            sort_order: sortOrder
        };
        if (search) {
            params['search'] = search;
        }
        return this.http.get<PaginatedResponse<CvRequestSummary>>(`${this.apiUrl}/requests`, { params });
    }

    getVersions(
        page: number = 1,
        pageSize: number = 10,
        sortBy: string = 'created_at',
        sortOrder: 'asc' | 'desc' = 'desc',
        search: string | null = null
    ): Observable<PaginatedResponse<CvVersion>> {
        const params: Record<string, string> = {
            page: page.toString(),
            page_size: pageSize.toString(),
            sort_by: sortBy,
            sort_order: sortOrder
        };
        if (search) {
            params['search'] = search;
        }
        return this.http.get<PaginatedResponse<CvVersion>>(`${this.apiUrl}/versions`, { params });
    }
}
