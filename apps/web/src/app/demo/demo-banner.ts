import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../core/toast.service';
import { Modal } from '../shared/modal';
import { RelativeTimePipe } from '../shared/relative-time.pipe';
import { DemoService } from './demo.service';
import { TourService } from './tour.service';

/** The strip across the top in demo mode, and the "Your demos" panel behind it. */
@Component({
  selector: 'app-demo-banner',
  imports: [FormsModule, Modal, RelativeTimePipe],
  template: `
    <div class="demo-banner" role="status">
      <span class="demo-tag">Demo</span>
      <span class="demo-text">
        <strong>{{ demo.currentName() }}</strong>
        @switch (demo.reason()) {
          @case ('no-server') { · No server here, so this is sample data. Add and change anything; it's saved in this browser only. }
          @case ('shared') { · Someone shared this demo with you. Your changes stay in this browser. }
          @default { · Sample data. Your changes are saved in this browser only. }
        }
        @if (demo.saveFailed()) { <span class="error"> Couldn't save (browser storage is full or blocked).</span> }
      </span>
      <span class="demo-actions">
        <button type="button" class="btn small primary" data-tour="tour" (click)="tour.start()">🧭 Tour</button>
        <button type="button" class="btn small" data-tour="share" (click)="share()" [disabled]="sharing()">🔗 Share</button>
        <button type="button" class="btn small ghost" (click)="panelOpen.set(true)">Demos</button>
        <button type="button" class="btn small ghost" (click)="reset()">Reset</button>
      </span>
    </div>
    @if (offerTour()) {
      <div class="tour-offer" role="status">
        <span>👋 New here? A one-minute tour shows you around.</span>
        <button type="button" class="btn small primary" (click)="tour.start(); offerTour.set(false)">Take the tour</button>
        <button type="button" class="btn small ghost" (click)="tour.markSeen(); offerTour.set(false)">No thanks</button>
      </div>
    }

    @if (panelOpen()) {
      <app-modal heading="Your demos" [wide]="true" (closed)="panelOpen.set(false)">
        <div class="stack">
          <p class="muted">Each demo is its own set of teams and retros, saved in this browser. Share one as a link and
            whoever opens it gets their own copy to play with.</p>
          <ul class="demo-list">
            @for (e of demo.entries(); track e.id) {
              <li [class.current]="e.id === demo.currentId()">
                <input [ngModel]="e.name" (change)="rename(e.id, $any($event.target).value)" maxlength="60" [attr.aria-label]="'Name of ' + e.name">
                <span class="muted small">saved {{ e.updatedAt | ago }}</span>
                @if (e.id === demo.currentId()) { <span class="chip">open</span> }
                @else { <button type="button" class="btn small" (click)="demo.load(e.id)">Open</button> }
                <button type="button" class="btn small ghost danger" (click)="remove(e.id, e.name)" aria-label="Delete">✕</button>
              </li>
            }
          </ul>
          <form class="row" (ngSubmit)="create()">
            <input name="newName" [(ngModel)]="newName" placeholder="New demo name" maxlength="60" class="grow">
            <button type="submit" class="btn">New demo</button>
          </form>
          @if (link()) {
            <label>Share link <input [value]="link()" readonly (focus)="$any($event.target).select()"></label>
          }
          <p class="muted small">Want the real thing? Run it with Docker: one command, see the README.</p>
        </div>
      </app-modal>
    }
  `,
})
export class DemoBanner {
  protected demo = inject(DemoService);
  protected tour = inject(TourService);
  /** Offered once per browser, until they take it or say no */
  protected offerTour = signal(!this.tour.seen());
  private toast = inject(ToastService);
  protected panelOpen = signal(false);
  protected sharing = signal(false);
  protected link = signal('');
  protected newName = '';

  async share() {
    this.sharing.set(true);
    try {
      const { url, droppedFiles } = await this.demo.shareLink();
      this.link.set(url);
      try {
        await navigator.clipboard.writeText(url);
        this.toast.show(droppedFiles
          ? `Link copied. ${droppedFiles} large upload${droppedFiles > 1 ? 's were' : ' was'} left out to keep it short.`
          : 'Link copied. Whoever opens it gets their own copy of this demo.');
      } catch {
        this.panelOpen.set(true); // clipboard blocked: show the link to copy by hand
      }
    } catch {
      this.toast.show("This browser can't make share links", 'error');
    } finally {
      this.sharing.set(false);
    }
  }

  reset() {
    if (confirm(`Put "${this.demo.currentName()}" back to the sample data? Your changes to it will be lost.`)) this.demo.reset();
  }

  rename(id: string, name: string) {
    this.demo.rename(id, name);
  }

  remove(id: string, name: string) {
    if (confirm(`Delete the demo "${name}"?`)) this.demo.remove(id);
  }

  create() {
    this.demo.create(this.newName);
  }
}
