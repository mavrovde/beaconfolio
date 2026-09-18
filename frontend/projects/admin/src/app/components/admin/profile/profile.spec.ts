import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfileComponent } from './profile';
import { AuthService } from '../../../services/auth.service';
import { TranslatePipe } from '@beaconfolio/shared';
import { FormsModule } from '@angular/forms';
import { of, throwError, BehaviorSubject } from 'rxjs';
import { ChangeDetectorRef } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { provideTestBrand } from '@beaconfolio/shared/testing';

describe('ProfileComponent', () => {
  let component: ProfileComponent;
  let fixture: ComponentFixture<ProfileComponent>;
  let authServiceSpy: any;
  const currentUserSubject = new BehaviorSubject<any>({
    username: 'admin',
    email: 'admin@beaconfolio.com',
    is_admin: true,
    has_gemini_key: true
  });

  beforeEach(async () => {
    authServiceSpy = {
      changePassword: vi.fn(),
      updateGeminiKey: vi.fn(),
      currentUser$: currentUserSubject.asObservable()
    };

    await TestBed.configureTestingModule({
      imports: [ProfileComponent, FormsModule, TranslatePipe],
      providers: [
        ...provideTestBrand(),
        { provide: AuthService, useValue: authServiceSpy },
        ChangeDetectorRef
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should reflect configured key status without reading the secret (#143)', () => {
    // The raw key is never sent to the browser; the input stays empty (write-only).
    expect(component.hasGeminiKey).toBe(true);
    expect(component.geminiApiKey).toBe('');
  });

  it('should handle null user from auth stream smoothly', () => {
    currentUserSubject.next(null);
    fixture.detectChanges();
    expect(component.hasGeminiKey).toBe(true); // Left unchanged when user is null.
    expect(component.geminiApiKey).toBe('');
  });

  it('should show "not configured" for a user without a key', () => {
    currentUserSubject.next({ username: 'test', is_admin: true, has_gemini_key: false });
    fixture.detectChanges();
    expect(component.hasGeminiKey).toBe(false);
    expect(component.geminiApiKey).toBe('');
  });

  it('should start with key hidden', () => {
    expect(component.showKey).toBe(false);
  });

  it('should toggle key visibility', () => {
    component.toggleKeyVisibility();
    expect(component.showKey).toBe(true);
    component.toggleKeyVisibility();
    expect(component.showKey).toBe(false);
  });

  it('should toggle new password visibility', () => {
    expect(component.showNewPassword).toBe(false);
    component.toggleNewPasswordVisibility();
    expect(component.showNewPassword).toBe(true);
    component.toggleNewPasswordVisibility();
    expect(component.showNewPassword).toBe(false);
  });

  it('should call updateGeminiKey when saving and clear message on timeout', () => {
    vi.useFakeTimers();
    const newKey = 'new-api-key';
    component.geminiApiKey = newKey;
    const mockUser = {
      username: 'admin',
      email: 'admin@beaconfolio.com',
      id: 1,
      is_admin: true,
      has_gemini_key: true
    };
    authServiceSpy.updateGeminiKey.mockReturnValue(of(mockUser));

    component.onSaveKey();

    expect(component.loading).toBe(false);
    expect(component.message).toBe('API Key saved successfully');
    expect(authServiceSpy.updateGeminiKey).toHaveBeenCalledWith(newKey);
    // The secret is cleared from the field and the status flips to configured.
    expect(component.geminiApiKey).toBe('');
    expect(component.hasGeminiKey).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(component.message).toBe('');
    vi.useRealTimers();
  });

  it('should handle save error', () => {
    authServiceSpy.updateGeminiKey.mockReturnValue(throwError(() => new Error('Error')));

    component.onSaveKey();

    expect(component.loading).toBe(false);
    expect(component.error).toBe('Failed to save API Key');
  });

  it('should not submit password change if fields are empty', () => {
    component.oldPassword = '';
    component.newPassword = '';
    component.onSubmit();
    expect(authServiceSpy.changePassword).not.toHaveBeenCalled();
  });

  it('should submit password change successfully', () => {
    vi.useFakeTimers();
    component.oldPassword = 'old';
    component.newPassword = 'new-strong-password';
    authServiceSpy.changePassword.mockReturnValue(of({}));

    component.onSubmit();

    expect(component.loading).toBe(false);
    expect(component.message).toBe('ADMIN.PASSWORD_CHANGED_SUCCESS');
    expect(component.oldPassword).toBe('');
    expect(component.newPassword).toBe('');
    expect(authServiceSpy.changePassword).toHaveBeenCalledWith('old', 'new-strong-password');

    // Test auto-clear message
    vi.advanceTimersByTime(5000);
    expect(component.message).toBe('');
    vi.useRealTimers();
  });

  it('should not clear message if it was changed by something else before timeout', () => {
    vi.useFakeTimers();
    component.oldPassword = 'old';
    component.newPassword = 'new-strong-password';
    authServiceSpy.changePassword.mockReturnValue(of({}));

    component.onSubmit();
    component.message = 'OTHER';

    vi.advanceTimersByTime(5000);
    expect(component.message).toBe('OTHER');
    vi.useRealTimers();
  });

  it('should handle password change error', () => {
    component.oldPassword = 'old';
    component.newPassword = 'new';
    const errorResponse = { error: { detail: 'Incorrect password' } };
    authServiceSpy.changePassword.mockReturnValue(throwError(() => errorResponse));

    component.onSubmit();

    expect(component.loading).toBe(false);
    expect(component.error).toBe('Incorrect password');
  });

  it('should handle generic password change error', () => {
    component.oldPassword = 'old';
    component.newPassword = 'new';
    authServiceSpy.changePassword.mockReturnValue(throwError(() => new Error('Network error')));

    component.onSubmit();

    expect(component.loading).toBe(false);
    expect(component.error).toBe('ADMIN.PASSWORD_CHANGE_FAILED');
  });

  it('should handle API key save error', () => {
    component.geminiApiKey = 'new-key';
    authServiceSpy.updateGeminiKey.mockReturnValue(throwError(() => new Error('Save failed')));

    component.onSaveKey();

    expect(component.error).toBe('Failed to save API Key');
    expect(component.loading).toBe(false);
  });
});
