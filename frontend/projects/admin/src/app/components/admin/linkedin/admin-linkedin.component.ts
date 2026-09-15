import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LinkedinService, LinkedInPost } from '../../../services/linkedin.service';

@Component({
    selector: 'app-admin-linkedin',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './admin-linkedin.component.html',
    styleUrls: ['./admin-linkedin.component.css']
})
export class AdminLinkedinComponent implements OnInit {
    private linkedinService = inject(LinkedinService);
    private cdr = inject(ChangeDetectorRef);

    isSyncingProfile = false;
    isFetchingPosts = false;
    transferringPostId: string | null = null;
    activeTab: 'profile' | 'posts' = 'posts';

    isLoggedIn = false;
    isLoggingIn = false;
    linkedinUsername = '';
    linkedinPassword = '';

    profileData: unknown = null;
    posts: LinkedInPost[] = [];
    statusMessage: string = '';

    selectedPostsFile: File | null = null;
    isUploadingPostsJson = false;

    ngOnInit(): void {
        this.checkLoginStatus();
    }

    async checkLoginStatus() {
        try {
            const status = await this.linkedinService.getStatus();
            this.isLoggedIn = status.logged_in;
        } catch (e) {
            console.error('Failed to get status', e);
        } finally {
            // The app is zoneless, so an assignment after `await` repaints
            // nothing on its own. Without this the connection banner and the
            // login form stayed frozen at "not connected" for an operator who
            // WAS connected — every sibling async method here already does it.
            this.cdr.detectChanges();
        }
    }

    async login() {
        if (!this.linkedinUsername || !this.linkedinPassword) return;
        
        this.isLoggingIn = true;
        this.statusMessage = 'Logging in to LinkedIn...';
        
        try {
            await this.linkedinService.login(this.linkedinUsername, this.linkedinPassword);
            this.isLoggedIn = true;
            this.statusMessage = 'Successfully logged in and session saved.';
            this.clearMessageAfterDelay();
            this.linkedinPassword = ''; // Clear for security
        } catch (e) {
            this.statusMessage =
                (e instanceof Error && e.message) ||
                'Login failed. Note: MFA is not currently supported.';
        } finally {
            this.isLoggingIn = false;
            this.cdr.detectChanges();
        }
    }

    setTab(tab: 'profile' | 'posts') {
        this.activeTab = tab;
    }

    async syncProfile(): Promise<void> {
        this.isSyncingProfile = true;
        this.statusMessage = 'Scanning profile...';
        try {
            const data = await this.linkedinService.syncProfile();
            console.log('[DEBUG] PROFILE RECEIVED:', JSON.stringify(data));
            this.profileData = data;
            this.isSyncingProfile = false;
            this.statusMessage = 'Profile synced successfully.';
            this.clearMessageAfterDelay();
        } catch (err) {
            this.isSyncingProfile = false;
            console.error('Error syncing profile:', err);
            this.statusMessage = 'Error syncing profile.';
        } finally {
            this.cdr.detectChanges();
        }
    }

    async fetchPosts(): Promise<void> {
        this.isFetchingPosts = true;
        this.statusMessage = 'Fetching posts...';
        try {
            const posts = await this.linkedinService.getPosts();
            console.log('[DEBUG] POSTS RECEIVED:', JSON.stringify(posts));
            this.posts = posts;
            this.isFetchingPosts = false;
            this.statusMessage = `Fetched ${posts.length} posts.`;
            this.clearMessageAfterDelay();
        } catch (err) {
            this.isFetchingPosts = false;
            console.error('Error fetching posts:', err);
            this.statusMessage =
                (err instanceof Error && err.message) || 'Error fetching posts.';
        } finally {
            this.cdr.detectChanges();
        }
    }

    async transferPost(post: LinkedInPost): Promise<void> {
        if (this.transferringPostId) return;

        this.transferringPostId = post.id;
        this.statusMessage = `Transferring post...`;
        try {
            const res = await this.linkedinService.transferPost(post);
            this.transferringPostId = null;
            this.statusMessage = `Transferred as draft ${res.id}`;
            this.posts = this.posts.filter(p => p.id !== post.id);
            this.clearMessageAfterDelay();
        } catch (err) {
            this.transferringPostId = null;
            console.error('Error transferring post:', err);
            this.statusMessage = 'Error transferring post.';
        } finally {
            this.cdr.detectChanges();
        }
    }

    onPostsFileSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            this.selectedPostsFile = input.files[0];
        }
    }

    async uploadPostsJson(): Promise<void> {
        if (!this.selectedPostsFile || this.isUploadingPostsJson) return;

        this.isUploadingPostsJson = true;
        this.statusMessage = 'Uploading posts JSON...';
        try {
            const res = await this.linkedinService.importPostsJson(this.selectedPostsFile);
            this.statusMessage =
                `Imported ${res.count} posts: ${res.created} created, ` +
                `${res.updated} updated, ${res.skipped} skipped (drafts).`;
            this.selectedPostsFile = null;
            this.clearMessageAfterDelay();
        } catch (err) {
            this.statusMessage =
                (err instanceof Error && err.message) || 'Error uploading posts JSON.';
        } finally {
            this.isUploadingPostsJson = false;
            this.cdr.detectChanges();
        }
    }

    clearMessageAfterDelay() {
        setTimeout(() => {
            this.statusMessage = '';
            // Zoneless admin app (#276): without this the status bar stays on
            // screen forever even though statusMessage is already ''.
            this.cdr.detectChanges();
        }, 5000);
    }

    truncateText(text: string, length: number = 150): string {
        if (!text) return '';
        if (text.length <= length) return text;
        return text.substring(0, length) + '...';
    }
}
