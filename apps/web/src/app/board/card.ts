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
import { ClickOutside } from '../shared/click-outside';

/**
 * One card. A group is shown as a box: its name, then every card in it as an equal, full card (the first card
 * holds the group's name in the data, but isn't shown any differently). `nested` marks a card drawn inside a box.
 */
@Component({
  selector: 'app-card',
  imports: [ClickOutside, FormsModule, RouterLink, Avatar, MarkdownPipe, RelativeTimePipe, Composer, Media, Reactions, Reply],
  template: `
    @if (kids().length) {
      <section class="group-box" [attr.data-card-id]="card().id" [class.pick-target]="picking() && !sourceInGroup()"
               (click)="onPickClick($event)" [attr.aria-label]="'Group: ' + groupName()">
        <header class="group-head">
          @if (editingTitle()) {
            <input class="inline-edit" [value]="card().groupTitle ?? ''" placeholder="Name this group" (change)="saveTitle($event)"
                   (blur)="editingTitle.set(false)" (keydown.enter)="$any($event.target).blur()" autofocus aria-label="Group name">
          } @else {
            <button type="button" class="group-title" (click)="editingTitle.set(canMark())" [disabled]="!canMark()"
                    [title]="canMark() ? 'Rename the group' : ''">{{ groupName() }}</button>
          }
          <span class="group-meta">{{ kids().length + 1 }} cards · 👍 {{ totalLikes() }}</span>
        </header>
        <app-card [card]="card()" [boardId]="boardId()" [nested]="true" />
        @for (k of kids(); track k.id) {
          <app-card [card]="k" [boardId]="boardId()" [nested]="true" />
        }
      </section>
    } @else {
    <article class="card" [class.in-group]="nested()" [attr.data-card-id]="card().id" [attr.data-status]="card().status"
             [class.pick-target]="picking() && !nested() && store.pickingGroupFor() !== card().id"
             (click)="onPickClick($event)" [attr.aria-label]="'Card: ' + card().body.slice(0, 60)">

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
        @if (canMark() || canEdit()) {
          <span class="menu-wrap" (clickOutside)="menuOpen.set(false)">
            <button type="button" class="card-menu-btn" (click)="menuOpen.set(!menuOpen())" aria-label="Card options" title="Card options" [attr.aria-expanded]="menuOpen()">⋯</button>
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
                  <button type="button" role="menuitem" (click)="makeAction()">Create Action Item</button>
                }
                @if (canWrite()) {
                  <button type="button" role="menuitem" (click)="store.pickingGroupFor.set(card().id)">{{ inGroup() ? 'Add to Group' : 'Create Group' }}</button>
                  @if (inGroup()) {
                    <button type="button" role="menuitem" (click)="store.ungroup(card().id)">{{ card().parentId ? 'Remove from Group' : 'Break Up Group' }}</button>
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

      <!-- A wide bar, not a small icon, so opening replies doesn't take careful aim -->
      <button type="button" class="replies-toggle no-print" [class.open]="repliesOpen()" (click)="repliesOpen.set(!repliesOpen())"
              [attr.aria-expanded]="repliesOpen()" [attr.aria-label]="repliesLabel()" [title]="repliesLabel()">
        <span aria-hidden="true">💬</span>
        @if (card().replies.length) { <span class="replies-count">{{ card().replies.length }}</span> }
        <span class="chev" aria-hidden="true">▾</span>
      </button>

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
    </article>
    }
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
  /** In a group, whether drawn in a box or not: has a parent, or is the first card of one */
  protected inGroup = computed(() => !!this.card().parentId || !!this.store.childrenOf().get(this.card().id)?.length);
  protected groupName = computed(() => this.card().groupTitle || 'Group of ' + (this.kids().length + 1));
  /** While picking, the group the picked card is already in isn't a target */
  protected sourceInGroup = computed(() => {
    const source = this.store.pickingGroupFor();
    return source === this.card().id || this.kids().some(k => k.id === source);
  });
  protected totalLikes = computed(() => groupLikes(this.card(), this.kids()));
  protected repliesLabel = computed(() => {
    const n = this.card().replies.length;
    if (this.repliesOpen()) return 'Hide replies';
    return n ? `Show ${n} ${n === 1 ? 'reply' : 'replies'}` : 'Reply';
  });
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
