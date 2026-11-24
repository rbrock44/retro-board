import { Component, input, output, signal } from '@angular/core';
import type { AttachmentDto } from '@retro/shared';

/** Attachment thumbnails on a card or reply; clicking opens the lightbox. */
@Component({
  selector: 'app-media',
  template: `
    @if (items().length) {
      <div class="media-grid" [class.single]="items().length === 1">
        @for (a of items(); track a.id) {
          <div class="media-cell">
            @if (a.kind === 'video') {
              <video [src]="a.url" controls preload="metadata" playsinline></video>
            } @else {
              <button type="button" class="media-open" (click)="open.set(a)" [attr.aria-label]="'Open ' + (a.name ?? 'image')">
                <img [src]="a.thumbUrl ?? a.url" [alt]="a.name ?? ''" loading="lazy"
                     [attr.width]="a.width" [attr.height]="a.height">
              </button>
            }
            @if (removable()) {
              <button type="button" class="thumb-x" (click)="remove.emit(a)" aria-label="Remove attachment">✕</button>
            }
          </div>
        }
      </div>
    }
    @if (open(); as a) {
      <div class="lightbox" role="dialog" aria-modal="true" aria-label="Image viewer" (click)="open.set(null)" (keydown.escape)="open.set(null)" tabindex="-1">
        <img [src]="a.url" [alt]="a.name ?? ''">
        <button type="button" class="lightbox-x" aria-label="Close">✕</button>
      </div>
    }
  `,
})
export class Media {
  readonly items = input.required<AttachmentDto[]>();
  readonly removable = input(false);
  readonly remove = output<AttachmentDto>();
  protected open = signal<AttachmentDto | null>(null);
}
