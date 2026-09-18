import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoginComponent } from './login.component';
import { AuthService } from '../../../services/auth.service';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { provideTestBrand } from '@beaconfolio/shared/testing';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authServiceSpy: { login: Mock };
  let routerSpy: { navigate: Mock };
  let routeMock: any;

  beforeEach(async () => {
    authServiceSpy = { login: vi.fn() };
    routerSpy = { navigate: vi.fn() };
    routeMock = {
      snapshot: {
        queryParams: {},
      },
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent, FormsModule],
      providers: [
        ...provideTestBrand(),
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: ActivatedRoute, useValue: routeMock },
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call login on submit with valid credentials', () => {
    component.username = 'admin';
    component.password = 'password';
    // Return observable that completes to test finalize
    authServiceSpy.login.mockReturnValue(
      of({ access_token: 'token', token_type: 'bearer', expires_in: 3600 }),
    );

    component.onSubmit();

    expect(authServiceSpy.login).toHaveBeenCalledWith('admin', 'password');
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
    expect(component.loading).toBe(false);
  });

  it('should navigate to returnUrl after login', () => {
    component.username = 'admin';
    component.password = 'password';
    routeMock.snapshot.queryParams['returnUrl'] = '/posts';
    authServiceSpy.login.mockReturnValue(
      of({ access_token: 'token', token_type: 'bearer', expires_in: 3600 }),
    );

    component.onSubmit();

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/posts']);
  });

  it('should handle login error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    component.username = 'admin';
    component.password = 'wrong';
    authServiceSpy.login.mockReturnValue(
      throwError(() => ({ status: 401, error: { detail: 'Invalid credentials' } })),
    );

    component.onSubmit();

    expect(component.loading).toBe(false);
    expect(component.errorMessage).toBe('Incorrect username or password.');
    expect(routerSpy.navigate).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('Login error in component:', expect.anything());
    consoleSpy.mockRestore();
  });

  it('should handle connection error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    component.username = 'admin';
    component.password = 'pass';
    authServiceSpy.login.mockReturnValue(throwError(() => ({ status: 0, error: {} })));

    component.onSubmit();

    expect(component.loading).toBe(false);
    expect(component.errorMessage).toBe(
      'Unable to connect to the server. Please check your internet connection.',
    );
    consoleSpy.mockRestore();
  });

  it('should handle generic error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    component.username = 'admin';
    component.password = 'pass';
    authServiceSpy.login.mockReturnValue(
      throwError(() => ({ status: 500, error: { detail: 'Server Error' } })),
    );

    component.onSubmit();

    expect(component.loading).toBe(false);
    expect(component.errorMessage).toBe('Server Error');
    consoleSpy.mockRestore();
  });

  it('should not submit if form is invalid', () => {
    component.username = '';
    component.password = '';
    component.onSubmit();
    expect(authServiceSpy.login).not.toHaveBeenCalled();
  });

  it('should use fallback message when error detail is missing', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    component.username = 'admin';
    component.password = 'pass';
    authServiceSpy.login.mockReturnValue(throwError(() => ({ status: 500, error: null })));

    component.onSubmit();

    expect(component.loading).toBe(false);
    expect(component.errorMessage).toBe('An unexpected error occurred. Please try again.');
    consoleSpy.mockRestore();
  });
});
