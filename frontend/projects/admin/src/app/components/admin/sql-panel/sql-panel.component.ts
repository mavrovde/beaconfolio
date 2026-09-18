import { Component, inject, ChangeDetectorRef } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { TranslatePipe } from '@beaconfolio/shared';

/** One result row — arbitrary columns straight from the executed SQL. */
type SqlRow = Record<string, unknown>;

@Component({
  selector: 'app-sql-panel',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  templateUrl: './sql-panel.component.html',
  styles: []
})
export class SqlPanelComponent {
  query = '';
  result: SqlRow[] | null = null;
  columns: string[] = [];
  loading = false;
  error: string | null = null;
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private apiUrl = `${environment.apiPrefix}/admin/sql/execute`;

  executeQuery() {
    if (!this.query.trim()) return;

    this.loading = true;
    this.error = null;
    this.result = null;

    this.http.post<SqlRow[]>(this.apiUrl, { query: this.query }).subscribe({
      next: (data) => {
        this.result = data;
        if (data && data.length > 0) {
          this.columns = Object.keys(data[0]);
        } else {
          this.columns = [];
        }
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('SQL Error:', err);
        this.error = err.error?.detail || 'Execution failed';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  backup() {
    this.loading = true;
    this.error = null;
    this.result = null;

    this.http.get(`${environment.apiPrefix}/admin/sql/backup`, {
      responseType: 'blob',
      observe: 'response'
    }).subscribe({
      next: (response) => {
        const blob = new Blob([response.body!], { type: 'application/sql' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        // Extract filename from header or default
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'backup.sql';
        if (contentDisposition) {
          const matches = /filename="?([^"]*)"?/.exec(contentDisposition);
          if (matches && matches[1]) {
            filename = matches[1];
          }
        }

        const sizeKB = (blob.size / 1024).toFixed(1);
        link.download = filename;
        link.click();
        window.URL.revokeObjectURL(url);
        this.loading = false;
        this.result = [{ status: '✅ Backup downloaded', filename, size: `${sizeKB} KB` }];
        this.columns = ['status', 'filename', 'size'];
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Backup error:', err);
        // Try to read error detail from blob response
        /* v8 ignore start -- final 'Unknown error' fallback is unreachable: HttpErrorResponse always has a truthy message */
        const detail = err.error instanceof Blob
          ? 'Server error (check backend logs)'
          : (err.error?.detail || err.message || 'Unknown error');
        /* v8 ignore stop */
        this.error = `Backup failed: ${detail}`;
        this.result = [{ status: '❌ Backup failed', error: detail, http_status: err.status }];
        this.columns = ['status', 'error', 'http_status'];
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.restore(file);
    }
  }

  restore(file: File) {
    if (!confirm('WARNING: This will overwrite the current database. Are you sure?')) {
      return;
    }

    this.loading = true;
    this.error = null;
    this.result = null;

    const formData = new FormData();
    formData.append('file', file);

    this.http.post<{ message: string; output: string }>(`${environment.apiPrefix}/admin/sql/restore`, formData).subscribe({
      next: (data) => {
        this.result = [{ message: data.message, output: data.output }];
        this.columns = ['message', 'output'];
        this.loading = false;
        this.cdr.detectChanges();
        alert('Database restored successfully!');
      },
      error: (err) => {
        console.error('Restore error:', err);
        const detail = err.error?.detail || 'Restore failed';
        this.error = detail;
        this.result = [{ status: '❌ Restore failed', detail, http_status: err.status }];
        this.columns = ['status', 'detail', 'http_status'];
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }
}
