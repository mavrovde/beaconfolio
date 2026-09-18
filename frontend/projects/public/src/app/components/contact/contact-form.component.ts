import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';

import {
    AbstractControl,
    FormBuilder,
    FormGroup,
    ReactiveFormsModule,
    ValidationErrors,
    Validators,
} from '@angular/forms';
import { ShellChromeService, TranslatePipe } from '@beaconfolio/shared';
import { InteractionService } from '../../services/interaction.service';

/**
 * Public contact/inquiry form (#69): submissions land in the admin inbox as
 * `source=contact_form` interactions — the recruiter's message is provably
 * received and tracked, not dropped into a mailto: void.
 */
/** minLength on the TRIMMED value — the server rejects whitespace-only input
 *  (interactions.py normalizers), so the form must agree instead of submitting
 *  something that can only come back as a generic 422 (#69 review round 2). */
function trimmedMinLength(min: number) {
    return (control: AbstractControl): ValidationErrors | null => {
        const value = String(control.value ?? '').trim();
        return value.length >= min ? null : { trimmedMinLength: { requiredLength: min } };
    };
}

@Component({
    selector: 'app-contact-form',
    standalone: true,
    imports: [AsyncPipe, ReactiveFormsModule, TranslatePipe],
    templateUrl: './contact-form.component.html',
})
export class ContactFormComponent {
    private fb = inject(FormBuilder);
    private interactionService = inject(InteractionService);
    private cdr = inject(ChangeDetectorRef);

    // Shell chrome, from config (#67). The literals these replace were
    // `user@portfolio…` — a hostname no deployment but the original owned, in a
    // template no forker should have to edit. FIELDS, not template calls: each
    // accessor returns a fresh observable, so calling one from the template
    // would re-subscribe on every change-detection pass.
    readonly prompt$ = inject(ShellChromeService).prompt();

    contactForm: FormGroup;
    isLoading = false;
    successMessage: string | null = null;
    errorMessage: string | null = null;

    constructor() {
        this.contactForm = this.fb.group({
            name: ['', [Validators.required, trimmedMinLength(2), Validators.maxLength(200)]],
            email: ['', [Validators.required, Validators.email]],
            company: ['', [Validators.maxLength(200)]],
            message: ['', [Validators.required, trimmedMinLength(5), Validators.maxLength(10000)]],
        });
    }

    onSubmit() {
        if (this.contactForm.invalid || this.isLoading) {
            return;
        }
        this.isLoading = true;
        this.successMessage = null;
        this.errorMessage = null;

        // The invalid-guard above guarantees the required controls are non-null.
        // Mirror the backend normalization (interactions.py): trimmed fields,
        // empty optional company sent as null.
        const raw = this.contactForm.value as {
            name: string;
            email: string;
            company: string | null;
            message: string;
        };
        const payload = {
            name: raw.name.trim(),
            email: raw.email.trim(),
            company: raw.company?.trim() || null,
            message: raw.message.trim(),
        };
        this.interactionService.submitContact(payload).subscribe({
            next: () => {
                this.isLoading = false;
                this.successMessage = 'CONTACT.SUCCESS';
                this.contactForm.reset();
                // Zoneless: async callback mutates template-read props (#105).
                this.cdr.markForCheck();
            },
            error: () => {
                this.isLoading = false;
                this.errorMessage = 'CONTACT.ERROR';
                // Zoneless: repaint after mutating isLoading/errorMessage (#105).
                this.cdr.markForCheck();
            },
        });
    }
}
