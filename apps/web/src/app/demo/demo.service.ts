import { Injectable, signal } from '@angular/core';
import type { AttachmentDto, BoardEvent, TeamDto, UserDto } from '@retro/shared';
import type { DemoBackend } from './demo-backend';
import type { DemoState } from './demo-data';

/** Why the app is in demo mode */
export type DemoReason = 'no-server' | 'asked' | 'shared' | 'lock';

/** ?demo=lock: a demo where one team already has a password, to try the prompt */
export const LOCK_SHOWCASE = { teamId: 't-design', teamName: 'Des Moines Design Crew', password: 'retro' };

export interface DemoEntry {
  id: string;
  name: string;
  updatedAt: string;
  /** For demos opened from a link: a fingerprint of that link, so opening it again reuses this copy */
  sharedFrom?: string;
  /** Made for a showcase link (?demo=lock): opening that link again comes back to this one */
  showcase?: 'lock';
}

const LIBRARY_KEY = 'retro-board-demos';
const stateKey = (id: string) => `retro-board-demo:${id}`;
/** Bigger uploads stay out of share links so links stay a sane length */
const SHARE_MAX_ATTACHMENT = 200 * 1024;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

async function compress(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decompress(b64: string): Promise<string> {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/**
 * Demo mode: when there's no server (the public site on GitHub Pages) the app runs against an in-browser
 * backend with sample data. Every change is saved in this browser. People can keep several demos, and share one
 * as a link that carries the whole setup (#demo=...).
 */
@Injectable({ providedIn: 'root' })
export class DemoService {
  readonly active = signal(false);
  readonly reason = signal<DemoReason>('no-server');
  readonly entries = signal<DemoEntry[]>([]);
  readonly currentId = signal<string | null>(null);
  readonly saveFailed = signal(false);

  private backend: DemoBackend | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** A share link in the address bar, or ?demo, asks for demo mode even when a server is there. */
  requested(): boolean {
    return location.hash.startsWith('#demo=') || new URLSearchParams(location.search).has('demo');
  }

  async start(reason: DemoReason) {
    // A share link pasted into a tab that's already open only changes the #, which doesn't reload the page.
    addEventListener('hashchange', () => { if (location.hash.startsWith('#demo=')) location.reload(); });
    // Saves wait a moment to batch changes; leaving or reloading the page writes the last ones straight away
    addEventListener('pagehide', () => this.flush());
    const { DemoBackend } = await import('./demo-backend');
    const lib = readJson<{ currentId: string | null; entries: DemoEntry[] }>(LIBRARY_KEY) ?? { currentId: null, entries: [] };
    this.entries.set(lib.entries);

    let state: DemoState | null = null;
    let id = lib.currentId;
    if (location.hash.startsWith('#demo=')) {
      const hash = location.hash;
      const fingerprint = `${hash.length}:${hash.slice(6, 70)}`;
      const seen = lib.entries.find(e => e.sharedFrom === fingerprint);
      const shared = seen ? null : await this.readShareHash();
      if (seen) {
        id = seen.id;
        reason = 'shared';
      } else if (shared) {
        id = makeId();
        // whoever opens a share link is another browser: they type team passwords themselves
        state = { ...shared.state, locks: undefined };
        const base = shared.name || 'Shared demo';
        const name = lib.entries.some(e => e.name === base) ? `${base} (shared)` : base;
        this.addEntry({ id, name, updatedAt: new Date().toISOString(), sharedFrom: fingerprint });
        reason = 'shared';
      }
    }
    // ?demo=lock: its own demo, kept apart from "My demo", with a team someone else locked
    let showcase = false;
    if (!state && new URLSearchParams(location.search).get('demo') === 'lock') {
      showcase = true;
      reason = 'lock';
      const known = lib.entries.find(e => e.showcase === 'lock');
      id = known?.id ?? makeId();
      if (!known) this.addEntry({ id, name: 'Password demo', updatedAt: new Date().toISOString(), showcase: 'lock' });
    }
    if (!state && id) state = readJson<DemoState>(stateKey(id));
    if (!state && showcase) {
      const { teamId, password } = LOCK_SHOWCASE;
      this.backend = DemoBackend.lockShowcase(teamId, password, () => this.scheduleSave());
    } else if (!state) {
      id = makeId();
      this.addEntry({ id, name: 'My demo', updatedAt: new Date().toISOString() });
      this.backend = DemoBackend.fresh(() => this.scheduleSave());
    } else {
      this.backend = new DemoBackend(state, () => this.scheduleSave());
    }
    this.currentId.set(id);
    this.saveNow();
    this.reason.set(reason);
    this.active.set(true);
  }

  /** The showcase's password, shown on its prompt so visitors can get in */
  passwordHint(teamId: string): string | null {
    const entry = this.entries().find(e => e.id === this.currentId());
    return this.active() && entry?.showcase === 'lock' && teamId === LOCK_SHOWCASE.teamId ? LOCK_SHOWCASE.password : null;
  }

  handle(method: string, url: string, body?: unknown) {
    return this.backend!.handle(method, url, body);
  }

  upload(url: string, file: File, onProgress?: (f: number) => void): Promise<AttachmentDto | TeamDto> {
    return this.backend!.upload(url, file, onProgress);
  }

  subscribe(boardId: string, onEvent: (e: BoardEvent) => void, onTyping: (t: { user: UserDto; columnId: string }) => void) {
    return this.backend!.subscribe(boardId, { onEvent, onTyping });
  }

  exportBoard(boardId: string, format: 'md' | 'csv') {
    this.exportBoards([boardId], format);
  }

  /** Builds the file in the browser (there's no server in the demo) and downloads it. */
  exportBoards(boardIds: string[], format: 'md' | 'csv') {
    const file = this.backend!.exportBoards(boardIds, format);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([file.text], { type: `${file.type};charset=utf-8` }));
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- library ----

  currentName(): string {
    return this.entries().find(e => e.id === this.currentId())?.name ?? 'My demo';
  }

  /** Switching demos reloads the page so every screen starts from the new data. */
  load(id: string) {
    this.flush();
    this.writeLibrary(id);
    location.assign('/');
  }

  create(name: string) {
    this.flush();
    const id = makeId();
    this.addEntry({ id, name: name.trim() || 'New Demo', updatedAt: new Date().toISOString() });
    this.writeLibrary(id);
    location.assign('/');
  }

  rename(id: string, name: string) {
    this.entries.update(list => list.map(e => (e.id === id ? { ...e, name: name.trim() || e.name } : e)));
    this.writeLibrary(this.currentId());
  }

  remove(id: string) {
    try { localStorage.removeItem(stateKey(id)); } catch { /* storage blocked */ }
    this.entries.update(list => list.filter(e => e.id !== id));
    if (id === this.currentId()) {
      this.writeLibrary(this.entries()[0]?.id ?? null);
      location.assign('/');
    } else {
      this.writeLibrary(this.currentId());
    }
  }

  /** Back to the sample data, in the same slot. */
  reset() {
    const id = this.currentId();
    if (id) try { localStorage.removeItem(stateKey(id)); } catch { /* storage blocked */ }
    this.writeLibrary(id);
    this.backend = null;
    location.assign('/');
  }

  async shareLink(): Promise<{ url: string; droppedFiles: number }> {
    this.flush();
    const state = structuredClone(this.backend!.state);
    let droppedFiles = 0;
    for (const [id, a] of Object.entries(state.attachments)) {
      if (a.url.startsWith('blob:') || a.url.length > SHARE_MAX_ATTACHMENT) {
        delete state.attachments[id];
        droppedFiles++;
      }
    }
    const payload = await compress(JSON.stringify({ name: this.currentName(), state }));
    return { url: `${location.origin}/#demo=${payload}`, droppedFiles };
  }

  // ---- storage ----

  private async readShareHash(): Promise<{ name: string; state: DemoState } | null> {
    try {
      const data = JSON.parse(await decompress(location.hash.slice('#demo='.length)));
      return data?.state?.version === 1 ? data : null;
    } catch {
      return null;
    }
  }

  private addEntry(e: DemoEntry) {
    this.entries.update(list => [e, ...list.filter(x => x.id !== e.id)]);
  }

  private writeLibrary(currentId: string | null) {
    writeJson(LIBRARY_KEY, { currentId, entries: this.entries() });
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 300);
  }

  private flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.saveNow();
    }
  }

  private saveNow() {
    const id = this.currentId();
    if (!id || !this.backend) return;
    const ok = writeJson(stateKey(id), this.backend.state);
    this.saveFailed.set(!ok);
    this.entries.update(list => list.map(e => (e.id === id ? { ...e, updatedAt: new Date().toISOString() } : e)));
    this.writeLibrary(id);
  }
}
