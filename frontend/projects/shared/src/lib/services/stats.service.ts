import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SHARED_ENVIRONMENT, SharedEnvironment } from '../config/environment.token';

export interface PostStats {
  total: number;
  published: number;
  drafts: number;
  by_language: { [key: string]: number };
}

export interface PostSummary {
  title: string;
  slug: string;
  created_at: string;
  views: number;
}

export interface SystemStats {
  posts: PostStats;
  users: number;
  subscribers: number;
  visitors: string;
  top_tags: { [key: string]: number };
  recent_posts: PostSummary[];
  system_health: { [key: string]: boolean };
}

@Injectable({
  providedIn: 'root',
})
export class StatsService {
  private http = inject(HttpClient);

  private apiUrl: string;

  constructor() {
    const env = inject<SharedEnvironment>(SHARED_ENVIRONMENT);

    this.apiUrl = `${env.apiUrl}${env.apiPrefix}/stats`;
  }

  getStats(): Observable<SystemStats> {
    return this.http.get<SystemStats>(this.apiUrl);
  }

  getPublicStats(): Observable<{ visitor_ip: string; backend_version: string; uptime: string; start_time: string | null }> {
    return this.http.get<{ visitor_ip: string; backend_version: string; uptime: string; start_time: string | null }>(`${this.apiUrl}/public`);
  }
}
