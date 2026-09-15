import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface LinkedInPost {
    id: string;
    content: string;
    imageUrl?: string;
    url?: string;
    urn?: string;
    time?: string;
}

export interface LinkedInTransferResponse {
    id: number;
    message: string;
}

export interface LinkedInBulkTransferResponse {
    transferred: number;
    ids: number[];
    message: string;
}

export interface LinkedInImportPostsJsonResponse {
    created: number;
    updated: number;
    skipped: number;
    count: number;
}

@Injectable({
    providedIn: 'root'
})
export class LinkedinService {
    private authService = inject(AuthService);
    private apiUrl = `${environment.apiUrl}${environment.apiPrefix}/linkedin`;

    private getHeaders(): HeadersInit {
        const token = this.authService.getToken();
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    /**
     * Check if a valid LinkedIn session is available
     */
    async getStatus(): Promise<{ logged_in: boolean }> {
        const response = await fetch(`${this.apiUrl}/status`, { headers: this.getHeaders() });
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.detail || 'Failed to check status');
        }
        return await response.json();
    }

    /**
     * Dynamically login using username and password
     */
    async login(username: string, password: string): Promise<unknown> {
        const response = await fetch(`${this.apiUrl}/login`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ username, password })
        });
        if (!response.ok) {
             const body = await response.json().catch(() => null);
             throw new Error(body?.detail || 'Login failed');
        }
        return await response.json();
    }

    /**
     * Trigger a LinkedIn profile synchronization scan
     */
    async syncProfile(): Promise<unknown> {
        const response = await fetch(`${this.apiUrl}/profile-sync`, { headers: this.getHeaders() });
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.detail || 'Failed to sync profile');
        }
        return await response.json();
    }

    /**
     * Fetch the admin's recent LinkedIn posts
     */
    async getPosts(): Promise<LinkedInPost[]> {
        const response = await fetch(`${this.apiUrl}/posts`, { headers: this.getHeaders() });
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.detail || 'Failed to fetch posts');
        }
        return await response.json();
    }

    /**
     * Transfer a single scraped LinkedIn post to the local system
     */
    async transferPost(post: LinkedInPost): Promise<LinkedInTransferResponse> {
        const response = await fetch(`${this.apiUrl}/transfer-post`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                content: post.content,
                image_url: post.imageUrl || null,
                urn: post.urn || null
            })
        });
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.detail || 'Failed to transfer post');
        }
        return await response.json();
    }

    /**
     * Bulk-import a scraper `posts_data.json` file (multipart upload).
     * Posts are upserted by URN as drafts on the server.
     */
    async importPostsJson(file: File): Promise<LinkedInImportPostsJsonResponse> {
        const token = this.authService.getToken();
        // Multipart: let the browser set Content-Type (with boundary) — do NOT set JSON.
        const headers: HeadersInit = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${this.apiUrl}/import-posts-json`, {
            method: 'POST',
            headers,
            body: formData,
        });
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.detail || 'Failed to import posts JSON');
        }
        return await response.json();
    }

    /**
     * Transfer multiple LinkedIn posts to the local system in bulk
     */
    async transferPosts(posts: LinkedInPost[]): Promise<LinkedInBulkTransferResponse> {
        const response = await fetch(`${this.apiUrl}/transfer-posts`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(posts.map(post => ({
                content: post.content,
                image_url: post.imageUrl || null,
                urn: post.urn || null
            })))
        });
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.detail || 'Failed to transfer posts');
        }
        return await response.json();
    }
}
