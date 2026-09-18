import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  OpportunitiesService,
  Opportunity,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_SOURCES,
} from '../../../services/opportunities.service';
import { AdminCvService, CvVersion } from '../../../services/admin-cv.service';
import {
  TailoredLink,
  TailoredLinksService,
  parseHighlights,
} from '../../../services/tailored-links.service';

/**
 * Job-search pipeline board (#247): opportunities by stage, with a detail
 * panel (notes timeline, stage moves, next action) and a quick-create form.
 */
@Component({
  selector: 'app-pipeline',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pipeline.component.html',
})
export class PipelineComponent implements OnInit {
  private opportunitiesService = inject(OpportunitiesService);
  private adminCvService = inject(AdminCvService);
  private tailoredLinksService = inject(TailoredLinksService);
  private cdr = inject(ChangeDetectorRef);

  readonly stages = OPPORTUNITY_STAGES;
  readonly sources = OPPORTUNITY_SOURCES;

  all: Opportunity[] = [];
  selected: Opportunity | null = null;

  loading = false;
  error: string | null = null;

  // quick-create form
  showCreate = false;
  draft = { company: '', role_title: '', source: 'recruiter_outreach' };

  noteDraft = '';

  // CV variants (#247 criterion 4): loaded lazily when the detail panel opens,
  // because most panel opens never touch the CV control.
  cvVersions: CvVersion[] = [];
  cvChoice = '';
  sendingCv = false;

  // Tailored application links (#250): minted from the opportunity, listed with
  // their own signal (visits / CV downloads) so the operator sees whether the
  // application was ever opened.
  links: TailoredLink[] = [];
  showLinkForm = false;
  savingLink = false;
  copiedLinkId: string | null = null;
  linkDraft = {
    slug: '',
    cv_document_id: '',
    headline_note: '',
    highlighted_skills: '',
    highlighted_projects: '',
    expires_at: '',
  };

  ngOnInit() {
    this.load();
  }

  byStage(stage: string): Opportunity[] {
    return this.all.filter((o) => o.stage === stage);
  }

