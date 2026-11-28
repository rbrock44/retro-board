import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  COLOR_PRESETS, FEATURES, MAX_UPLOAD_MB_LIMIT, THEME_PRESETS, type FeatureKey, type Features,
  type ColumnSpec, type InstanceSettings, type InstanceSettingsAdminDto, type TemplateDto, type ThemePreference,
} from '@retro/shared';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { DemoService } from '../demo/demo.service';
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
      <div class="stack customize">
        <section class="card-surface stack">
          <h2>Name</h2>
          <label>Site name <input [(ngModel)]="form.siteName" maxlength="60"></label>
          <p class="muted small">{{ hint('siteName') }}
            @if (overridden('siteName')) { <button type="button" class="link-btn" (click)="reset('siteName')">Reset</button> }</p>
        </section>

        <section class="card-surface stack">
          <h2>Look</h2>
          <p class="muted">The colors everyone sees until they pick their own in Profile &amp; theme.</p>
          <label class="check"><input type="radio" name="themeMode" [checked]="!form.theme" (change)="form.theme = null"> Light or dark, following each person's device</label>
          <label class="check"><input type="radio" name="themeMode" [checked]="!!form.theme" (change)="useSiteTheme()"> One look for the whole site</label>
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

          <h3>Your Templates</h3>
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
            <summary>New Template</summary>
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
                <button type="button" class="btn small" (click)="createTemplate()" [disabled]="!draftName.trim() || !draftColumns.every(c => c.title.trim())">Add Template</button>
              </div>
            </div>
          </details>
        </section>

        <section class="card-surface stack">
          <div class="row"><h2>Features</h2><div class="spacer"></div>
            <button type="button" class="btn ghost small" (click)="setAllFeatures(true)">Turn All On</button></div>
          <p class="muted">Switch off anything your organization doesn't want, for every team. It's hidden in the app and the
            server refuses it too, so nobody can use it by going around the screen. Press ⓘ for what each one does.</p>
          @for (g of featureGroups; track g.name) {
            <fieldset class="feature-group">
              <legend>{{ g.name }}</legend>
              @for (f of g.items; track f.key) {
                <!-- One row, three columns: the switch, ⓘ, and the name; the explanation opens underneath -->
                <div class="feature-row">
                  <input type="checkbox" [id]="'feature-' + f.key" [checked]="form.features[f.key]"
                         (change)="setFeature(f.key, $any($event.target).checked)">
                  <button type="button" class="info-btn" [class.open]="infoOpen() === f.key" [attr.aria-expanded]="infoOpen() === f.key"
                          [attr.aria-label]="'About ' + f.label" [title]="f.info" (click)="infoOpen.set(infoOpen() === f.key ? null : f.key)">ⓘ</button>
                  <label [attr.for]="'feature-' + f.key" [class.off]="!form.features[f.key]">{{ f.label }}</label>
                  @if (infoOpen() === f.key) { <p class="feature-info" role="note">{{ f.info }}</p> }
                  @if ((f.key === 'images' && form.features.images) || (f.key === 'videos' && form.features.videos)) {
                    @let sizeKey = f.key === 'videos' ? 'maxVideoMb' : 'maxImageMb';
                    <div class="feature-sub">
                      <label class="size-limit">Largest {{ f.key === 'videos' ? 'video' : 'image or GIF' }}
                        <input type="number" min="1" [max]="sizeLimit" step="1" [(ngModel)]="form[sizeKey]"> MB</label>
                      <p class="muted small">{{ hint(sizeKey) }}
                        @if (overridden(sizeKey)) { <button type="button" class="link-btn" (click)="reset(sizeKey)">Reset</button> }</p>
                    </div>
                  }
                  @if (f.key === 'anonymous' && form.features.anonymous) {
                    <div class="feature-sub">
                      <label class="check"><input type="checkbox" [(ngModel)]="form.allowAnonymous"> On by default for new boards</label>
                      <p class="muted small">Facilitators can change it per board. {{ hint('allowAnonymous') }}
                        @if (overridden('allowAnonymous')) { <button type="button" class="link-btn" (click)="reset('allowAnonymous')">Reset</button> }</p>
                    </div>
                  }
                </div>
              }
            </fieldset>
          }
          <p class="muted small">{{ featuresHint() }}
            @if (overridden('features')) { <button type="button" class="link-btn" (click)="reset('features')">Reset</button> }</p>
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
          <h2>Your Data</h2>
          <p>Everything stays on the computer or server running this app. Nothing is sent anywhere else, except
            GIF searches (to Giphy or Tenor, if turned on) and signing in with a provider you set up.</p>
          @if (d.storage.location) {
            <p>It's kept in <code>{{ d.storage.location }}</code>.</p>
          } @else {
            <ul class="muted small">
              <li>Database: <code>{{ d.storage.database }}</code></li>
              <li>Uploads: <code>{{ d.storage.uploads }}</code></li>
            </ul>
          }
          @if (demo.active()) {
            <p class="muted small">Backups aren't available in the demo: its data lives in this browser. Use Share to keep a copy.</p>
          } @else {
            <h3>Backup and Restore</h3>
            <p class="muted small">One file with every team, board, card, person and upload. Keep it somewhere safe: it holds everyone's
              data, including sign-in details. Restore it here on this or any other Retro Board, such as when moving to a server.</p>
            <div class="row wrap">
              <a class="btn" href="/api/admin/backup" download>Download Backup</a>
              <label class="btn ghost danger" [class.disabled]="restoring()">{{ restoring() ? 'Restoring…' : 'Restore from Backup…' }}
                <input type="file" accept=".gz,.tgz,application/gzip" hidden [disabled]="restoring()" (change)="restore($event)"></label>
            </div>
            <p class="muted small">Restoring <strong>replaces everything</strong> here with the backup, and everyone signs in again.
              A <code>./launch.sh backup</code> file goes back with <code>./launch.sh restore</code> instead.</p>
          }
        </section>

        <div class="row end sticky-save">
          <button type="button" class="btn primary" (click)="save()" [disabled]="saving() || !dirty()">Save Changes</button>
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
  protected demo = inject(DemoService);
  protected restoring = signal(false);

  /** Replaces all data with a backup file, then starts over (the restore signs everyone out) */
  async restore(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!confirm(`Replace ALL data here with the backup "${file.name}"?

Every team, board and person here now is removed and the backup's take their place. Everyone signs in again afterwards. This can't be undone, so download a backup first if you might want today's data.`)) return;
    this.restoring.set(true);
    try {
      const r = await this.api.upload<{ rows: number; files: number }>('/api/admin/restore', file);
      alert(`Restored: ${r.rows} records and ${r.files} files. Sign in again to continue.`);
      location.href = '/';
    } catch (err) {
      this.toast.error(err);
      this.restoring.set(false);
    }
  }
  protected data = signal<InstanceSettingsAdminDto | null>(null);
  protected saving = signal(false);
  protected form: InstanceSettings = null!;
  protected sizeLimit = MAX_UPLOAD_MB_LIMIT;
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
      key === 'allowAnonymous' ? `anonymous ${v ? 'on' : 'off'}` :
      key === 'maxImageMb' || key === 'maxVideoMb' ? `${v} MB` : v;
    return `${this.overridden(key) ? 'Changed here. ' : ''}Launch setting: ${shown}.`;
  }

  /** The features list, in the groups the page shows */
  protected featureGroups = (['Media', 'Cards', 'Retros', 'People'] as const).map(name => ({ name, items: FEATURES.filter(f => f.group === name) }));
  protected infoOpen = signal<FeatureKey | null>(null);

  protected setFeature(key: FeatureKey, on: boolean) {
    this.form.features = { ...this.form.features, [key]: on };
  }

  protected setAllFeatures(on: boolean) {
    this.form.features = Object.fromEntries(FEATURES.map(f => [f.key, on])) as Features;
  }

  protected featuresHint(): string {
    const off = FEATURES.filter(f => !this.data()!.launchDefaults.features[f.key]).map(f => f.label);
    return `${this.overridden('features') ? 'Changed here. ' : ''}Launch setting: ${off.length ? off.join(', ') + ' off' : 'everything on'}.`;
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
