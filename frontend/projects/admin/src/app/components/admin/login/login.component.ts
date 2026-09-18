import { HttpErrorResponse } from '@angular/common/http';
import { Component, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);

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
