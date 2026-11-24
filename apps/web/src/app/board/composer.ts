import { Component, ElementRef, inject, input, output, signal, viewChild, afterNextRender } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { AttachmentDto } from '@retro/shared';
import { Api, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { GifPicker } from './gif-picker';

interface PendingUpload {
  key: number;
  name: string;
  progress: number;
  preview: string | null;
  error?: string;
}

export interface ComposerResult {
  body: string;
  anonymous: boolean;
  attachmentIds: string[];
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime';

/**
 * Text plus media: attach with the button, paste an image, drop files, or search GIFs.
 * Files upload as soon as they are picked so submitting is instant.
 */
@Component({
  selector: 'app-composer',
  imports: [FormsModule, DecimalPipe, GifPicker],
  template: `
    <form class="composer" [class.drag-over]="dragOver()" (ngSubmit)="submit()"
          (dragover)="onDragOver($event)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)">
      <textarea #box name="body" [(ngModel)]="body" [placeholder]="placeholder()" rows="2" maxlength="10000"
                (keydown)="onKey($event)" (paste)="onPaste($event)" (input)="typed.emit()" [attr.aria-label]="placeholder()"></textarea>

      @if (attachments().length || uploads().length) {
        <div class="composer-media">
          @for (a of attachments(); track a.id) {
            <div class="thumb">
              @if (a.kind === 'video') { <video [src]="a.url" muted preload="metadata"></video> }
              @else { <img [src]="a.thumbUrl ?? a.url" [alt]="a.name ?? 'attachment'"> }
              <button type="button" class="thumb-x" (click)="removeAttachment(a)" aria-label="Remove attachment">✕</button>
            </div>
          }
          @for (u of uploads(); track u.key) {
            <div class="thumb uploading" [class.failed]="u.error">
              @if (u.preview) { <img [src]="u.preview" alt=""> }
              <span class="progress">{{ u.error ?? (u.progress * 100 | number: '1.0-0') + '%' }}</span>
              @if (u.error) { <button type="button" class="thumb-x" (click)="dropUpload(u.key)" aria-label="Dismiss">✕</button> }
            </div>
          }
        </div>
      }

      <div class="composer-bar">
        <input #file type="file" hidden multiple [accept]="accept" (change)="onPick($event)">
        <button type="button" class="icon-btn" (click)="file.click()" title="Attach image or video" aria-label="Attach image or video">📎</button>
        @if (auth.config()?.gifSearch) {
          <button type="button" class="icon-btn gif-btn" (click)="gifOpen.set(true)" title="Add a GIF" aria-label="Add a GIF">GIF</button>
        }
        @if (allowAnonymous()) {
          <label class="check small" title="Hide your name on this card"><input type="checkbox" name="anon" [(ngModel)]="anonymous"> Anonymous</label>
        }
        <div class="spacer"></div>
        @if (cancellable()) { <button type="button" class="btn ghost small" (click)="cancelled.emit()">Cancel</button> }
        <button type="submit" class="btn primary small" [disabled]="!canSubmit()">{{ submitLabel() }}</button>
      </div>
    </form>
    @if (gifOpen()) {
      <app-gif-picker [boardId]="boardId()" (picked)="addGif($event)" (closed)="gifOpen.set(false)" />
    }
  `,
})
export class Composer {
  protected auth = inject(AuthService);
  private api = inject(Api);

  readonly boardId = input.required<string>();
  readonly placeholder = input('Add a card…');
  readonly submitLabel = input('Add');
  readonly initialBody = input('');
  readonly initialAnonymous = input(false);
  readonly allowAnonymous = input(false);
  readonly cancellable = input(false);
  readonly autofocus = input(false);
  readonly submitted = output<ComposerResult>();
  readonly cancelled = output<void>();
  readonly typed = output<void>();

  private box = viewChild.required<ElementRef<HTMLTextAreaElement>>('box');

  protected body = '';
  protected anonymous = false;
  protected accept = ACCEPT;
  protected attachments = signal<AttachmentDto[]>([]);
  protected uploads = signal<PendingUpload[]>([]);
  protected dragOver = signal(false);
  protected gifOpen = signal(false);
  private nextKey = 1;

  constructor() {
    afterNextRender(() => {
      this.body = this.initialBody();
      this.anonymous = this.initialAnonymous();
      if (this.autofocus()) this.box().nativeElement.focus();
    });
  }

  canSubmit() {
    return (this.body.trim().length > 0 || this.attachments().length > 0) && !this.uploads().some(u => !u.error);
  }

  async submit() {
    if (!this.canSubmit()) return;
    if (!(await this.auth.ensureName())) return;
    this.submitted.emit({ body: this.body, anonymous: this.anonymous, attachmentIds: this.attachments().map(a => a.id) });
    this.body = '';
    this.attachments.set([]);
    this.uploads.set([]);
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.submit();
    } else if (e.key === 'Escape' && this.cancellable()) {
      this.cancelled.emit();
    }
  }

  onPaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      files.forEach(f => void this.upload(f));
    }
  }

  onDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      this.dragOver.set(true);
    }
  }

  onDrop(e: DragEvent) {
    this.dragOver.set(false);
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    files.forEach(f => void this.upload(f));
  }

  onPick(e: Event) {
    const el = e.target as HTMLInputElement;
    [...(el.files ?? [])].forEach(f => void this.upload(f));
    el.value = '';
  }

  async upload(file: File) {
    if (this.attachments().length + this.uploads().length >= 10) return;
    const key = this.nextKey++;
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    this.uploads.update(u => [...u, { key, name: file.name, progress: 0, preview }]);
    try {
      const a = await this.api.upload<AttachmentDto>(`/api/boards/${this.boardId()}/attachments`, file, p =>
        this.uploads.update(list => list.map(x => (x.key === key ? { ...x, progress: p } : x))));
      this.attachments.update(list => [...list, a]);
      this.dropUpload(key);
    } catch (err) {
      this.uploads.update(list => list.map(x => (x.key === key ? { ...x, error: errorMessage(err) } : x)));
    }
  }

  dropUpload(key: number) {
    const u = this.uploads().find(x => x.key === key);
    if (u?.preview) URL.revokeObjectURL(u.preview);
    this.uploads.update(list => list.filter(x => x.key !== key));
  }

  addGif(a: AttachmentDto) {
    this.attachments.update(list => [...list, a]);
    this.gifOpen.set(false);
  }

  removeAttachment(a: AttachmentDto) {
    this.attachments.update(list => list.filter(x => x.id !== a.id));
    void this.api.delete(`/api/attachments/${a.id}`).catch(() => {});
  }
}
