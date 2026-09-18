/**
 * Zoneless repaint regression pins (#276) — see the header of
 * admin-layout.component.zoneless.spec.ts for why this TestBed opts into
 * `provideZonelessChangeDetection()` instead of relying on the zone.js that
 * src/test-setup.ts loads.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, of } from 'rxjs';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ProfileComponent } from './profile';
import { AuthService } from '../../../services/auth.service';
import { TranslatePipe } from '@beaconfolio/shared';
import { provideTestBrand } from '@beaconfolio/shared/testing';

describe('ProfileComponent (zoneless repaint)', () => {
  let fixture: ComponentFixture<ProfileComponent>;
  let component: ProfileComponent;
  let host: HTMLElement;
  let currentUser$: BehaviorSubject<any>;
  let authServiceSpy: any;

  beforeEach(async () => {
    currentUser$ = new BehaviorSubject<any>({
      username: 'admin',
      is_admin: true,
      has_gemini_key: false,
    });
    authServiceSpy = {
      changePassword: vi.fn(),
      updateGeminiKey: vi.fn(),
      currentUser$: currentUser$.asObservable(),
    };

    await TestBed.configureTestingModule({
      imports: [ProfileComponent, FormsModule, TranslatePipe],
      providers: [
        ...provideTestBrand(),
        provideZonelessChangeDetection(),
        { provide: AuthService, useValue: authServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // MEASURED EQUIVALENCE, not a mutation-proven pin — stated plainly rather
  // than dressed up as a regression test. Two notify paths currently feed this
  // badge: the `cdr.markForCheck()` in profile.ts's ngOnInit subscription, and
  // the `currentUser$ | async` in profile.html (an async pipe markForCheck()s
  // on every emission). Removing EITHER one alone leaves this test green —
  // verified by running it with each removed in turn. It fails only when both
  // are gone, which is exactly the user-visible contract worth pinning: the
  // badge must track the stream, by whichever mechanism.
  it('repaints the key-status badge when the user stream emits after first render', async () => {
    await fixture.whenStable();
    expect(host.textContent).toContain('Not configured');

    currentUser$.next({ username: 'admin', is_admin: true, has_gemini_key: true });
    await fixture.whenStable();

    expect(host.textContent).toContain('Key configured');
  });

  it('repaints away the success banner when the 3s auto-clear timer fires', () => {
    authServiceSpy.updateGeminiKey.mockReturnValue(
      of({ username: 'admin', is_admin: true, has_gemini_key: true }),
    );
    fixture.detectChanges();

    // Fake timers are installed only around the auto-clear window, so the
    // initial render above still uses the real scheduler.
    vi.useFakeTimers();
    component.geminiApiKey = 'secret';
    component.onSaveKey();
    expect(host.querySelector('.success-message')).not.toBeNull();

    vi.advanceTimersByTime(3000);
    // Deliberately NO detectChanges() here: the component itself must repaint.
    expect(component.message).toBe('');
    expect(host.querySelector('.success-message')).toBeNull();
  });
});
