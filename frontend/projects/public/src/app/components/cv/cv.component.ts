import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CvService } from '../../services/cv.service';
import { HeaderComponent } from '../header/header.component';
import { TranslatePipe } from '@beaconfolio/shared';
import { SeoService } from '../../services/seo.service';

@Component({
    selector: 'app-cv',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, TranslatePipe, HeaderComponent],
    templateUrl: './cv.component.html',
    styleUrl: './cv.component.css'
})
export class CvComponent implements OnInit {
    cvForm: FormGroup;
    isLoading = false;
    successMessage: string | null = null;
    errorMessage: string | null = null;

    constructor(
        private fb: FormBuilder,
        private cvService: CvService,
        private seoService: SeoService,
        private cdr: ChangeDetectorRef
    ) {
        this.cvForm = this.fb.group({
            name: ['', [Validators.required, Validators.minLength(2)]],
            email: ['', [Validators.required, Validators.email]],
            company: [''],
            message: ['', [Validators.required, Validators.minLength(5)]],
            position_description: ['', [Validators.maxLength(1000)]],
            subscribe_to_updates: [false]
        });
    }

    ngOnInit() {
        this.seoService.updateSeo({
            title: 'Request CV',
            description: 'Request a full PDF copy of the professional CV and resume.',
            url: '/cv',
            keywords: 'CV, Resume, Professional Background'
        });
    }

    onSubmit() {
        if (this.cvForm.invalid) {
            return;
        }

        this.isLoading = true;
        this.successMessage = null;
        this.errorMessage = null;

        this.cvService.requestCv(this.cvForm.value).subscribe({
            next: (response) => {
                this.isLoading = false;
                if (response.success) {
                    this.successMessage = response.message;
                    // Open download link in new tab
                    const fullUrl = this.cvService.getDownloadUrl(response.download_url);
                    // `noopener` severs `window.opener`, so the opened page cannot
                    // navigate THIS one (reverse tabnabbing). Note this is NOT what
                    // Snyk `javascript/OR` reports — that is an OPEN REDIRECT, and
                    // it is fixed at its source in `cv.service.getDownloadUrl`,
                    // which now reduces any absolute URL to a path on our origin.
                    // Keeping `noopener` anyway: it is correct hygiene for any
                    // `window.open`, and cheap.
                    window.open(fullUrl, '_blank', 'noopener');
                    this.cvForm.reset();
                }
                // Zoneless: this async callback mutates plain props read by the
                // template (isLoading/successMessage) — trigger CD explicitly (#105).
                this.cdr.markForCheck();
            },
            error: (error) => {
                this.isLoading = false;
                if (error.status === 404) {
                    this.errorMessage = 'CV.ERROR_UNAVAILABLE';
                } else {
                    this.errorMessage = 'CV.ERROR_SUBMIT';
                }
                console.error('CV Request Error:', error);
                // Zoneless: repaint after mutating isLoading/errorMessage (#105).
                this.cdr.markForCheck();
            }
        });
    }
}
