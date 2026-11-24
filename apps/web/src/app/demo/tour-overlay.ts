import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { TourService } from './tour.service';

interface Box { top: number; left: number; width: number; height: number }

const PAD = 8;
const CARD_WIDTH = 340;

/**
 * Draws the tour: the page dimmed except a spotlight (with a pulsing ring) around the current feature, and a
 * card beside it explaining it. Follows the target as the page scrolls or resizes.
 */
@Component({
  selector: 'app-tour-overlay',
  template: `
    @if (tour.index() !== null && step(); as s) {
      <div class="tour-layer" (click)="$event.stopPropagation()">
        @if (spot(); as b) {
          <div class="tour-spot" [style.top.px]="b.top" [style.left.px]="b.left" [style.width.px]="b.width" [style.height.px]="b.height"></div>
        } @else {
          <div class="tour-dim"></div>
        }
        <div class="tour-card" role="dialog" aria-modal="true" [attr.aria-label]="s.title" aria-live="polite"
             [class.centered]="!spot()" [style.top.px]="cardPos()?.top" [style.left.px]="cardPos()?.left">
          <div class="tour-step">{{ i() + 1 }} of {{ tour.steps.length }}</div>
          <h2>{{ s.title }}</h2>
          <p>{{ s.body }}</p>
          @if (s.link; as l) { <p><a [href]="l.href" target="_blank" rel="noopener">{{ l.label }} ↗</a></p> }
          <div class="tour-dots" aria-hidden="true">
            @for (x of tour.steps; track $index) { <span [class.on]="$index === i()"></span> }
          </div>
          <div class="tour-actions">
            <button type="button" class="btn ghost small" (click)="tour.end()">{{ last() ? 'Close' : 'Skip tour' }}</button>
            <div class="spacer"></div>
            @if (i() > 0) { <button type="button" class="btn small" (click)="tour.back()">Back</button> }
            <button type="button" class="btn primary small" (click)="tour.next()" autofocus>{{ last() ? 'Done' : 'Next' }}</button>
          </div>
        </div>
      </div>
    }
  `,
  host: {
    '(document:keydown)': 'onKey($event)',
    '(window:resize)': 'measure()',
    '(window:scroll)': 'measure()',
    '(document:scroll)': 'measure()',
  },
})
export class TourOverlay {
  protected tour = inject(TourService);
  protected spot = signal<Box | null>(null);
  protected i = computed(() => this.tour.index() ?? 0);
  protected step = computed(() => this.tour.steps[this.i()]);
  protected last = computed(() => this.i() === this.tour.steps.length - 1);
  private el: HTMLElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Card below the target if there's room, else above, else beside; always kept on screen. */
  protected cardPos = computed(() => {
    const b = this.spot();
    if (!b) return null;
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(CARD_WIDTH, vw - 24);
    const height = 230;
    let top = b.top + b.height + 12;
    if (top + height > vh) top = b.top - height - 12;
    if (top < 12) top = Math.min(Math.max(12, b.top), vh - height - 12);
    let left = b.left + b.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, vw - width - 12));
    return { top, left };
  });

  constructor() {
    effect(() => {
      const index = this.tour.index();
      this.stopWatching();
      this.el = null;
      this.spot.set(null);
      if (index === null) return;
      const selector = this.tour.steps[index].target;
      if (!selector) return;
      // Pages load asynchronously: look for the target for a few seconds, then keep following it.
      const started = Date.now();
      this.timer = setInterval(() => {
        if (!this.el || !this.el.isConnected) {
          this.el = this.find(selector);
          if (this.el) this.el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
          else if (Date.now() - started > 4000) return this.stopWatching(); // not on this page: centered card
        }
        this.measure();
      }, 150);
    });
    inject(DestroyRef).onDestroy(() => this.stopWatching());
  }

  private find(selector: string): HTMLElement | null {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
    return null;
  }

  measure() {
    if (!this.el) return;
    const r = this.el.getBoundingClientRect();
    // Big targets (a whole board) get clipped to the screen so the card still has somewhere to go.
    const top = Math.max(r.top - PAD, 4), left = Math.max(r.left - PAD, 4);
    const bottom = Math.min(r.bottom + PAD, window.innerHeight - 4), right = Math.min(r.right + PAD, window.innerWidth - 4);
    const next = { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
    const cur = this.spot();
    if (!cur || Math.abs(cur.top - next.top) > 0.5 || Math.abs(cur.left - next.left) > 0.5 ||
        Math.abs(cur.width - next.width) > 0.5 || Math.abs(cur.height - next.height) > 0.5) {
      this.spot.set(next);
    }
  }

  onKey(e: KeyboardEvent) {
    if (!this.tour.active) return;
    if (e.key === 'Escape') this.tour.end();
    else if (e.key === 'ArrowRight') this.tour.next();
    else if (e.key === 'ArrowLeft') this.tour.back();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private stopWatching() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
