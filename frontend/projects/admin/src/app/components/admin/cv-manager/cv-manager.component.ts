import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { TranslatePipe } from '@beaconfolio/shared';
import { AdminCvService, CvRequestSummary, CvVersion } from '../../../services/admin-cv.service';
import { ServerTableHelper } from '../../../utils/table-helper-server';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-cv-manager',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, TranslatePipe],
  templateUrl: './cv-manager.component.html',
  styleUrls: ['./cv-manager.component.css']
})
export class CvManagerComponent implements OnInit, OnDestroy {
  private cvService = inject(AdminCvService);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);

  requestsTable = new ServerTableHelper<CvRequestSummary>('created_at', 'desc', 10);
  versionsTable = new ServerTableHelper<CvVersion>('created_at', 'desc', 10);

  activeTab: 'requests' | 'versions' = 'requests';
  uploadForm: FormGroup;
  selectedFile: File | null = null;
  uploading = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;
  loading = false;

  private requestsSub?: Subscription;
  private versionsSub?: Subscription;

  constructor() {
    this.uploadForm = this.fb.group({
      version: ['', Validators.required],
      // Checked = becomes the public default (historical behavior). Unchecked
      // = a tailored VARIANT for the pipeline; the public download is
      // untouched (#247 criterion 4).
      activate: [true]
    });
  }

  ngOnInit() {
    // Subscribe to requests table params
    this.requestsSub = this.requestsTable.params$.subscribe(() => {
      this.loadRequests();
    });

    // Subscribe to versions table params
    this.versionsSub = this.versionsTable.params$.subscribe(() => {
      this.loadVersions();
    });
  }

  ngOnDestroy() {
    this.requestsSub?.unsubscribe();
    this.versionsSub?.unsubscribe();
  }

  loadRequests() {
    this.loading = true;
    const params = this.requestsTable.getParams();

    this.cvService.getRequests(
      params.page,
      params.pageSize,
      params.sortBy || 'created_at',
      params.sortOrder,
      params.search
    ).subscribe({
      next: (response) => {
        this.requestsTable.setData(response);
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading requests:', err);
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadVersions() {
    this.loading = true;
    const params = this.versionsTable.getParams();

    this.cvService.getVersions(
      params.page,
      params.pageSize,
      params.sortBy || 'created_at',
      params.sortOrder,
      params.search
    ).subscribe({
      next: (response) => {
        this.versionsTable.setData(response);
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading versions:', err);
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
    }
  }

  onUpload() {
    if (!this.uploadForm.valid || !this.selectedFile) {
      return;
    }

    this.uploading = true;
    this.errorMessage = null;
    this.successMessage = null;

    const version = this.uploadForm.value.version;
    const activate = this.uploadForm.value.activate ?? true;
    this.cvService.uploadCv(this.selectedFile, version, activate).subscribe({
      next: () => {
        this.successMessage = 'ADMIN.CV_UPLOAD_COMPLETE';
        this.uploading = false;
        this.uploadForm.reset({ activate: true });
        this.selectedFile = null;
        this.loadVersions(); // Refresh versions list
        this.cdr.detectChanges();
      },
      error: () => {
        this.errorMessage = 'Upload failed. Please try again.';
        this.uploading = false;
        this.cdr.detectChanges();
      }
    });
  }
}
