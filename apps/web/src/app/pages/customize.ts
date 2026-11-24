import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  COLOR_PRESETS, THEME_PRESETS,
  type ColumnSpec, type InstanceSettings, type InstanceSettingsAdminDto, type TemplateDto, type ThemePreference,
} from '@retro/shared';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { ColorPicker } from '../shared/color-picker';
import { ThemeEditor } from '../shared/theme-editor';

type Key = keyof InstanceSettings;

/**
 * Admin → Customize: instance-wide settings. They start from the launch settings (.env) and every change here
 * is saved in the database; "Reset" goes back to the launch value.
 */
@Component({
  selector: 'app-customize',
  imports: [FormsModule, ThemeEditor, ColorPicker],
  template: `
    @if (data(); as d) {
      <div class="stack">
        <section class="card-surface stack">
          <h2>Name</h2>
          <label>Site name <input [(ngModel)]="form.siteName" maxlength="60"></label>
          <p class="muted small">{{ hint('siteName') }}
            @if (overridden('siteName')) { <button type="button" class="link-btn" (click)="reset('siteName')">Reset</button> }</p>
        </section>

        <section class="card-surface stack">
          <h2>Look</h2>
          <p class="muted">The colors everyone sees until they pick their own in Profile &amp; theme.</p>
          <label class="row"><input type="radio" name="themeMode" [checked]="!form.theme" (change)="form.theme = null"> Light or dark, following each person's device</label>
          <label class="row"><input type="radio" name="themeMode" [checked]="!!form.theme" (change)="useSiteTheme()"> One look for the whole site</label>
          @if (form.theme) {
            <app-theme-editor [value]="form.theme" (valueChange)="form.theme = $event" />
          }
          <p class="muted small">{{ hint('theme') }}
            @if (overridden('theme')) { <button type="button" class="link-btn" (click)="reset('theme')">Reset</button> }</p>
        </section>

        <section class="card-surface stack">
          <h2>Columns</h2>
          <label>New boards start with
            <select [(ngModel)]="form.defaultTemplateId">
              @for (t of d.templates; track t.id) { <option [value]="t.id">{{ t.name }}{{ t.instance ? ' (yours)' : '' }}</option> }
            </select>
          </label>
          <p class="swatch-row">
            @for (c of selectedTemplate()?.columns ?? []; track $index) { <span class="col-chip" [style.border-color]="c.color">{{ c.title }}</span> }
          </p>
          <p class="muted small">Teams can pick their own default, and pick any template when they start a board. {{ hint('defaultTemplateId') }}
            @if (overridden('defaultTemplateId')) { <button type="button" class="link-btn" (click)="reset('defaultTemplateId')">Reset</button> }</p>

          <h3>Your templates</h3>
          <p class="muted small">Column sets every team can choose from, next to the built-in ones.</p>
          @for (t of instanceTemplates(); track t.id) {
            <div class="row">
              <strong>{{ t.name }}</strong>
              <span class="swatch-row">@for (c of t.columns; track $index) { <span class="col-chip" [style.border-color]="c.color">{{ c.title }}</span> }</span>
              <div class="spacer"></div>
              <button type="button" class="btn ghost small danger" (click)="deleteTemplate(t)">Delete</button>
            </div>
          } @empty { <p class="muted small">None yet.</p> }

          <details class="new-template">
            <summary>New template</summary>
            <div class="stack">
              <label>Name <input [(ngModel)]="draftName" maxlength="80" placeholder="e.g. Rose / Thorn / Bud"></label>
              @for (c of draftColumns; track $index; let i = $index) {
                <div class="row">
                  <app-color-picker [value]="c.color" (valueChange)="c.color = $event" [presets]="colorPresets" />
                  <input class="grow" [(ngModel)]="c.title" maxlength="80" [attr.aria-label]="'Column ' + (i + 1) + ' title'" placeholder="Column title">
                  <button type="button" class="icon-btn" (click)="draftColumns.splice(i, 1)" [disabled]="draftColumns.length === 1" aria-label="Remove column">✕</button>
                </div>
              }
              <div class="row">
                <button type="button" class="btn ghost small" (click)="addDraftColumn()" [disabled]="draftColumns.length >= 12">＋ Column</button>
                <div class="spacer"></div>
                <button type="button" class="btn small" (click)="createTemplate()" [disabled]="!draftName.trim() || !draftColumns.every(c => c.title.trim())">Add template</button>
              </div>
            </div>
          </details>
        </section>

        <section class="card-surface stack">
          <h2>Cards</h2>
          <label class="row"><input type="checkbox" [(ngModel)]="form.allowAnonymous"> Allow anonymous cards</label>
          <p class="muted small">Default for new boards; facilitators can change it.
            {{ hint('allowAnonymous') }}
            @if (overridden('allowAnonymous')) {
              <button type="button" class="link-btn" (click)="reset('allowAnonymous')">Reset</button>
            }</p>
        </section>

        @if (!auth.open()) {
          <section class="card-surface stack">
            <h2>Sign-in</h2>
            <label>Who can create an email and password account
              <select [(ngModel)]="form.signup">
                <option value="open">Anyone who can reach the site</option>
                <option value="invite">Only people with a team invite link</option>
                <option value="closed">Nobody (use sign-in providers, or add people yourself)</option>
              </select>
            </label>
            <p class="muted small">{{ hint('signup') }}
              @if (overridden('signup')) { <button type="button" class="link-btn" (click)="reset('signup')">Reset</button> }</p>
            <p class="muted small">Google, GitHub, Microsoft, Okta and other providers are set when you launch
              (<code>./launch.sh</code> asks, or see <code>docs/auth.md</code>), since they need secret keys.</p>
          </section>
        }

        <section class="card-surface stack">
          <h2>Your data</h2>
          <p>Everything stays on the computer or server running this app. Nothing is sent anywhere else, except
            GIF searches (to Tenor, if turned on) and signing in with a provider you set up.</p>
          @if (d.storage.location) {
            <p>It's kept in <code>{{ d.storage.location }}</code>.</p>
          } @else {
            <ul class="muted small">
              <li>Database: <code>{{ d.storage.database }}</code></li>
              <li>Uploads: <code>{{ d.storage.uploads }}</code></li>
            </ul>
          }
          <p class="muted small"><code>./launch.sh backup</code> saves everything to one file in <code>backups/</code>.</p>
        </section>

        <div class="row end sticky-save">
          <button type="button" class="btn primary" (click)="save()" [disabled]="saving() || !dirty()">Save changes</button>
        </div>
      </div>
    } @else {
      <p class="muted">Loading…</p>
    }
  `,
})
export class Customize {
  protected auth = inject(AuthService);
  private api = inject(Api);
  private toast = inject(ToastService);
  protected data = signal<InstanceSettingsAdminDto | null>(null);
  protected saving = signal(false);
  protected form: InstanceSettings = null!;
  private loaded = '';
  protected colorPresets = COLOR_PRESETS;
  protected draftName = '';
  protected draftColumns: ColumnSpec[] = [];

