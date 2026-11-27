import { Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import type { AttachmentDto } from '@retro/shared';

export const MAX_ZOOM = 4;
const CLICK_STEP = 1.5;
const WHEEL_STEP = 1.15;

/**
 * Full-size view of an image. The picture stays in a frame that never fills the screen, so a click around it always
 * closes. Inside the frame: the wheel zooms in and out, a click zooms in (and back to fit once fully zoomed), and a
 * drag moves around a zoomed picture. The scale at the top right shows how far it's zoomed.
 */
@Component({
  selector: 'app-lightbox',
  host: {
    '(document:pointermove)': 'dragMove($event)',
    '(document:pointerup)': 'dragEnd()',
    '(document:keydown.escape)': 'closed.emit()',
  },
  template: `
    <div class="lightbox" role="dialog" aria-modal="true" aria-label="Image viewer" (click)="closed.emit()" (wheel)="wheel($event)">
      <div #frame class="lightbox-frame" [class.zoomed]="zoom() > 1" [class.max]="atMax()" [class.dragging]="dragging()"
           (click)="clickImage($event)" (pointerdown)="dragStart($event)">
        <img [src]="item().url" [alt]="item().name ?? ''" draggable="false"
             [style.transform]="'translate(' + x() + 'px, ' + y() + 'px) scale(' + zoom() + ')'">
      </div>
      <div class="lightbox-zoom" (click)="$event.stopPropagation()" role="group" aria-label="Zoom">
        <button type="button" (click)="zoomBy(1 / CLICK_STEP)" [disabled]="zoom() <= 1" aria-label="Zoom out" title="Zoom out">−</button>
        <span class="zoom-track" aria-hidden="true"><span class="zoom-fill" [style.width.%]="fill()"></span></span>
        <span class="zoom-level" aria-live="polite">{{ percent() }}%</span>
        <button type="button" (click)="zoomBy(CLICK_STEP)" [disabled]="atMax()" aria-label="Zoom in" title="Zoom in">+</button>
      </div>
      <button type="button" class="lightbox-x" aria-label="Close">✕</button>
    </div>
  `,
})
export class Lightbox {
  readonly item = input.required<AttachmentDto>();
  readonly closed = output<void>();
  protected readonly CLICK_STEP = CLICK_STEP;

  protected zoom = signal(1);
  /** The picture's offset in the frame, in px; between frame size × (1 − zoom) and 0, so no gap ever shows */
  protected x = signal(0);
  protected y = signal(0);
  protected atMax = computed(() => this.zoom() >= MAX_ZOOM - 1e-6);
  protected percent = computed(() => Math.round(this.zoom() * 100));
  protected fill = computed(() => ((this.zoom() - 1) / (MAX_ZOOM - 1)) * 100);
  protected dragging = signal(false);

  private frame = viewChild.required<ElementRef<HTMLElement>>('frame');
  private drag: { px: number; py: number; x: number; y: number; moved: boolean } | null = null;
  /** A drag ends in a click; that click mustn't zoom */
  private swallowClick = false;

  protected clickImage(e: MouseEvent) {
    e.stopPropagation();
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    if (this.atMax()) this.zoomTo(1, 0, 0);
    else this.zoomAt(this.zoom() * CLICK_STEP, e.clientX, e.clientY);
  }

  /** Over the picture it zooms toward the pointer; anywhere else around it, toward the middle */
  protected wheel(e: WheelEvent) {
    e.preventDefault();
    if (!e.deltaY) return;
    const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
    if ((e.target as HTMLElement).closest('.lightbox-frame')) this.zoomAt(this.zoom() * factor, e.clientX, e.clientY);
    else this.zoomBy(factor);
  }

  protected zoomBy(factor: number) {
    const r = this.frame().nativeElement.getBoundingClientRect();
    this.zoomAt(this.zoom() * factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  protected dragStart(e: PointerEvent) {
    if (e.button !== 0 || this.zoom() <= 1) return;
    this.drag = { px: e.clientX, py: e.clientY, x: this.x(), y: this.y(), moved: false };
  }

  protected dragMove(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    this.dragging.set(true);
    this.place(d.x + dx, d.y + dy);
  }

  protected dragEnd() {
    if (this.drag?.moved) this.swallowClick = true;
    this.drag = null;
    this.dragging.set(false);
  }

  /** Zoom to `z`, keeping the point under (cx, cy) where it is */
  private zoomAt(z: number, cx: number, cy: number) {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    const r = this.frame().nativeElement.getBoundingClientRect();
    const px = cx - r.left;
    const py = cy - r.top;
    const k = next / this.zoom();
    this.zoomTo(next, px - (px - this.x()) * k, py - (py - this.y()) * k);
  }

  private zoomTo(z: number, x: number, y: number) {
    this.zoom.set(z);
    this.place(x, y);
  }

  private place(x: number, y: number) {
    const frame = this.frame().nativeElement;
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    const z = this.zoom();
    this.x.set(Math.min(0, Math.max(w * (1 - z), x)));
    this.y.set(Math.min(0, Math.max(h * (1 - z), y)));
  }
}
