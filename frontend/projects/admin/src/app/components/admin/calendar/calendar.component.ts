import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import {
  InterviewsService,
  UpcomingInterview,
  INTERVIEW_OUTCOMES,
} from '../../../services/interviews.service';

/** One calendar day with the rounds that fall on it. */
export interface CalendarDay {
  /** Local `YYYY-MM-DD`, used as the grouping key and the heading. */
  date: string;
  interviews: UpcomingInterview[];
}

/**
 * Admin interview calendar (#247 phase 2 / #70): every scheduled round across
 * all opportunities, grouped by day, with the company context each row needs,
 * an outcome control, and a per-round `.ics` download.
 *
 * The app is ZONELESS, so every assignment made inside a `subscribe` is
 * followed by `detectChanges()` — see lessons-learned §1. The lint enforces
 * this shape for callbacks; it cannot follow `await`, which is why nothing
 * here is written with async/await.
 */
@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './calendar.component.html',
})
export class CalendarComponent implements OnInit {
  private interviewsService = inject(InterviewsService);
  private cdr = inject(ChangeDetectorRef);
  private platformId = inject(PLATFORM_ID);

  readonly outcomes = INTERVIEW_OUTCOMES;
  readonly windows = [7, 14, 30, 90];

  days: CalendarDay[] = [];
  windowDays = 14;
  loading = false;
  error: string | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.interviewsService.upcoming(this.windowDays).subscribe({
      next: (rows) => {
        this.days = this.groupByDay(rows);
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading the interview calendar:', err);
        this.error = 'Failed to load the calendar';
        this.days = [];
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }

  changeWindow(days: number): void {
    this.windowDays = days;
    this.load();
  }

  /** Group into days, preserving the backend's soonest-first order.
   *
   *  Grouping is by LOCAL date, not by the UTC prefix of the ISO string: a
   *  20:00 UTC round is the next day in Berlin, and slicing the string would
   *  file it under the wrong heading for exactly the users who care.
   */
  private groupByDay(rows: UpcomingInterview[]): CalendarDay[] {
    const byDate = new Map<string, UpcomingInterview[]>();
    for (const row of rows) {
      const key = this.localDateKey(row.scheduled_at);
      const bucket = byDate.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        byDate.set(key, [row]);
      }
    }
    return [...byDate.entries()].map(([date, interviews]) => ({ date, interviews }));
  }

  /** Viewer timezone; tests may set an explicit IANA zone so assertions do
   *  not depend on the runner's TZ (CI is UTC, where a broken UTC-slice
   *  implementation is indistinguishable from the correct local grouping). */
  timeZone: string | undefined = undefined;

  localDateKey(iso: string): string {
    // en-CA formats as YYYY-MM-DD; the timeZone option is the load-bearing
    // part — with it undefined the viewer's own zone applies.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  }

  /** End time, so a row can show its span without the template doing math. */
  endsAt(interview: UpcomingInterview): Date {
    return new Date(
      new Date(interview.scheduled_at).getTime() + interview.duration_minutes * 60_000,
    );
  }

  /** A round that has started but not finished — the one the owner is in now. */
  isInProgress(interview: UpcomingInterview, now: Date = new Date()): boolean {
    const start = new Date(interview.scheduled_at);
    return start <= now && now < this.endsAt(interview);
  }

  setOutcome(interview: UpcomingInterview, outcome: string): void {
    this.interviewsService.update(interview.id, { outcome }).subscribe({
      next: (updated) => {
        interview.outcome = updated.outcome;
        this.error = null;
        // A cancelled round leaves the window (the backend excludes it), so
        // reload rather than leave a row the next refresh would drop anyway.
        if (updated.outcome === 'cancelled') {
          this.load();
          return;
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error updating the interview outcome:', err);
        this.error = 'Failed to update the outcome';
        // Snap the <select> back to the model value: ngModel writes the DOM
        // only when the bound value CHANGES, and a rejected PATCH left the
        // user's rejected choice on screen. Fresh row identities force the
        // re-render.
        // New ROW objects, not just new arrays: the template's
        // `@for (interview of day.interviews; track interview)` keys on OBJECT
        // IDENTITY (as the `*ngFor` it replaced did), so `[...d.interviews]`
        // (same objects) rebuilt nothing — measured by this component's own spec.
        this.days = this.days.map((d) => ({
          ...d,
          interviews: d.interviews.map((i) => ({ ...i })),
        }));
        this.cdr.detectChanges();
      },
    });
  }

  downloadingId: string | null = null;

  downloadIcs(interview: UpcomingInterview): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.downloadingId = interview.id;
    this.interviewsService.downloadIcs(interview.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `interview-${interview.id}.ics`;
        link.click();
        URL.revokeObjectURL(url);
        this.downloadingId = null;
        this.error = null;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error downloading the .ics:', err);
        this.error = 'Failed to download the calendar file';
        this.downloadingId = null;
        this.cdr.detectChanges();
      },
    });
  }

  get total(): number {
    return this.days.reduce((sum, day) => sum + day.interviews.length, 0);
  }
}
