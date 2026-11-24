import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CARD_STATUSES, CARD_STATUS_LABELS, type AttachmentDto, type CardDto, type CardStatus, type ReplyDto } from '@retro/shared';
import { RouterLink } from '@angular/router';
import { MarkdownPipe } from '../core/markdown.pipe';
import { Avatar } from '../shared/avatar';
import { RelativeTimePipe } from '../shared/relative-time.pipe';
import { BoardStore, groupLikes } from './board.store';
import { Composer, type ComposerResult } from './composer';
import { Media } from './media';
import { Reactions } from './reactions';
import { Reply } from './reply';

/** One card. A group head also renders its grouped cards inside itself (`nested` cards render compactly). */
@Component({
  selector: 'app-card',
  imports: [FormsModule, RouterLink, Avatar, MarkdownPipe, RelativeTimePipe, Composer, Media, Reactions, Reply],
  template: `
    <article class="card" [class.nested]="nested()" [attr.data-card-id]="card().id" [attr.data-status]="card().status"
             [class.pick-target]="picking() && store.pickingGroupFor() !== card().id"
             (click)="onPickClick($event)" [attr.aria-label]="'Card: ' + card().body.slice(0, 60)">
      @if (kids().length && !nested()) {
        <div class="group-head">
          @if (editingTitle()) {
            <input class="inline-edit" [value]="card().groupTitle ?? ''" placeholder="Name this group" (change)="saveTitle($event)"
                   (blur)="editingTitle.set(false)" (keydown.enter)="$any($event.target).blur()" autofocus aria-label="Group name">
          } @else {
            <button type="button" class="group-title" (click)="editingTitle.set(canMark())" [disabled]="!canMark()">
              {{ card().groupTitle || 'Group of ' + (kids().length + 1) }}
            </button>
          }
          <span class="tag">👍 {{ totalLikes() }}</span>
        </div>
      }

      @if (card().carriedFrom; as from) {
        <a class="carried" [routerLink]="['/boards', from.boardId]" title="Open the earlier board">↪ carried from {{ from.boardTitle }}</a>
      }

      @if (editing()) {
        <app-composer [boardId]="boardId()" [initialBody]="card().body" [initialAnonymous]="card().anonymous"
                      [allowAnonymous]="allowAnonymous()" submitLabel="Save" [cancellable]="true" [autofocus]="true"
                      (submitted)="save($event)" (cancelled)="editing.set(false)" />
        <app-media [items]="card().attachments" [removable]="true" (remove)="removeAttachment($event)" />
      } @else {
        @if (card().body) { <div class="md" [innerHTML]="card().body | markdown"></div> }
        <app-media [items]="card().attachments" />
      }

      <footer class="card-foot">
        <span class="author" [title]="card().createdAt | ago">
          @if (card().anonymous) { <span class="anon" title="Anonymous">🕶</span> } @else { <app-avatar [user]="card().author" [size]="20" /> }
          <span class="name">{{ card().anonymous ? (card().mine ? 'You (anonymous)' : 'Anonymous') : card().author?.name ?? 'Someone' }}</span>
        </span>
        <div class="spacer"></div>
        @if (card().status !== 'none') { <span class="status-badge" [attr.data-status]="card().status">{{ labels[card().status] }}</span> }
        @if (canVote()) {
          <button type="button" class="likes" [class.on]="card().liked" [attr.aria-pressed]="card().liked"
                  [attr.aria-label]="(card().liked ? 'Unlike' : 'Like') + ' (' + likesLabel() + ')'"
                  [title]="card().liked ? 'You like this. Click to unlike' : 'Like this card'"
                  (click)="store.toggleLike(card())">👍 {{ card().likes }}</button>
        } @else if (card().likes) {
          <span class="likes" [class.on]="card().liked" [title]="likesLabel()">👍 {{ card().likes }}</span>
        }
      </footer>

      <div class="card-actions">
        <app-reactions [items]="card().reactions" [enabled]="canVote()" (toggle)="store.react('card', card().id, $event)" />
        <div class="spacer"></div>
        <button type="button" class="link-btn" (click)="repliesOpen.set(!repliesOpen())" [attr.aria-expanded]="repliesOpen()">
          💬 {{ card().replies.length || '' }}
        </button>
        @if (canMark() || canEdit()) {
          <span class="menu-wrap">
            <button type="button" class="icon-btn small" (click)="menuOpen.set(!menuOpen())" aria-label="Card options" [attr.aria-expanded]="menuOpen()">⋯</button>
            @if (menuOpen()) {
              <div class="menu right" role="menu" (click)="menuOpen.set(false)">
                @if (canMark()) {
                  <span class="menu-label">Mark as</span>
                  @for (s of statuses; track s) {
                    <button type="button" role="menuitemradio" [attr.aria-checked]="card().status === s" (click)="store.setStatus(card().id, s)">
                      {{ card().status === s ? '● ' : '' }}{{ labels[s] }}
                    </button>
                  }
                  <hr>
                  <button type="button" role="menuitem" (click)="makeAction()">Create action item</button>
                }
                @if (canWrite()) {
                  <button type="button" role="menuitem" (click)="store.pickingGroupFor.set(card().id)">{{ card().parentId || kids().length ? 'Add to group' : 'Create group' }}</button>
                  @if (card().parentId || kids().length) {
                    <button type="button" role="menuitem" (click)="store.ungroup(card().id)">{{ card().parentId ? 'Remove from group' : 'Break up group' }}</button>
                  }
                }
                @if (canEdit()) {
                  <hr>
                  <button type="button" role="menuitem" (click)="editing.set(true)">Edit</button>
                  <button type="button" role="menuitem" class="danger" (click)="remove()">Delete</button>
                }
              </div>
            }
          </span>
        }
      </div>

      @if (repliesOpen()) {
        <section class="replies" aria-label="Replies">
          @for (r of card().replies; track r.id) {
            <app-reply [reply]="r" [boardId]="boardId()" (replyTo)="replyingTo.set($event)" />
          }
          @if (canWrite()) {
            @if (replyingTo(); as to) {
              <p class="meta">Replying to {{ to.author?.name ?? 'reply' }} <button type="button" class="link-btn" (click)="replyingTo.set(null)">cancel</button></p>
            }
            <app-composer [boardId]="boardId()" placeholder="Write a reply…" submitLabel="Reply" (submitted)="sendReply($event)" />
          }
        </section>
      }

      @for (k of kids(); track k.id) {
        <app-card [card]="k" [boardId]="boardId()" [nested]="true" />
      }
    </article>
  `,
})
export class Card {
  protected store = inject(BoardStore);
  readonly card = input.required<CardDto>();
  readonly boardId = input.required<string>();
  readonly nested = input(false);

