import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { ContactFormComponent } from './contact-form.component';
import { InteractionService } from '../../services/interaction.service';
import { TranslatePipe } from '@beaconfolio/shared';
import { MockTranslatePipe } from '@beaconfolio/shared/testing';
import { provideTestBrand } from '@beaconfolio/shared/testing';

describe('ContactFormComponent', () => {
    let fixture: ComponentFixture<ContactFormComponent>;
    let component: ContactFormComponent;
    let serviceSpy: { submitContact: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        serviceSpy = { submitContact: vi.fn() };
        await TestBed.configureTestingModule({
            imports: [ContactFormComponent],
            providers: [...provideTestBrand(), { provide: InteractionService, useValue: serviceSpy }],
        })
            .overrideComponent(ContactFormComponent, {
                remove: { imports: [TranslatePipe] },
                add: { imports: [MockTranslatePipe] },
            })
            .compileComponents();

        fixture = TestBed.createComponent(ContactFormComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    function fillValid() {
        component.contactForm.setValue({
            name: 'Rita Recruiter',
            email: 'rita@agency.example',
            company: 'Agency',
            message: 'Interesting role for you',
        });
    }

    it('creates with an invalid empty form', () => {
        expect(component.contactForm.invalid).toBe(true);
    });

    it('does not submit while invalid', () => {
        component.onSubmit();
        expect(serviceSpy.submitContact).not.toHaveBeenCalled();
    });

    it('does not double-submit while loading', () => {
        fillValid();
        component.isLoading = true;
        component.onSubmit();
        expect(serviceSpy.submitContact).not.toHaveBeenCalled();
    });

    it('submits, shows success, and resets the form', () => {
        serviceSpy.submitContact.mockReturnValue(of({ id: 'x', status: 'new' }));
        fillValid();
        component.onSubmit();

        expect(serviceSpy.submitContact).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Rita Recruiter' })
        );
        expect(component.isLoading).toBe(false);
        expect(component.successMessage).toBe('CONTACT.SUCCESS');
        expect(component.errorMessage).toBeNull();
        expect(component.contactForm.get('name')?.value).toBeNull();
    });

    it('trims fields and sends empty company as null (mirrors the backend contract)', () => {
        serviceSpy.submitContact.mockReturnValue(of({ id: 'x', status: 'new' }));
        component.contactForm.setValue({
            name: '  Rita Recruiter  ',
            email: 'rita@agency.example',
            company: '   ',
            message: '  We have a role.  ',
        });
        component.onSubmit();

        expect(serviceSpy.submitContact).toHaveBeenCalledWith({
            name: 'Rita Recruiter',
            email: 'rita@agency.example',
            company: null,
            message: 'We have a role.',
        });
    });

    it('sends a never-touched (null) company as null', () => {
        serviceSpy.submitContact.mockReturnValue(of({ id: 'x', status: 'new' }));
        component.contactForm.setValue({
            name: 'Rita Recruiter',
            email: 'rita@agency.example',
            company: null,
            message: 'We have a role.',
        });
        component.onSubmit();

        expect(serviceSpy.submitContact).toHaveBeenCalledWith(
            expect.objectContaining({ company: null })
        );
    });

    it('rejects whitespace-only name/message client-side (mirrors the 422 the server would send)', () => {
        component.contactForm.setValue({
            name: '   ',
            email: 'rita@agency.example',
            company: null,
            message: '  \n  ',
        });
        expect(component.contactForm.invalid).toBe(true);
        component.onSubmit();
        expect(serviceSpy.submitContact).not.toHaveBeenCalled();
    });

    it('shows the error message on failure and keeps the form values', () => {
        serviceSpy.submitContact.mockReturnValue(throwError(() => ({ status: 500 })));
        fillValid();
        component.onSubmit();

        expect(component.isLoading).toBe(false);
        expect(component.errorMessage).toBe('CONTACT.ERROR');
        expect(component.successMessage).toBeNull();
        expect(component.contactForm.get('name')?.value).toBe('Rita Recruiter');
    });

    it('validates field constraints', () => {
        component.contactForm.setValue({
            name: 'x',
            email: 'not-an-email',
            company: '',
            message: 'hey',
        });
        expect(component.contactForm.get('name')?.invalid).toBe(true);
        expect(component.contactForm.get('email')?.invalid).toBe(true);
        expect(component.contactForm.get('message')?.invalid).toBe(true);
    });
});
