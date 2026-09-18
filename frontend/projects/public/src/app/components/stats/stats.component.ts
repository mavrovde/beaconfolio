import { Component, OnInit, OnDestroy, PLATFORM_ID, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { TranslatePipe } from '@beaconfolio/shared';
import { StatsService } from '@beaconfolio/shared';
import { SiteConfigService, SiteConfig } from '../../services/site-config.service';

import packageJson from '../../../../../../package.json';

@Component({
  selector: 'app-system-stats',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './stats.component.html',
  styleUrls: ['./stats.component.css'],
})
export class SystemStatsComponent implements OnInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  private statsService = inject(StatsService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  uptime: string = '00:00:00';
  private serverStartTime: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | undefined;
  visitorIp: string = '127.0.0.1'; // Mock for now
  memoryUsage: number = 24; // Mock MB usage
  isVisible: boolean = true;

  backendVersion: string = 'Unknown';
  frontendVersion: string = packageJson.version;
  currentYear: number = new Date().getFullYear();
  site$: Observable<SiteConfig>;

  constructor() {
    const siteConfig = inject(SiteConfigService);

    this.site$ = siteConfig.config$;
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.simulateMemoryFluctuation();
      this.fetchPublicStats();

      // Check visibility on init
      this.checkVisibility(this.router.url);

      // Check visibility on route change
      this.router.events.pipe(
        filter(event => event instanceof NavigationEnd)
      ).subscribe((event: NavigationEnd) => {
        this.checkVisibility(event.urlAfterRedirects || event.url);
        // The public app bundles no zone.js (see angular.json — no polyfills),
        // so async callbacks must notify change detection explicitly.
        this.cdr.markForCheck();
      });
    }
  }

  private checkVisibility(url: string): void {
    this.isVisible = !url.includes('/admin');
  }

  private fetchPublicStats(): void {
    this.statsService.getPublicStats().subscribe({
      next: (stats) => {
        this.visitorIp = stats.visitor_ip;
        this.backendVersion = stats.backend_version;
        if (stats.start_time) {
          this.serverStartTime = new Date(stats.start_time).getTime();
          this.startUptimeCounter();
        } else {
          // Fallback if no start time provided
          this.uptime = stats.uptime;
        }
        // Zoneless (no zone.js polyfill): repaint the footer with the fetched
        // values, otherwise it stays frozen at 'Unknown' (#94 footer-stats).
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to fetch public stats:', err);
        this.visitorIp = 'Unavailable';
        this.backendVersion = 'Error';
        this.startUptimeCounter(); // Fallback to client uptime if API fails
        this.cdr.markForCheck();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private startUptimeCounter(): void {
    const startTime = this.serverStartTime || Date.now();

    // Clear existing if any
    if (this.intervalId) clearInterval(this.intervalId);

    this.intervalId = setInterval(() => {
      const now = Date.now();
      const diff = now - startTime;
      this.uptime = this.formatTime(Math.max(0, diff)); // Ensure non-negative
      this.cdr.markForCheck(); // zoneless: tick the uptime display each second
    }, 1000);

    // Initial call
    const now = Date.now();
    const diff = now - startTime;
    this.uptime = this.formatTime(Math.max(0, diff));
  }

  private formatTime(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    const timeStr = `${this.pad(hours)}:${this.pad(minutes)}:${this.pad(seconds)}`;
    return days > 0 ? `${days}d ${timeStr}` : timeStr;
  }

  private pad(num: number): string {
    return num < 10 ? '0' + num : num.toString();
  }

  private simulateMemoryFluctuation(): void {
    if (isPlatformBrowser(this.platformId)) {
      setInterval(() => {
        // Fluctuate between 20MB and 60MB
        this.memoryUsage = Math.floor(Math.random() * (60 - 20 + 1) + 20);
        this.cdr.markForCheck(); // zoneless: repaint the memory display
      }, 5000);
    }
  }
}
