import { Injectable, inject } from '@angular/core';
import { DemoService } from '../demo/demo.service';
import { ApiError } from './api.service';

export type ExportFormat = 'md' | 'csv';

/** Downloads boards from the history as one Markdown or spreadsheet file. */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private demo = inject(DemoService);

  async download(boardIds: string[], format: ExportFormat): Promise<void> {
    if (this.demo.active()) return this.demo.exportBoards(boardIds, format);
    const res = await fetch('/api/export', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-retro-csrf': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ boardIds, format }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { error?: string } | null;
      throw new ApiError(res.status, data?.error ?? `Export failed (${res.status})`);
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `retro-export.${format}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
