import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TagStat {
  name: string;
  count: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
@Injectable({
  providedIn: 'root',
})
export class TagsService {
  private http = inject(HttpClient);

  private apiUrl = `${environment.apiUrl}${environment.apiPrefix}/tags`;

  getAllTags(
    page: number = 1,
    pageSize: number = 10,
    sortBy: string = 'count',
    sortOrder: 'asc' | 'desc' = 'desc',
    search: string | null = null
  ): Observable<PaginatedResponse<TagStat>> {
    const params: Record<string, string> = {
      page: page.toString(),
      page_size: pageSize.toString(),
      sort_by: sortBy,
      sort_order: sortOrder
    };
    if (search) {
      params['search'] = search;
    }
    return this.http.get<PaginatedResponse<TagStat>>(this.apiUrl, { params });
  }

  renameTag(oldName: string, newName: string): Observable<unknown> {
    return this.http.put(`${this.apiUrl}/${oldName}`, { new_name: newName });
  }

  deleteTag(name: string): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/${name}`);
  }
}