  protected labels = CARD_STATUS_LABELS;
  protected statuses: CardStatus[] = CARD_STATUSES;
  protected editing = signal(false);
  protected editingTitle = signal(false);
  protected repliesOpen = signal(false);
  protected menuOpen = signal(false);
  protected replyingTo = signal<ReplyDto | null>(null);

  protected kids = computed(() => (this.nested() ? [] : this.store.childrenOf().get(this.card().id) ?? []));
  protected totalLikes = computed(() => groupLikes(this.card(), this.kids()));
  protected likesLabel = computed(() => `${this.card().likes} ${this.card().likes === 1 ? 'like' : 'likes'}`);
  protected canWrite = computed(() => !!this.store.permissions()?.canWrite);
  protected canVote = computed(() => !!this.store.permissions()?.canVote);
  protected canMark = computed(() => !!this.store.permissions()?.canVote);
  protected canEdit = computed(() => this.canWrite() && (this.card().mine || !!this.store.permissions()?.canFacilitate));
  protected allowAnonymous = computed(() => !!this.store.board()?.settings.allowAnonymous);
  protected picking = computed(() => !!this.store.pickingGroupFor());

  onPickClick(e: MouseEvent) {
    const source = this.store.pickingGroupFor();
    if (!source || source === this.card().id) return;
    e.stopPropagation();
    void this.store.groupInto(source, this.card().id);
  }

  async save(r: ComposerResult) {
    await this.store.editCard(this.card().id, { body: r.body, anonymous: r.anonymous, attachmentIds: r.attachmentIds });
    this.editing.set(false);
  }

  removeAttachment(a: AttachmentDto) {
    void this.store.editCard(this.card().id, { removeAttachmentIds: [a.id] });
  }

  saveTitle(e: Event) {
    void this.store.editCard(this.card().id, { groupTitle: (e.target as HTMLInputElement).value.trim() || null });
    this.editingTitle.set(false);
  }

  async sendReply(r: ComposerResult) {
    await this.store.reply(this.card().id, r.body, this.replyingTo()?.id ?? null, r.attachmentIds);
    this.replyingTo.set(null);
  }

  makeAction() {
    const title = prompt('Action item', this.card().body.split('\n')[0].slice(0, 200));
    if (title?.trim()) void this.store.createAction(title.trim(), this.card().id);
  }

  remove() {
    if (confirm('Delete this card?')) void this.store.deleteCard(this.card().id);
  }
}
