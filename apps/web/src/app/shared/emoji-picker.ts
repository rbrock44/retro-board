import { Component, ElementRef, OnDestroy, afterNextRender, input, output, signal, viewChild } from '@angular/core';

/**
 * Every emoji, searchable, with categories, skin tones and "frequently used" (remembered in this browser).
 * Uses emoji-picker-element, loaded only when first opened; its emoji list is served by this app
 * (`/emoji/data.json`), so nothing is fetched from anywhere else. Emoji are drawn by the system's own font.
 *
 * The panel is moved to <body> so no card, column or scroll box can clip it, and placed beside `anchor`.
 * On phones it's a sheet along the bottom of the screen.
 */
@Component({
  selector: 'app-emoji-picker',
  template: `
    <div #panel class="emoji-panel" role="dialog" aria-label="Pick an emoji"
         [style.top.px]="pos()?.top" [style.left.px]="pos()?.left" (keydown.escape)="close()">
      @if (failed()) {
        <p class="muted small emoji-failed">The emoji list couldn't load. Check your connection and try again.</p>
      }
      <div #host class="emoji-host"></div>
    </div>
  `,
  host: { '(document:pointerdown)': 'outside($event)', '(window:resize)': 'place()' },
})
export class EmojiPicker implements OnDestroy {
  /** The button that opened it: the panel sits next to it, and clicking it again isn't an outside click */
  readonly anchor = input.required<HTMLElement>();
  readonly picked = output<string>();
  readonly closed = output<void>();

  private panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private host = viewChild.required<ElementRef<HTMLElement>>('host');
  protected pos = signal<{ top: number; left: number } | null>(null);
  protected failed = signal(false);

  constructor() {
    afterNextRender(() => void this.mount());
  }

  private async mount() {
    const panel = this.panel().nativeElement;
    document.body.appendChild(panel);
    this.place();
    try {
      const { Picker } = await import('emoji-picker-element');
      const picker = new Picker({ dataSource: new URL('emoji/data.json', document.baseURI).href });
      picker.addEventListener('emoji-click', e => {
        const emoji = e.detail.unicode;
        if (emoji) { this.picked.emit(emoji); this.close(); }
      });
      this.host().nativeElement.appendChild(picker);
      // straight to typing: the search box is inside the picker's shadow root
      setTimeout(() => picker.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]')?.focus(), 50);
    } catch {
      this.failed.set(true);
    }
  }

  /** Below the button if it fits, otherwise above; always on screen. Phones use a bottom sheet (CSS) instead. */
  place() {
    const r = this.anchor().getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(352, vw - 16), h = Math.min(420, vh - 16);
    let top = r.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    this.pos.set({ top, left });
  }

  outside(e: Event) {
    const t = e.target as Node;
    if (this.panel().nativeElement.contains(t) || this.anchor().contains(t)) return;
    this.close();
  }

  close() {
    this.closed.emit();
  }

  ngOnDestroy() {
    this.panel().nativeElement.remove();
  }
}
