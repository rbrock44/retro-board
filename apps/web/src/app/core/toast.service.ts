import { Injectable, signal } from '@angular/core';
import { errorMessage } from './api.service';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private next = 1;

  show(text: string, kind: Toast['kind'] = 'info') {
    const id = this.next++;
    this.toasts.update(t => [...t, { id, text, kind }]);
    setTimeout(() => this.dismiss(id), kind === 'error' ? 6000 : 3000);
  }

  error(err: unknown) {
    this.show(errorMessage(err), 'error');
  }

  dismiss(id: number) {
    this.toasts.update(t => t.filter(x => x.id !== id));
  }
}
