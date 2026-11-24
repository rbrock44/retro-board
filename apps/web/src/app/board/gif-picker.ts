import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AttachmentDto, GifResultDto } from '@retro/shared';
import { Api } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { Modal } from '../shared/modal';

/** Tenor search, shown only when the server has TENOR_API_KEY. */
@Component({
  selector: 'app-gif-picker',
  imports: [FormsModule, Modal],
  template: `
    <app-modal heading="Add a GIF" [wide]="true" (closed)="closed.emit()">
      <form class="row" (ngSubmit)="search()">
        <input name="q" type="search" [(ngModel)]="q" placeholder="Search GIFs" class="grow" autofocus aria-label="Search GIFs">
        <button class="btn" type="submit">Search</button>
      </form>
      @if (loading()) { <p class="muted">Searching…</p> }
      <div class="gif-grid">
        @for (g of results(); track g.id) {
          <button type="button" class="gif-cell" (click)="pick(g)" [title]="g.title"><img [src]="g.previewUrl" [alt]="g.title" loading="lazy"></button>
        } @empty { @if (!loading()) { <p class="muted">No GIFs found.</p> } }
      </div>
      <p class="muted small">Powered by Tenor</p>
    </app-modal>
  `,
})
export class GifPicker {
  private api = inject(Api);
  private toast = inject(ToastService);
  readonly boardId = input.required<string>();
  readonly picked = output<AttachmentDto>();
  readonly closed = output<void>();
  protected q = '';
  protected results = signal<GifResultDto[]>([]);
  protected loading = signal(false);

  constructor() {
    void this.search();
  }

  async search() {
    this.loading.set(true);
    try {
      this.results.set(await this.api.get<GifResultDto[]>(`/api/gifs?q=${encodeURIComponent(this.q)}`));
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.loading.set(false);
    }
  }

  async pick(g: GifResultDto) {
    try {
      const a = await this.api.post<AttachmentDto>(`/api/boards/${this.boardId()}/attachments/gif`, {
        url: g.url, previewUrl: g.previewUrl, width: g.width, height: g.height, title: g.title,
      });
      this.picked.emit(a);
    } catch (err) {
      this.toast.error(err);
    }
  }
}
