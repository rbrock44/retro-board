import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragHandle, CdkDragPlaceholder, CdkDropList, moveItemInArray, type CdkDragDrop, type CdkDragMove } from '@angular/cdk/drag-drop';
import { CARD_STATUSES, CARD_STATUS_LABELS, type AttachmentDto, type CardDto, type CardStatus, type ReplyDto } from '@retro/shared';
import { RouterLink } from '@angular/router';
import { MarkdownPipe } from '../core/markdown.pipe';
import { Avatar } from '../shared/avatar';
import { RelativeTimePipe } from '../shared/relative-time.pipe';
import { BoardStore, groupLikes, type DropSpot } from './board.store';
import { dropSpotAt } from './drop-spot';
import { Composer, type ComposerResult } from './composer';
import { Media } from './media';
import { Reactions } from './reactions';
import { Reply } from './reply';
import { ClickOutside } from '../shared/click-outside';
import { PersonShades } from '../core/person-shades.service';
import { AuthService } from '../core/auth.service';

/**
 * One card. A group is shown as a box: its name, then every card in it as an equal, full card (the first card
 * holds the group's name in the data, but isn't shown any differently). `nested` marks a card drawn inside a box.
 */
@Component({
  selector: 'app-card',
  imports: [ClickOutside, FormsModule, RouterLink, Avatar, MarkdownPipe, RelativeTimePipe, Composer, Media, Reactions, Reply,
    CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder],
  template: `
    @if (kids().length) {
      <section class="group-box" [attr.data-card-id]="card().id" [class.pick-target]="picking() && !sourceInGroup()"
               [class.drop-target]="isSpot('group')"
               (click)="onPickClick($event)" [attr.aria-label]="'Group: ' + groupName()">
        <header class="group-head" cdkDragHandle [title]="store.arrangeMode() ? 'Drag here to move the whole group' : ''">
          @if (editingTitle()) {
            <input class="inline-edit" [value]="card().groupTitle ?? ''" placeholder="Name this group" (change)="saveTitle($event)"
                   (blur)="editingTitle.set(false)" (keydown.enter)="$any($event.target).blur()" autofocus aria-label="Group name">
          } @else {
            <button type="button" class="group-title" (click)="editingTitle.set(canMark())" [disabled]="!canMark()"
                    [title]="canMark() ? 'Rename the group' : ''">{{ groupName() }}</button>
          }
          <span class="group-meta">{{ kids().length + 1 }} cards · 👍 {{ totalLikes() }}</span>
        </header>
        <!-- each card in the group drags on its own: to a new spot in the group, into another group, or out -->
        <div class="group-cards" cdkDropList [id]="'grp-' + card().id" [cdkDropListData]="card().id"
             [cdkDropListEnterPredicate]="fromAGroup" [cdkDropListConnectedTo]="store.dropListIds()"
             (cdkDropListDropped)="dropInGroup($event)">
          @for (m of members(); track m.id) {
            <div cdkDrag [cdkDragData]="m" [cdkDragDisabled]="!canWrite() || !store.arrangeMode()" class="group-member"
                 (cdkDragMoved)="memberMoved($event)" (cdkDragEnded)="store.dragPointer = null; store.dropSpot.set(null)">
              <app-card [card]="m" [boardId]="boardId()" [nested]="true" />
              <div *cdkDragPlaceholder class="drag-placeholder"></div>
            </div>
          }
        </div>
      </section>
    } @else {
    <article class="card" [class.in-group]="nested()" [attr.data-card-id]="card().id" [attr.data-status]="card().status"
             [class.person-shaded]="shadeHue() !== null" [style.--person-hue]="shadeHue()"
             [class.drop-target]="!nested() && isSpot('group')"
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
          @if (card().anonymous || !card().author) {
            @if (card().anonymous) { <span class="anon" title="Anonymous">🕶</span> } @else { <app-avatar [user]="null" [size]="20" /> }
            <span class="name">{{ card().anonymous ? (card().mine ? 'You (anonymous)' : 'Anonymous') : 'Someone' }}</span>
          } @else {
            <button type="button" class="person-btn" (click)="openPerson($event)" [attr.aria-label]="'About ' + card().author!.name">
              <app-avatar [user]="card().author" [size]="20" />
              <span class="name">{{ card().author!.name }}</span>
            </button>
          }
        </span>
        <div class="spacer"></div>
        @if (card().status !== 'none') { <span class="status-badge" [attr.data-status]="card().status">{{ labels[card().status] }}</span> }
        @if (!auth.on('likes')) {
        } @else if (canVote()) {
          <button type="button" class="likes" [class.on]="card().liked" [attr.aria-pressed]="card().liked"
                  [attr.aria-label]="(card().liked ? 'Unlike' : 'Like') + ' (' + likesLabel() + ')'"
                  [title]="card().liked ? 'You like this. Click to unlike' : 'Like this card'"
                  (click)="store.toggleLike(card())">👍 {{ card().likes }}</button>
        } @else if (card().likes) {
          <span class="likes" [class.on]="card().liked" [title]="likesLabel()">👍 {{ card().likes }}</span>
        }
      </footer>

      <div class="card-actions">
        @if (auth.on('reactions')) {
          <app-reactions [items]="card().reactions" [enabled]="canVote()" (toggle)="store.react('card', card().id, $event)" />
        }
        <div class="spacer"></div>
        @if (canEdit() && !editing()) {
          <button type="button" class="card-edit-btn" (click)="editing.set(true)" aria-label="Edit card" title="Edit card">✎</button>
        }
        @if (canMark() || canEdit()) {
          <span class="menu-wrap" (clickOutside)="menuOpen.set(false)">
            <button type="button" class="card-menu-btn" (click)="menuOpen.set(!menuOpen())" aria-label="Card options" title="Card options" [attr.aria-expanded]="menuOpen()">⋯</button>
            @if (menuOpen()) {
              <div class="menu right" role="menu" (click)="menuOpen.set(false)">
                @if (canMark()) {
                  <span class="menu-label">Mark as</span>
                  @for (s of markable(); track s) {
                    <button type="button" role="menuitemradio" [attr.aria-checked]="card().status === s" (click)="store.setStatus(card().id, s)">
                      {{ card().status === s ? '● ' : '' }}{{ labels[s] }}
                    </button>
                  }
                  <hr>
                  @if (auth.on('actions')) {
                    <button type="button" role="menuitem" (click)="makeAction()">Create Action Item</button>
                  }
                }
                @if (canWrite()) {
                  @if (auth.on('groups')) {
                    <button type="button" role="menuitem" (click)="store.pickingGroupFor.set(card().id)">{{ inGroup() ? 'Add to Group' : 'Create Group' }}</button>
                  }
                  @if (inGroup()) {
                    <button type="button" role="menuitem" (click)="store.ungroup(card().id)">{{ card().parentId ? 'Remove from Group' : 'Break Up Group' }}</button>
                  }
                }
                @if (canEdit()) {
                  <hr>
                  <button type="button" role="menuitem" class="danger" (click)="remove()">Delete</button>
                }
              </div>
            }
          </span>
        }
      </div>

      @if (auth.on('replies')) {
        <!-- A wide bar, not a small icon, so opening replies doesn't take careful aim -->
        <button type="button" class="replies-toggle no-print" [class.open]="repliesOpen()" (click)="store.toggleReplies(card().id)"
                [attr.aria-expanded]="repliesOpen()" [attr.aria-label]="repliesLabel()" [title]="repliesLabel()">
          <svg class="bubble" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path d="M12 3.5c-4.97 0-9 3.36-9 7.5 0 2.2 1.14 4.17 2.95 5.55-.2 1.33-.85 2.6-1.85 3.6 1.9-.1 3.66-.8 5-1.9.94.22 1.91.25 2.9.25 4.97 0 9-3.36 9-7.5s-4.03-7.5-9-7.5Z"
                  fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
          </svg>
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
      }
    </article>
    }
  `,
})
export class Card {
  protected auth = inject(AuthService);
  protected store = inject(BoardStore);
  readonly card = input.required<CardDto>();
  readonly boardId = input.required<string>();
  readonly nested = input(false);

