import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { ReplyDto } from '@retro/shared';
import { MarkdownPipe } from '../core/markdown.pipe';
import { Avatar } from '../shared/avatar';
import { RelativeTimePipe } from '../shared/relative-time.pipe';
import { BoardStore } from './board.store';
import { Composer, type ComposerResult } from './composer';
import { Media } from './media';
import { Reactions } from './reactions';

@Component({
  selector: 'app-reply',
  imports: [Avatar, MarkdownPipe, RelativeTimePipe, Composer, Media, Reactions],
  template: `
    <div class="reply" [class.nested]="!!reply().parentId">
      <app-avatar [user]="reply().author" [size]="22" />
      <div class="grow">
        <div class="reply-head">
          <strong>{{ reply().author?.name ?? 'Someone' }}</strong>
          <span class="meta">{{ reply().createdAt | ago }}{{ reply().editedAt ? ' · edited' : '' }}</span>
        </div>
        @if (editing()) {
          <app-composer [boardId]="boardId()" [initialBody]="reply().body" submitLabel="Save" [cancellable]="true" [autofocus]="true"
                        (submitted)="save($event)" (cancelled)="editing.set(false)" />
        } @else {
          <div class="md" [innerHTML]="reply().body | markdown"></div>
          <app-media [items]="reply().attachments" />
        }
        <div class="reply-actions">
          <app-reactions [items]="reply().reactions" [enabled]="canReact()" (toggle)="store.react('reply', reply().id, $event)" />
          @if (canWrite()) { <button type="button" class="link-btn" (click)="replyTo.emit(reply())">Reply</button> }
          @if (canEdit()) {
            <button type="button" class="link-btn" (click)="editing.set(true)">Edit</button>
            <button type="button" class="link-btn danger" (click)="remove()">Delete</button>
          }
        </div>
      </div>
    </div>
  `,
})
export class Reply {
  protected store = inject(BoardStore);
  readonly reply = input.required<ReplyDto>();
  readonly boardId = input.required<string>();
  readonly replyTo = output<ReplyDto>();
  protected editing = signal(false);

  protected canWrite = computed(() => !!this.store.permissions()?.canWrite);
  protected canReact = computed(() => !!this.store.permissions()?.canVote);
  protected canEdit = computed(() => this.canWrite() && (this.reply().mine || !!this.store.permissions()?.canFacilitate));

  async save(r: ComposerResult) {
    await this.store.editReply(this.reply().id, r.body);
    this.editing.set(false);
  }

  remove() {
    if (confirm('Delete this reply and its answers?')) void this.store.deleteReply(this.reply().id);
  }
}
