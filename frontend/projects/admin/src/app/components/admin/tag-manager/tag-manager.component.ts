import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { TagsService, TagStat } from '../../../services/tags.service';
import { ServerTableHelper } from '../../../utils/table-helper-server';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-tag-manager',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './tag-manager.component.html',
  styleUrls: ['./tag-manager.component.css']
})
export class TagManagerComponent implements OnInit, OnDestroy {
  private tagsService = inject(TagsService);
  private cdr = inject(ChangeDetectorRef);

  table = new ServerTableHelper<TagStat>('count', 'desc', 10);
  loading = false;
  error: string | null = null;

  editingTag: string | null = null;
  newTagName = '';

  private subscription?: Subscription;

  ngOnInit() {
    this.subscription = this.table.params$.subscribe(() => {
      this.loadTags();
    });
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
  }

  loadTags() {
    this.loading = true;
    this.error = null;

    const params = this.table.getParams();

    this.tagsService.getAllTags(
      params.page,
      params.pageSize,
      params.sortBy || 'count',
      params.sortOrder,
      params.search
    ).subscribe({
      next: (response) => {
        this.table.setData(response);
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading tags:', err);
        this.error = 'Failed to load tags';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  startEdit(tagName: string) {
    this.editingTag = tagName;
    this.newTagName = tagName;
  }

  cancelEdit() {
    this.editingTag = null;
    this.newTagName = '';
  }

  saveRename(oldName: string) {
    if (!this.newTagName || this.newTagName === oldName) {
      this.cancelEdit();
      return;
    }

    this.tagsService.renameTag(oldName, this.newTagName).subscribe({
      next: () => {
        this.cancelEdit();
        this.loadTags();
      },
      error: (err) => {
        console.error('Error renaming tag:', err);
        alert('Failed to rename tag');
      }
    });
  }

  deleteTag(tagName: string) {
    if (!confirm(`Delete tag "${tagName}"?`)) {
      return;
    }

    this.tagsService.deleteTag(tagName).subscribe({
      next: () => {
        this.loadTags();
      },
      error: (err) => {
        console.error('Error deleting tag:', err);
        alert('Failed to delete tag');
      }
    });
  }
}
