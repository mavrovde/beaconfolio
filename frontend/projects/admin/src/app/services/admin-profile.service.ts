import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PaginatedResponse } from './admin-cv.service';

export type ProfileLanguage = 'en' | 'de';

export interface ProfileSnapshot {
  id: string;
  version: string;
  language: ProfileLanguage;
  is_active: boolean;
  created_at: string;
}

@Injectable({
  providedIn: 'root',
})
export class AdminProfileService {
  private http = inject(HttpClient);

  private apiUrl = `${environment.apiUrl}${environment.apiPrefix}/admin/profile`;

  uploadProfile(file: File, version: string, language: ProfileLanguage): Observable<unknown> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('version', version);
    formData.append('language', language);
    return this.http.post(`${this.apiUrl}/upload`, formData);
  }

  getVersions(
    page = 1,
    pageSize = 10,
    sortBy = 'created_at',
    sortOrder: 'asc' | 'desc' = 'desc',
    language: ProfileLanguage | null = null,
  ): Observable<PaginatedResponse<ProfileSnapshot>> {
    const params: Record<string, string> = {
      page: page.toString(),
      page_size: pageSize.toString(),
      sort_by: sortBy,
      sort_order: sortOrder,
    };
    if (language) {
      params['language'] = language;
    }
    return this.http.get<PaginatedResponse<ProfileSnapshot>>(`${this.apiUrl}/versions`, { params });
  }

  activateVersion(id: string): Observable<unknown> {
    return this.http.patch(`${this.apiUrl}/versions/${id}/activate`, {});
  }
}
