import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { BlogService } from '@beaconfolio/shared';

interface PostData {
  title: string;
  slug: string;
  content: string;
  summary: string;
  image_url: string;
  language: string;
  published: boolean;
  tags: string[];
}

@Component({
  selector: 'app-post-editor',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './post-editor.component.html',
  styleUrls: ['./post-editor.component.css'],
})
export class PostEditorComponent implements OnInit {
  private blogService = inject(BlogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);

  post: PostData = {
    title: '',
    slug: '',
    content: '',
    summary: '',
    image_url: '',
    language: 'en',
    published: false,
    tags: [],
  };
  private originalPost: PostData | null = null;

  isEditMode = false;
  currentId: number | null = null;
  saving = false;
  loading = false;
  deleting = false;
  generatingTags = false;
  errorMessage = '';
  newTag = '';

  suggestingTitle = false;
  suggestingSlug = false;
  suggestingSummary = false;
  suggestingAll = false;

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam && idParam !== 'new') {
      const id = +idParam;
      if (!isNaN(id)) {
        this.isEditMode = true;
        this.currentId = id;
        this.loading = true;
        this.loadPost(id);
      }
    }
  }

  private loadPost(id: number): void {
    this.blogService.getPostById(id).subscribe({
      next: (post) => {
        if (post) {
          this.post = {
            title: post.title,
            slug: post.slug,
            content: post.content,
            summary: post.summary || '',
            image_url: post.image_url || '',
            language: post.language,
            published: post.published,
            tags: [...(post.tags || [])],
          };
          this.originalPost = JSON.parse(JSON.stringify(this.post));
        }
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.errorMessage = 'Failed to load post';
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }

  isChanged(field: keyof PostData): boolean {
    if (!this.isEditMode || !this.originalPost) return false;
    if (field === 'tags') {
      return JSON.stringify(this.post.tags) !== JSON.stringify(this.originalPost.tags);
    }
    return this.post[field] !== this.originalPost[field];
  }

  onTitleChange(): void {
    if (!this.isEditMode) {
      // Auto-generate slug from title
      this.post.slug = this.post.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }
  }

  addTag(): void {
    if (!this.newTag) return;
    const tag = this.newTag.trim();
    if (!tag) return;

    if (this.post.tags.length >= 5) {
      alert('Max 5 tags allowed');
      return;
    }

    if (!this.post.tags.includes(tag)) {
      this.post.tags.push(tag);
    }
    this.newTag = '';
  }

  removeTag(tag: string): void {
    this.post.tags = this.post.tags.filter((t) => t !== tag);
  }

  suggestTags(): void {
    if (!this.post.title || !this.post.content) {
      alert('Please fill in title and content first.');
      return;
    }

    this.generatingTags = true;
    this.blogService.suggestTags(this.post.title, this.post.content).subscribe({
      next: (response) => {
        this.generatingTags = false;
        if (response.tags && response.tags.length > 0) {
          const remainingSlots = 5 - this.post.tags.length;
          if (remainingSlots > 0) {
            const newTags = response.tags
              .filter((t) => !this.post.tags.includes(t))
              .slice(0, remainingSlots);
            this.post.tags = [...this.post.tags, ...newTags];
          } else {
            alert('Tag limit (5) reached. No new tags added.');
          }
        } else {
          alert('No tags suggested.');
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.generatingTags = false;
        console.error('Error suggesting tags:', err);
        alert('Failed to suggest tags. Ensure AI service is available.');
        this.cdr.detectChanges();
      },
    });
  }

  suggestTitle(): void {
    if (!this.post.content) {
      alert('Please provide content first.');
      return;
    }
    this.suggestingTitle = true;
    this.blogService.suggestPostDetails(this.post.content, 'title').subscribe({
      next: (res) => {
        if (res.title) this.post.title = res.title;
        this.suggestingTitle = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.suggestingTitle = false;
        this.cdr.detectChanges();
      },
    });
  }

  suggestSlug(): void {
    if (!this.post.content) {
      alert('Please provide content first.');
      return;
    }
    this.suggestingSlug = true;
    this.blogService.suggestPostDetails(this.post.content, 'slug').subscribe({
      next: (res) => {
        if (res.slug) this.post.slug = res.slug;
        this.suggestingSlug = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.suggestingSlug = false;
        this.cdr.detectChanges();
      },
    });
  }

  suggestSummary(): void {
    if (!this.post.content) {
      alert('Please provide content first.');
      return;
    }
    this.suggestingSummary = true;
    this.blogService.suggestPostDetails(this.post.content, 'summary').subscribe({
      next: (res) => {
        if (res.summary) this.post.summary = res.summary;
        this.suggestingSummary = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.suggestingSummary = false;
        this.cdr.detectChanges();
      },
    });
  }

  suggestAll(): void {
    if (!this.post.content) {
      alert('Please provide content first.');
      return;
    }
    this.suggestingAll = true;
    this.blogService.suggestPostDetails(this.post.content, 'all').subscribe({
      next: (res) => {
        if (res.title) this.post.title = res.title;
        if (res.slug) this.post.slug = res.slug;
        if (res.summary) this.post.summary = res.summary;
        if (res.tags && Array.isArray(res.tags)) {
          const remainingSlots = 5 - this.post.tags.length;
          if (remainingSlots > 0) {
            const newTags = res.tags
              .filter((t: string) => !this.post.tags.includes(t))
              .slice(0, remainingSlots);
            this.post.tags = [...this.post.tags, ...newTags];
          }
        }
        this.suggestingAll = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.suggestingAll = false;
        this.cdr.detectChanges();
      },
    });
  }

  togglePublish(): void {
    this.post.published = !this.post.published;
    this.onSubmit(); // Save immediately
  }

  selectedFile: File | null = null;
  imagePreview: string | null = null;

  // ... (existing properties)

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.selectedFile = file;

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.imagePreview = e.target?.result as string;
        this.cdr.detectChanges();
      };
      reader.readAsDataURL(file);

      // Clear external URL if file is selected (optional logic)
      // this.post.image_url = ''; 
    }
  }

  onSubmit(): void {
    this.saving = true;
    this.errorMessage = '';

    const request =
      this.isEditMode && this.currentId
        ? this.blogService.updatePostById(this.currentId, this.post)
        : this.blogService.createPost(this.post);

    request.subscribe({
      next: (savedPost) => {
        // If file selected, upload it now
        if (this.selectedFile && savedPost.id) {
          this.blogService.uploadImage(savedPost.id, this.selectedFile).subscribe({
            next: () => {
              this.router.navigate(['/posts']);
            },
            error: (err) => {
              console.error('Image upload failed', err);
              // Navigate anyway, but maybe show warning?
              this.router.navigate(['/posts']);
            }
          });
        } else {
          this.router.navigate(['/posts']);
        }
      },
      error: (error) => {
        this.saving = false;
        // Revert published state on error if it was a toggle action
        // (Simplification: in real app manage cleaner state or separate save vs publish)
        this.errorMessage = error.error?.detail || 'Failed to save post';
        console.error('Save error:', error);
        // Zoneless admin app (#276): without this the editor stays stuck on
        // "Saving…" and the error banner never appears.
        this.cdr.detectChanges();
      },
    });
  }

  cancel(): void {
    this.router.navigate(['/posts']);
  }

  deletePost(): void {
    if (!this.currentId || !confirm('Are you sure you want to delete this post?')) {
      return;
    }

    this.deleting = true;
    this.errorMessage = '';
    this.cdr.detectChanges();

    this.blogService.deletePostById(this.currentId).subscribe({
      next: () => {
        this.router.navigate(['/posts']);
      },
      error: (error) => {
        this.deleting = false;
        this.errorMessage = 'Failed to delete post';
        console.error('Delete error:', error);
        this.cdr.detectChanges();
      },
    });
  }
}
