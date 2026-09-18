import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProfileComponent } from './profile';
import { AuthService } from '../../../services/auth.service';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { MockTranslatePipe } from '@beaconfolio/shared/testing';
import { TranslatePipe } from '@beaconfolio/shared';
import { provideTestBrand } from '@beaconfolio/shared/testing';

describe('ProfileComponent early-return branch', () => {
  let component: ProfileComponent;
  let fixture: ComponentFixture<ProfileComponent>;
  let authServiceMock: any;

  beforeEach(async () => {
    authServiceMock = {
      changePassword: vi.fn().mockReturnValue(of(void 0)),
      currentUser$: new BehaviorSubject({ id: 1, username: 'a', email: 'a@t.com', is_admin: true }).asObservable(),
    };
    await TestBed.configureTestingModule({
      imports: [ProfileComponent, MockTranslatePipe],
      providers: [...provideTestBrand(), provideZonelessChangeDetection(), { provide: AuthService, useValue: authServiceMock }],
    })
      .overrideComponent(ProfileComponent, {
        remove: { imports: [TranslatePipe] },
        add: { imports: [MockTranslatePipe] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('returns early and does not call changePassword when fields are empty (line 30)', () => {
    component.oldPassword = '';
    component.newPassword = '';
    component.onSubmit();
    expect(authServiceMock.changePassword).not.toHaveBeenCalled();
    expect(component.loading).toBe(false);
  });

  it('returns early when only new password is missing', () => {
    component.oldPassword = 'x';
    component.newPassword = '';
    component.onSubmit();
    expect(authServiceMock.changePassword).not.toHaveBeenCalled();
  });

  it('does not clear message in the 5s timeout if it already changed (line 52 false branch)', () => {
    vi.useFakeTimers();
    component.oldPassword = 'old';
    component.newPassword = 'new';
    component.onSubmit();
    expect(component.message).toBe('ADMIN.PASSWORD_CHANGED_SUCCESS');
    // Simulate the message being changed by something else before the timeout fires
    component.message = 'SOMETHING_ELSE';
    vi.advanceTimersByTime(5000);
    expect(component.message).toBe('SOMETHING_ELSE');
    vi.useRealTimers();
  });

  it('falls back to default error message when err.error.detail is missing', () => {
    component.oldPassword = 'x';
    component.newPassword = 'y';
    authServiceMock.changePassword.mockReturnValue(throwError(() => ({ status: 500 })));
    component.onSubmit();
    expect(component.error).toBe('ADMIN.PASSWORD_CHANGE_FAILED');
  });
});
