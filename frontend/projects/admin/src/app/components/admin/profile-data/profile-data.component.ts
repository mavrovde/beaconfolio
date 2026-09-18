import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  FormsModule,
} from '@angular/forms';
import { TranslatePipe } from '@beaconfolio/shared';
import { Subscription } from 'rxjs';
import {
  AdminProfileService,
  ProfileSnapshot,
  ProfileLanguage,
} from '../../../services/admin-profile.service';
import { ServerTableHelper } from '../../../utils/table-helper-server';

/**
 * Admin page to upload the scraper's `profile_data.json` as a versioned,
 * per-language profile and to switch which version the public site serves.
 * Distinct from the `profile/` component (the admin's own account page).
 */
@Component({
  selector: 'app-profile-data',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, TranslatePipe],
  templateUrl: './profile-data.component.html',
  styleUrls: ['./profile-data.component.css'],
})
export class ProfileDataComponent implements OnInit, OnDestroy {
  private profileService = inject(AdminProfileService);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);

  versionsTable = new ServerTableHelper<ProfileSnapshot>('created_at', 'desc', 10);

  uploadForm: FormGroup;
  selectedLanguage: ProfileLanguage = 'en';
  languageFilter: ProfileLanguage | null = null;

  selectedFile: File | null = null;
  uploading = false;
  loading = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;

  private versionsSub?: Subscription;

  constructor() {
    this.uploadForm = this.fb.group({
      version: ['', Validators.required],
    });
  }

  ngOnInit(): void {
    this.versionsSub = this.versionsTable.params$.subscribe(() => this.loadVersions());
  }

  ngOnDestroy(): void {
    this.versionsSub?.unsubscribe();
  }

  loadVersions(): void {
    this.loading = true;
    const params = this.versionsTable.getParams();
    this.profileService
      .getVersions(
        params.page,
        params.pageSize,
        params.sortBy || 'created_at',
        params.sortOrder,
        this.languageFilter,
      )
      .subscribe({
        next: (response) => {
          this.versionsTable.setData(response);
          this.loading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          this.loading = false;
          this.errorMessage = 'ADMIN.PROFILE_DATA_LOAD_FAILED';
          this.cdr.detectChanges();
        },
      });
  }

  setLanguageFilter(language: ProfileLanguage | null): void {
    this.languageFilter = language;
    this.loadVersions();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
    }
  }

  onUpload(): void {
    if (!this.uploadForm.valid || !this.selectedFile) {
      return;
    }
    this.uploading = true;
    this.errorMessage = null;
    this.successMessage = null;

    const version = this.uploadForm.value.version;
    this.profileService
      .uploadProfile(this.selectedFile, version, this.selectedLanguage)
      .subscribe({
        next: () => {
          this.successMessage = 'ADMIN.PROFILE_DATA_UPLOAD_COMPLETE';
          this.uploading = false;
          this.uploadForm.reset();
          this.selectedFile = null;
          this.loadVersions();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.errorMessage =
            err?.error?.detail || 'ADMIN.PROFILE_DATA_UPLOAD_FAILED';
          this.uploading = false;
          this.cdr.detectChanges();
        },
      });
  }

  onActivate(version: ProfileSnapshot): void {
    if (version.is_active) {
      return;
    }
    this.loading = true;
    this.errorMessage = null;
    this.successMessage = null;
    this.profileService.activateVersion(version.id).subscribe({
      next: () => {
        this.successMessage = 'ADMIN.PROFILE_DATA_ACTIVATE_COMPLETE';
        this.loadVersions();
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'ADMIN.PROFILE_DATA_ACTIVATE_FAILED';
        this.cdr.detectChanges();
      },
    });
  }
}
