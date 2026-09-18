import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';

import { RouterModule } from '@angular/router';
import {
  SiteSettingsService,
  AVAILABILITY_STATES,
  THEME_PRESETS,
  THEME_DESCRIPTIONS,
} from '../../../services/site-settings.service';
import { StatsService, SystemStats } from '@beaconfolio/shared';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})
export class DashboardComponent implements OnInit {
  private statsService = inject(StatsService);
  private siteSettingsService = inject(SiteSettingsService);
  private cdr = inject(ChangeDetectorRef);

  stats: SystemStats | null = null;
  loading = true;
  error: string | null = null;

  // Availability (#271): the public hero's job-search state, editable here so
  // the owner flips it without a redeploy.
  readonly availabilityStates = AVAILABILITY_STATES;
  availability = '';
  availabilitySaving = false;
  availabilityError: string | null = null;

  // Theme (#339): which preset token set the PUBLIC site paints itself with.
  // Chosen here, applied there on the next load — this panel does not restyle
  // the admin SPA, which keeps its own neutral chrome on purpose.
  readonly themePresets = THEME_PRESETS;
  readonly themeDescriptions = THEME_DESCRIPTIONS;
  theme = '';
  themeSaving = false;
  themeError: string | null = null;

  ngOnInit(): void {
    this.loadStats();
    this.loadAvailability();
    this.loadTheme();
  }

  loadTheme(): void {
    this.siteSettingsService.getTheme().subscribe({
      next: (res) => {
        this.theme = res.value;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading theme:', err);
        this.themeError = 'Failed to load theme';
        this.cdr.detectChanges();
      },
    });
  }

  setTheme(value: string): void {
    if (this.themeSaving || value === this.theme) {
      return;
    }
    this.themeSaving = true;
    this.themeError = null;
    const previous = this.theme;
    this.theme = value;
    this.siteSettingsService.setTheme(value).subscribe({
      next: (res) => {
        this.theme = res.value;
        this.themeSaving = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error saving theme:', err);
        // Roll back so the control never lies about persisted state.
        this.theme = previous;
        this.themeError = 'Failed to save theme';
        this.themeSaving = false;
        this.cdr.detectChanges();
      },
    });
  }

  loadAvailability(): void {
    this.siteSettingsService.getAvailability().subscribe({
      next: (res) => {
        this.availability = res.value;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading availability:', err);
        this.availabilityError = 'Failed to load availability';
        this.cdr.detectChanges();
      },
    });
  }

  setAvailability(value: string): void {
    if (this.availabilitySaving || value === this.availability) {
      return;
    }
    this.availabilitySaving = true;
    this.availabilityError = null;
    const previous = this.availability;
    this.availability = value;
    this.siteSettingsService.setAvailability(value).subscribe({
      next: (res) => {
        this.availability = res.value;
        this.availabilitySaving = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error saving availability:', err);
        // Roll back so the control never lies about persisted state.
        this.availability = previous;
        this.availabilityError = 'Failed to save availability';
        this.availabilitySaving = false;
        this.cdr.detectChanges();
      },
    });
  }

  loadStats(): void {
    console.log('Dashboard: loadStats called');
    this.loading = true;
    this.error = null;
    this.statsService.getStats().subscribe({
      next: (data) => {
        console.log('Dashboard: Stats received', data);
        this.stats = data;
        this.loading = false;
        this.cdr.detectChanges(); // Force UI update
      },
      error: (error) => {
        console.error('Dashboard: Failed to load stats:', error);
        this.error = 'Failed to load dashboard statistics';
        this.loading = false;
        this.cdr.detectChanges(); // Force UI update
      },
      complete: () => {
        console.log('Dashboard: Stats request completed');
      },
    });
  }

  getLanguages(): string[] {
    return this.stats?.posts.by_language ? Object.keys(this.stats.posts.by_language) : [];
  }
}
