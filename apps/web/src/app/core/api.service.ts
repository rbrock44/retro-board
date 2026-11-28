import { Injectable, inject } from '@angular/core';
import { DemoService } from '../demo/demo.service';
import { TeamLockService, type LockedTeam } from './team-lock.service';

export class ApiError extends Error {
  /** `data` is the rest of the error body, e.g. `lockedTeam` on a 423 */
  constructor(public readonly status: number, message: string, public readonly data?: Record<string, unknown>) {
    super(message);
  }
}

/**
 * Thin fetch wrapper for the same-origin API. Every request sends the session cookie and the CSRF
 * header the server requires on anything that changes data.
 */
@Injectable({ providedIn: 'root' })
export class Api {
  private demo = inject(DemoService);
  private lock = inject(TeamLockService);

  async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    try {
      return await this.send<T>(method, url, body);
    } catch (err) {
      // A team password this browser hasn't typed: the app shows the password prompt instead of the page
      // (or a private board's own password)
      const team = err instanceof ApiError && err.status === 423 ? err.data?.['lockedTeam'] as LockedTeam | undefined : undefined;
      const board = err instanceof ApiError && err.status === 423 ? err.data?.['lockedBoard'] as LockedTeam | undefined : undefined;
      if (team) this.lock.locked.set(team);
      else if (board) this.lock.locked.set({ ...board, board: true });
      throw err;
    }
  }

  private async send<T>(method: string, url: string, body?: unknown): Promise<T> {
    if (this.demo.active()) return (await this.demo.handle(method, url, body)) as T;
    const isForm = body instanceof FormData;
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-retro-csrf': '1',
        ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const msg = (data as { error?: string } | undefined)?.error ?? `Request failed (${res.status})`;
      throw new ApiError(res.status, msg, data as Record<string, unknown> | undefined);
    }
    return data as T;
  }

  get<T>(url: string) { return this.request<T>('GET', url); }
  post<T>(url: string, body: unknown = {}) { return this.request<T>('POST', url, body); }
  patch<T>(url: string, body: unknown) { return this.request<T>('PATCH', url, body); }
  put<T>(url: string, body: unknown) { return this.request<T>('PUT', url, body); }
  delete<T = void>(url: string) { return this.request<T>('DELETE', url); }

  /** Upload with progress, which fetch cannot report. */
  upload<T>(url: string, file: File, onProgress?: (fraction: number) => void): Promise<T> {
    if (this.demo.active()) return this.demo.upload(url, file, onProgress) as Promise<T>;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.withCredentials = true;
      xhr.setRequestHeader('x-retro-csrf', '1');
      xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        const data = safeJson(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
        else reject(new ApiError(xhr.status, (data as { error?: string })?.error ?? `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Upload failed, check your connection'));
      const form = new FormData();
      form.append('file', file, file.name);
      xhr.send(form);
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
