import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BlogService } from '@beaconfolio/shared';
import { BlogPost } from '@beaconfolio/shared';
import { ServerTableHelper } from '../../../utils/table-helper-server';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-post-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './post-list.component.html',
  styleUrls: ['./post-list.component.css'],
})
export class PostListComponent implements OnInit, OnDestroy {
  private blogService = inject(BlogService);
  private cdr = inject(ChangeDetectorRef);

  table = new ServerTableHelper<BlogPost>('created_at', 'desc', 10);
  loading = true;
  error: string | null = null;
  deletingIds = new Set<number>();

  private subscription?: Subscription;

  ngOnInit() {
    // Subscribe to parameter changes
    this.subscription = this.table.params$.subscribe(() => {
      this.loadPosts();
    });
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
  }

  loadPosts(): void {
    this.loading = true;
    this.error = null;

    const params = this.table.getParams();

    this.blogService.getPosts(
      false, // published_only
      null, // lang
      null, // tag
      params.page,
      params.pageSize,
      params.sortBy || 'created_at',
      params.sortOrder,
      params.search
    ).subscribe({
      next: (response) => {
        this.table.setData(response);
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading posts:', err);
        this.error = 'Failed to load posts';
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }

  deletePost(post: BlogPost): void {
    if (!confirm(`Are you sure you want to delete "${post.title}"?`)) {
      return;
    }

    this.deletingIds.add(post.id);
    this.blogService.deletePostById(post.id).subscribe({
      next: () => {
        // Refresh grid after deletion
        this.loadPosts();

        this.deletingIds.delete(post.id);
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Failed to delete post:', error);
        alert('Failed to delete post. Please try again.');
        this.deletingIds.delete(post.id);
        this.cdr.detectChanges();
      },
    });
  }
}