  protected instanceTemplates = computed(() => this.data()?.templates.filter(t => t.instance) ?? []);

  constructor() {
    void this.load();
    this.resetDraft();
  }

  async load(dto?: InstanceSettingsAdminDto) {
    const d = dto ?? await this.api.get<InstanceSettingsAdminDto>('/api/admin/settings');
    this.form = structuredClone(d.settings);
    this.loaded = JSON.stringify(d.settings);
    this.data.set(d);
  }

  protected selectedTemplate(): TemplateDto | undefined {
    return this.data()?.templates.find(t => t.id === this.form.defaultTemplateId);
  }

  protected dirty() {
    return JSON.stringify(this.form) !== this.loaded;
  }

  protected overridden(key: Key) {
    return this.data()?.overridden.includes(key) ?? false;
  }

  /** "Launch setting: …" so people know what Reset goes back to */
  protected hint(key: Key): string {
    const d = this.data()!.launchDefaults;
    const v = d[key];
    const shown = key === 'theme' ? (v ? (v as ThemePreference).preset : 'light or dark') :
      key === 'defaultTemplateId' ? this.data()!.templates.find(t => t.id === v)?.name ?? v :
      key === 'allowAnonymous' ? `anonymous ${v ? 'on' : 'off'}` : v;
    return `${this.overridden(key) ? 'Changed here. ' : ''}Launch setting: ${shown}.`;
  }

  protected useSiteTheme() {
    const p = THEME_PRESETS[0];
    this.form.theme = this.data()?.launchDefaults.theme ?? { preset: p.id, tokens: { ...p.tokens } };
  }

  async save() {
    this.saving.set(true);
    try {
      const was = JSON.parse(this.loaded) as InstanceSettings;
      const changed = Object.fromEntries(
        (Object.keys(this.form) as Key[]).filter(k => JSON.stringify(this.form[k]) !== JSON.stringify(was[k])).map(k => [k, this.form[k]]),
      );
      await this.load(await this.api.patch<InstanceSettingsAdminDto>('/api/admin/settings', changed));
      await this.auth.refresh();
      this.toast.show('Saved. Everyone sees the changes on their next page load.');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.saving.set(false);
    }
  }

  async reset(...keys: Key[]) {
    try {
      await this.load(await this.api.patch<InstanceSettingsAdminDto>('/api/admin/settings', { reset: keys }));
      await this.auth.refresh();
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected addDraftColumn() {
    this.draftColumns.push({ title: '', color: COLOR_PRESETS[this.draftColumns.length % COLOR_PRESETS.length] });
  }

  private resetDraft() {
    this.draftName = '';
    this.draftColumns = [];
    for (let i = 0; i < 3; i++) this.addDraftColumn();
  }

  async createTemplate() {
    try {
      await this.api.post('/api/admin/templates', { name: this.draftName.trim(), columns: this.draftColumns.map(c => ({ ...c, title: c.title.trim() })) });
      this.resetDraft();
      await this.reloadKeepingEdits();
      this.toast.show('Template added. Every team can pick it now.');
    } catch (err) {
      this.toast.error(err);
    }
  }

  async deleteTemplate(t: TemplateDto) {
    if (!confirm(`Delete the template "${t.name}"? Boards already made from it keep their columns.`)) return;
    try {
      await this.api.delete(`/api/templates/${t.id}`);
      await this.reloadKeepingEdits();
    } catch (err) {
      this.toast.error(err);
    }
  }

  /** Refreshes the template list without throwing away unsaved edits above */
  private async reloadKeepingEdits() {
    const d = await this.api.get<InstanceSettingsAdminDto>('/api/admin/settings');
    this.data.set(d);
  }
}
