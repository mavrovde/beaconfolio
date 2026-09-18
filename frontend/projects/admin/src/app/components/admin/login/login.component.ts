import { HttpErrorResponse } from '@angular/common/http';
import { Component, ChangeDetectorRef, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AsyncPipe } from '@angular/common';
import { ShellChromeService } from '@beaconfolio/shared';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [AsyncPipe, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);

  // The panel title (#67). It was `admin@beaconfolio.com:~$ ./login.sh` — a
  // literal domain belonging to whoever the fork came from, on the FIRST
  // screen a forker sees. Under a preset with no shell chrome it renders the
  // configured site name instead, because an empty title bar above a login
  // form reads as a broken page.
  readonly title$ = inject(ShellChromeService).commandLine('./login.sh', { user: 'admin' });

  username = '';
  password = '';
  loading = false;
  errorMessage = '';

  onSubmit(): void {
    if (!this.username || !this.password) {
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    this.authService
      .login(this.username, this.password)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: () => {
          console.log('Login successful, navigating...');
          const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard';
          console.log('Navigating to:', returnUrl);
          this.router.navigate([returnUrl]);
        },
        error: (error: HttpErrorResponse) => {
          console.error('Login error in component:', error);
          if (error.status === 401) {
            this.errorMessage = 'Incorrect username or password.';
          } else if (error.status === 0) {
            this.errorMessage =
              'Unable to connect to the server. Please check your internet connection.';
          } else {
            this.errorMessage =
              error.error?.detail || 'An unexpected error occurred. Please try again.';
          }
          this.loading = false;
          this.cdr.detectChanges();
        },
      });
  }
}
