import { Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';

/** Accessible modal on top of the native <dialog> element: Esc and backdrop clicks close it. */
@Component({
  selector: 'app-modal',
  template: `
    <dialog #dialog class="modal" [class.wide]="wide()" (close)="closed.emit()" (click)="backdrop($event)"
            [attr.aria-labelledby]="'modal-title'">
      <div class="modal-body">
        <header class="modal-head">
          <h2 id="modal-title">{{ heading() }}</h2>
          <button type="button" class="icon-btn" aria-label="Close" (click)="close()">✕</button>
        </header>
        <ng-content />
      </div>
    </dialog>
  `,
})
export class Modal {
  readonly heading = input.required<string>();
  readonly wide = input(false);
  readonly closed = output<void>();
  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  close() {
    this.dialog().nativeElement.close();
  }

  backdrop(e: MouseEvent) {
    if (e.target === this.dialog().nativeElement) this.close();
  }
}
