import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FEATURE_FOR_ATTACHMENT, type AttachmentDto } from '@retro/shared';
import { AuthService } from '../core/auth.service';
import { Lightbox } from './lightbox';

/** Attachment thumbnails on a card or reply; clicking opens the lightbox. */
@Component({
  selector: 'app-media',
  imports: [Lightbox],
  template: `
    @if (shown().length) {
      <div class="media-grid" [class.single]="shown().length === 1">
        @for (a of shown(); track a.id) {
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
      <app-lightbox [item]="a" (closed)="open.set(null)" />
    }
  `,
})
export class Media {
  readonly items = input.required<AttachmentDto[]>();
  private auth = inject(AuthService);
  /** Kinds of media an admin has switched off aren't shown (the server stops serving them too) */
  protected shown = computed(() => this.items().filter(a => this.auth.on(FEATURE_FOR_ATTACHMENT[a.kind])));
  readonly removable = input(false);
  readonly remove = output<AttachmentDto>();
  protected open = signal<AttachmentDto | null>(null);
}
