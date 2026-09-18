import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  InteractionsService,
  Interaction,
  INTERACTION_STATUSES,
  INTERACTION_SOURCES,
} from '../../../services/interactions.service';
import { OpportunitiesService } from '../../../services/opportunities.service';

/**
 * Unified recruiter inbox (#69): every inbound interaction — contact form,
 * CV request, (later) bookings — in one list with a status workflow.
 */
@Component({
  selector: 'app-inbox',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inbox.component.html',
})
export class InboxComponent implements OnInit {
  private interactionsService = inject(InteractionsService);
  private opportunitiesService = inject(OpportunitiesService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  readonly statuses = INTERACTION_STATUSES;
  readonly sources = INTERACTION_SOURCES;

  items: Interaction[] = [];
  total = 0;
  page = 1;
  pages = 1;
  pageSize = 20;

  statusFilter = '';

  // Transparent translation (#248): per-row toggle between the ORIGINAL and
  // the machine translation. Keyed by id so it survives list refreshes.
  showOriginal: Record<string, boolean> = {};
  retranslatingId: string | null = null;
  sourceFilter = '';

  loading = false;
  error: string | null = null;
  expandedId: string | null = null;

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading = true;
    this.error = null;
    this.interactionsService
      .list({
        status: this.statusFilter || undefined,
        source: this.sourceFilter || undefined,
        page: this.page,
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (res) => {
          this.items = res.items;
          this.total = res.total;
          this.pages = res.pages;
          this.loading = false;
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('Error loading inbox:', err);
          this.error = 'Failed to load the inbox';
          this.loading = false;
          this.cdr.detectChanges();
        },
      });
  }

  onFilterChange() {
    this.page = 1;
    this.load();
  }

  goToPage(page: number) {
    if (page < 1 || page > this.pages || page === this.page) {
      return;
    }
    this.page = page;
    this.load();
  }

  /** id of the interaction whose promote request is in flight, or null. */
  promotingId: string | null = null;

  toggleExpand(id: string) {
    this.expandedId = this.expandedId === id ? null : id;
  }

  /** One click: this inbox item becomes a pipeline opportunity (#247).
   *  In-flight latch (#279): the server is idempotent, but a second click
   *  should never leave the operator waiting on a request that can only return
   *  the same card — and on a slow link the un-latched button fired twice. */
  promote(interaction: Interaction) {
    if (this.promotingId) {
      return;
    }
    this.promotingId = interaction.id;
    // Zoneless admin app (#276): setting the flag does NOT repaint on its own —
    // without this the operator keeps seeing an enabled "Promote" button while
    // the request is in flight, which is exactly the confusion the latch exists
    // to prevent. (The second click is blocked either way by the guard above;
    // this is what makes the state VISIBLE.)
    this.cdr.detectChanges();
    this.opportunitiesService.promote(interaction.id).subscribe({
      next: () => {
        this.router.navigate(['/pipeline']);
      },
      error: (err) => {
        console.error('Error promoting interaction:', err);
        this.promotingId = null;
        this.error = 'Failed to promote to the pipeline';
        this.cdr.detectChanges();
      },
    });
  }

  setStatus(interaction: Interaction, status: string) {
    if (status === interaction.status) {
      return;
    }
    this.interactionsService.updateStatus(interaction.id, status).subscribe({
      next: (updated) => {
        interaction.status = updated.status;
        interaction.updated_at = updated.updated_at;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error updating status:', err);
        this.error = 'Failed to update the status';
        this.cdr.detectChanges();
      },
    });
  }

  toggleOriginal(interaction: Interaction) {
    this.showOriginal[interaction.id] = !this.showOriginal[interaction.id];
  }

  /** The text the expanded row shows: the labeled machine translation when
   *  one exists and the toggle is not set — the original otherwise. The
   *  ORIGINAL is always one click away; nothing is ever replaced silently. */
  displayedMessage(interaction: Interaction): string {
    if (interaction.translated_message && !this.showOriginal[interaction.id]) {
      return interaction.translated_message;
    }
    return interaction.message;
  }

  showingTranslation(interaction: Interaction): boolean {
    return !!interaction.translated_message && !this.showOriginal[interaction.id];
  }

  retranslate(interaction: Interaction) {
    if (this.retranslatingId) {
      return;
    }
    this.retranslatingId = interaction.id;
    this.interactionsService.rerunTranslation(interaction.id).subscribe({
      next: (updated) => {
        this.items = this.items.map((i) => (i.id === updated.id ? updated : i));
        this.retranslatingId = null;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error re-running translation:', err);
        this.error = 'Failed to re-run translation';
        this.retranslatingId = null;
        this.cdr.detectChanges();
      },
    });
  }
}
