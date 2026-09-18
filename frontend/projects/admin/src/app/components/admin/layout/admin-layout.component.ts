import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService, User } from '../../../services/auth.service';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.css'],
})
export class AdminLayoutComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  // Rendered with the async pipe: the admin app is zoneless (#276), so a
  // subscribe-and-assign into a plain property would render the first emission
  // and then never repaint on login/logout/refresh.
  readonly currentUser$: Observable<User | null>;

  constructor() {
    this.currentUser$ = this.authService.currentUser$;
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
