import { Component, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { AttachmentDto } from '@retro/shared';
import { Api, ApiError, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
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
let hintCount = 0;

@Component({
  selector: 'app-composer',
  imports: [FormsModule, DecimalPipe, GifPicker],
  template: `
    <form class="composer" [class.drag-over]="dragOver()" (ngSubmit)="submit()"
          (dragover)="onDragOver($event)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)">
      <textarea #box name="body" [(ngModel)]="body" [placeholder]="placeholder()" rows="2" maxlength="10000"
                (keydown)="onKey($event)" (paste)="onPaste($event)" (input)="typed.emit()" [attr.aria-label]="placeholder()"
                [attr.aria-describedby]="touch ? null : hintId"></textarea>

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
        <input #file type="file" hidden multiple [accept]="acceptTypes()" (change)="onPick($event)">
        @if (acceptTypes()) {
          <!-- off while the site's room for uploads is full, saying so, rather than failing after the file is picked -->
          <button type="button" class="icon-btn" (click)="file.click()" [disabled]="uploadsFull()"
                  [title]="uploadsFull() ? fullMessage : attachLabel()" [attr.aria-label]="uploadsFull() ? fullMessage : attachLabel()">📎</button>
        }
        @if (auth.config()?.gifSearch && auth.on('gifs')) {
          <button type="button" class="icon-btn gif-btn" (click)="gifOpen.set(true)" title="Add a GIF" aria-label="Add a GIF">GIF</button>
        }
        @if (initialAnonymous()) {
          <!-- once anonymous, always: showing the name later would give away who wrote it -->
          <label class="check small" title="An anonymous card stays anonymous"><input type="checkbox" name="anon" checked disabled> Anonymous</label>
        } @else if (allowAnonymous() && auth.on('anonymous')) {
          <label class="check small" title="Hide your name on this card. It can't be undone"><input type="checkbox" name="anon" [(ngModel)]="anonymous"> Anonymous</label>
        }
        <div class="spacer"></div>
        @if (cancellable()) { <button type="button" class="btn ghost small" (click)="cancelled.emit()">Cancel</button> }
        <button type="submit" class="btn primary small" [disabled]="!canSubmit()">{{ submitLabel() }}</button>
      </div>
      @if (!touch) {
        <p class="composer-hint" [id]="hintId"><kbd>Enter</kbd> to {{ submitLabel().toLowerCase() }} · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</p>
      }
    </form>
    @if (gifOpen()) {
      <app-gif-picker [boardId]="boardId()" (picked)="addGif($event)" (closed)="gifOpen.set(false)" />
    }
  `,
})
export class Composer {
  protected auth = inject(AuthService);
  private toast = inject(ToastService);
  private api = inject(Api);

  readonly boardId = input.required<string>();
  /** Phones and tablets: on-screen keyboards have no Shift+Enter, so there Enter adds a line and Add submits */
  protected readonly touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  protected readonly hintId = `composer-hint-${++hintCount}`;
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
    // Enter while an input method is still composing (Japanese, Chinese, …) picks a character, never submits
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229
        && (e.ctrlKey || e.metaKey || (!e.shiftKey && !e.altKey && !this.touch))) {
      e.preventDefault();
      void this.submit();
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

  /** File types the 📎 picker offers, from what's switched on */
  protected acceptTypes = computed(() => [
    this.auth.on('images') ? 'image/png,image/jpeg,image/webp,image/avif' : '',
    this.auth.on('gifs') ? 'image/gif' : '',
    this.auth.on('videos') ? 'video/mp4,video/webm,video/quicktime' : '',
  ].filter(Boolean).join(','));
  protected attachLabel = computed(() => {
    const kinds = [this.auth.on('images') && 'image', this.auth.on('gifs') && 'GIF', this.auth.on('videos') && 'video'].filter(Boolean);
    return 'Attach ' + (kinds.length > 1 ? kinds.slice(0, -1).join(', ') + ' or ' + kinds.at(-1) : kinds[0] ?? 'a file');
  });

  protected uploadsFull = computed(() => !!this.auth.config()?.site.uploadsFull);
  protected readonly fullMessage = "Attaching files is off: this site's room for uploads is full. An admin can make room or raise the limit";

  /** Pasted or dropped files skip the picker, so check them here too */
  private allowed(file: File): string | null {
    if (this.uploadsFull()) return this.fullMessage;
    if (file.type === 'image/gif' && !this.auth.on('gifs')) return 'GIFs are turned off on this site';
    if (file.type.startsWith('image/') && file.type !== 'image/gif' && !this.auth.on('images')) return 'Image uploads are turned off on this site';
    if (file.type.startsWith('video/') && !this.auth.on('videos')) return 'Video uploads are turned off on this site';
    // the size limit, checked before sending so nobody waits on an upload that will be refused
    const site = this.auth.config()?.site;
    const video = file.type.startsWith('video/');
    const cap = video ? site?.maxVideoMb : site?.maxImageMb;
    if (cap && file.size > cap * 1024 * 1024) {
      return `${file.name} is ${(file.size / 1048576).toFixed(1)} MB. ${video ? 'Videos' : 'Images'} can be at most ${cap} MB`;
    }
    return null;
  }

  async upload(file: File) {
    if (this.attachments().length + this.uploads().length >= 10) return;
    const blocked = this.allowed(file);
    if (blocked) {
      this.toast.show(blocked, 'error');
      return;
    }
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
      // it filled up since the page loaded: turn attaching off now, not on the next visit
      if (err instanceof ApiError && err.status === 507) {
        this.auth.config.update(c => (c ? { ...c, site: { ...c.site, uploadsFull: true } } : c));
      }
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
