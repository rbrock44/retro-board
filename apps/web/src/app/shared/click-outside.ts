import { Directive, ElementRef, inject, output } from '@angular/core';

/**
 * Emits when someone presses outside this element, or presses Escape. Put it on the wrapper around a dropdown's
 * button and its menu, and close the menu on it: `<span (clickOutside)="open.set(false)">`.
 */
@Directive({
  selector: '[clickOutside]',
  host: {
    '(document:pointerdown)': 'onPointer($event)',
    '(document:keydown.escape)': 'clickOutside.emit()',
  },
})
export class ClickOutside {
  private el = inject(ElementRef<HTMLElement>);
  readonly clickOutside = output<void>();

  onPointer(e: PointerEvent) {
    if (!this.el.nativeElement.contains(e.target as Node)) this.clickOutside.emit();
  }
}