  protected labels = CARD_STATUS_LABELS;
  protected statuses: CardStatus[] = CARD_STATUSES;
  /** The marks on offer: Carry Over only while that feature is on */
  protected markable = computed(() => this.statuses.filter(s => s !== 'carry_over' || this.auth.on('carryOver')));
  protected editing = signal(false);
  protected editingTitle = signal(false);
  protected repliesOpen = computed(() => this.store.openReplies().has(this.card().id));
  protected menuOpen = signal(false);
  protected replyingTo = signal<ReplyDto | null>(null);

  protected kids = computed(() => (this.nested() ? [] : this.store.childrenOf().get(this.card().id) ?? []));
  /** The group's cards as shown: the leading card, then the rest */
  protected members = computed(() => [this.card(), ...this.kids()]);

  /** Group lists take cards dragged out of a group; loose cards and whole groups go between columns' cards. */
  protected fromAGroup = (drag: CdkDrag<CardDto>) => !!drag.dropContainer?.id?.startsWith('grp-');

  /** A card dragged from a group: its own group list sorts it while it's over one, else it's headed for a column */
  protected memberMoved(e: CdkDragMove<CardDto>) {
    const p = e.pointerPosition;
    this.store.dragPointer = p;
    const overGroup = document.elementsFromPoint(p.x, p.y).some(el => el.classList.contains('group-cards'));
    const spot = overGroup ? null : dropSpotAt(this.store, p, e.source.data, this.auth.on('groups'));
    const now = this.store.dropSpot();
    if (spot?.id !== now?.id || spot?.mode !== now?.mode) this.store.dropSpot.set(spot);
  }

  protected isSpot(mode: DropSpot['mode']) {
    const s = this.store.dropSpot();
    return s?.id === this.card().id && s.mode === mode;
  }

  protected dropInGroup(e: CdkDragDrop<string, string, CardDto>) {
    const order = this.members().map(m => m.id);
    if (e.previousContainer === e.container) {
      if (e.previousIndex === e.currentIndex) return;
      moveItemInArray(order, e.previousIndex, e.currentIndex);
    } else {
      order.splice(e.currentIndex, 0, e.item.data.id);
    }
    void this.store.arrange(this.card().id, order);
  }
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
  private shades = inject(PersonShades);
  /** The author's hue for the card's tint. Never for an anonymous card (not even the viewer's own): it would give the author away */
  protected shadeHue = computed(() => (this.card().anonymous ? null : this.shades.hueFor(this.card().author)));

  /** While picking a card to group with, a click on the author picks the card instead */
  openPerson(e: MouseEvent) {
    if (this.picking()) return;
    e.stopPropagation();
    this.store.personOpen.set(this.card().author);
  }

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