  load() {
    this.loading = true;
    this.error = null;
    this.opportunitiesService.list().subscribe({
      next: (res) => {
        this.all = res.items;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading pipeline:', err);
        this.error = 'Failed to load the pipeline';
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }

  create() {
    if (!this.draft.company.trim() || !this.draft.role_title.trim()) {
      return;
    }
    this.opportunitiesService.create(this.draft).subscribe({
      next: (opp) => {
        this.all = [opp, ...this.all];
        this.showCreate = false;
        this.draft = { company: '', role_title: '', source: 'recruiter_outreach' };
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error creating opportunity:', err);
        this.error = 'Failed to create the opportunity';
        this.cdr.detectChanges();
      },
    });
  }

  open(opportunity: Opportunity) {
    // A stale selection from the PREVIOUS panel must never carry over: with it,
    // one click records the wrong variant against the wrong company — the one
    // datum this feature exists to record (#294 review round 1, reproduced).
    this.cvChoice = '';
    // Same reasoning for the tailored-link panel: a previous opportunity's
    // links must never be shown (or edited) under this one's header.
    this.links = [];
    this.showLinkForm = false;
    this.copiedLinkId = null;
    this.resetLinkDraft();
    this.loadCvVersions();
    this.loadLinks(opportunity.id);
    this.opportunitiesService.get(opportunity.id).subscribe({
      next: (full) => {
        this.selected = full;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading opportunity:', err);
        this.error = 'Failed to load the opportunity';
        this.cdr.detectChanges();
      },
    });
  }

  close() {
    this.selected = null;
    this.noteDraft = '';
    this.links = [];
    this.showLinkForm = false;
    this.copiedLinkId = null;
    this.resetLinkDraft();
  }

  moveStage(stage: string) {
    if (!this.selected || stage === this.selected.stage) {
      return;
    }
    this.opportunitiesService.moveStage(this.selected.id, stage).subscribe({
      next: (updated) => {
        this.selected = updated;
        this.all = this.all.map((o) => (o.id === updated.id ? updated : o));
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error moving stage:', err);
        this.error = 'Failed to move the stage';
        this.cdr.detectChanges();
      },
    });
  }

  addNote() {
    if (!this.selected || !this.noteDraft.trim()) {
      return;
    }
    this.opportunitiesService.addNote(this.selected.id, this.noteDraft).subscribe({
      next: (updated) => {
        this.selected = updated;
        this.noteDraft = '';
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error adding note:', err);
        this.error = 'Failed to add the note';
        this.cdr.detectChanges();
      },
    });
  }

  loadCvVersions() {
    // 100 is the backend's le=100 page bound (admin_cv.py): variants beyond
    // the 100th are unpickable here until the control grows pagination —
    // an accepted limit, recorded rather than hidden (#294 review nit 10).
    this.adminCvService.getVersions(1, 100).subscribe({
      next: (page) => {
        this.cvVersions = page.items;
        this.cdr.detectChanges();
      },
      error: (err) => {
        // Not fatal to the panel: the rest of the detail view works without
        // the CV list; the control simply stays empty.
        console.error('Error loading CV versions:', err);
        this.cdr.detectChanges();
      },
    });
  }

  /** The variant currently recorded on the selected opportunity, if the list
   *  has it (it may have been deleted — the FK is SET NULL server-side). */
  sentCvLabel(): string | null {
    if (!this.selected?.sent_cv_id) {
      return null;
    }
    const doc = this.cvVersions.find((v) => v.id === this.selected!.sent_cv_id);
    return doc ? `${doc.version} (${doc.filename})` : 'a since-deleted version';
  }

  recordCvSent() {
    if (!this.selected || !this.cvChoice || this.sendingCv) {
      return;
    }
    this.sendingCv = true;
    this.opportunitiesService.recordCvSent(this.selected.id, this.cvChoice).subscribe({
      next: (full) => {
        this.selected = full;
        this.all = this.all.map((o) => (o.id === full.id ? full : o));
        this.cvChoice = '';
        this.sendingCv = false;
        this.error = null; // a stale failure banner must not outlive a success
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error recording the sent CV:', err);
        this.error = 'Failed to record the sent CV';
        this.sendingCv = false;
        this.cdr.detectChanges();
      },
    });
  }

  // -- Tailored application links (#250) ------------------------------------

  private resetLinkDraft() {
    this.linkDraft = {
      slug: '',
      cv_document_id: '',
      headline_note: '',
      highlighted_skills: '',
      highlighted_projects: '',
      expires_at: '',
    };
  }

  loadLinks(opportunityId: string) {
    this.tailoredLinksService.listFor(opportunityId).subscribe({
      next: (links) => {
        this.links = links;
        this.cdr.detectChanges();
      },
      error: (err) => {
        // Not fatal to the panel — the rest of the detail view still works.
        console.error('Error loading tailored links:', err);
        this.cdr.detectChanges();
      },
    });
  }

  createLink() {
    if (!this.selected || this.savingLink) {
      return;
    }
    this.savingLink = true;
    this.tailoredLinksService
      .create({
        opportunity_id: this.selected.id,
        // An empty custom slug means "generate one" — the backend appends a
        // random suffix so the URL is not guessable from the company name.
        slug: this.linkDraft.slug.trim() || null,
        cv_document_id: this.linkDraft.cv_document_id || null,
        headline_note: this.linkDraft.headline_note.trim() || null,
        highlighted_skills: parseHighlights(this.linkDraft.highlighted_skills),
        highlighted_projects: parseHighlights(this.linkDraft.highlighted_projects),
        expires_at: this.linkDraft.expires_at || null,
      })
      .subscribe({
        next: (link) => {
          this.links = [link, ...this.links];
          this.showLinkForm = false;
          this.savingLink = false;
          this.error = null; // a stale banner must not outlive a success
          this.resetLinkDraft();
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('Error creating the tailored link:', err);
          this.error =
            err?.status === 409
              ? 'That slug is already taken — pick another one'
              : 'Failed to create the tailored link';
          this.savingLink = false;
          this.cdr.detectChanges();
        },
      });
  }

  toggleLink(link: TailoredLink) {
    this.tailoredLinksService.update(link.id, { enabled: !link.enabled }).subscribe({
      next: (updated) => {
        this.links = this.links.map((l) => (l.id === updated.id ? updated : l));
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error updating the tailored link:', err);
        this.error = 'Failed to update the tailored link';
        this.cdr.detectChanges();
      },
    });
  }

  deleteLink(link: TailoredLink) {
    // Irreversible, and the URL is already in a recruiter's inbox: deleting it
    // turns a live page into a 404 with no way back, while the recoverable
    // `Disable` sits one button away in the same row. Same confirm-first
    // convention as every other destructive admin action (tag-manager,
    // post-list, post-editor, sql-panel).
    if (!confirm(`Delete the tailored link /for/${link.slug}? This cannot be undone.`)) {
      return;
    }
    this.tailoredLinksService.remove(link.id).subscribe({
      next: () => {
        this.links = this.links.filter((l) => l.id !== link.id);
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error deleting the tailored link:', err);
        this.error = 'Failed to delete the tailored link';
        this.cdr.detectChanges();
      },
    });
  }

  /**
   * Copy the absolute link. `navigator.clipboard` is undefined on insecure
   * origins, so the failure path is explicit rather than an unhandled
   * rejection — the operator still sees the URL in the row. (The admin app is
   * browser-only, so `navigator` itself always exists here.)
   */
  copyLink(link: TailoredLink) {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      this.error = 'Clipboard unavailable — copy the URL manually';
      return;
    }
    clipboard.writeText(link.url).then(
      () => {
        this.copiedLinkId = link.id;
        this.cdr.detectChanges();
      },
      () => {
        this.error = 'Clipboard unavailable — copy the URL manually';
        this.cdr.detectChanges();
      }
    );
  }
}
