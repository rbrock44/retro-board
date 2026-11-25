import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { BoardSummaryDto, TeamDto } from '@retro/shared';
import { Api } from '../core/api.service';
import { ExportService, type ExportFormat } from '../core/export.service';
import { ToastService } from '../core/toast.service';
import { Modal } from './modal';

interface TeamHistory { team: TeamDto; boards: BoardSummaryDto[] }

/**
 * "Export Retros": pick boards from each team's history (one team, or every team you're on), a format, and get
 * one file. Opened from Settings, from a team's History, and from a single past board in History.
 */
@Component({
  selector: 'app-export-dialog',
  imports: [FormsModule, Modal, DatePipe],
  template: `
    <app-modal heading="Export Retros" [wide]="true" (closed)="closed.emit()">
      <div class="stack">
        @if (loading()) {
          <p class="muted">Loading the history…</p>
        } @else if (!total()) {
          <p class="muted">There's nothing in the history yet. When a retro is done, use <strong>Archive Board</strong> on it,
            and it shows up here to export.</p>
        } @else {
          <fieldset class="export-format">
            <legend>Format</legend>
            <label class="row"><input type="radio" name="fmt" value="md" [(ngModel)]="format"> Markdown (.md): a readable summary</label>
            <label class="row"><input type="radio" name="fmt" value="csv" [(ngModel)]="format"> Spreadsheet (.csv): one row per card</label>
          </fieldset>

          @if (teams().length > 1) {
            <label class="row export-all">
              <input type="checkbox" [checked]="allChosen()" [indeterminate]="someChosen() && !allChosen()" (change)="chooseAll($any($event.target).checked)">
              <strong>All Teams</strong> <span class="muted">({{ total() }} boards)</span>
            </label>
          }

          <div class="export-teams">
            @for (t of teams(); track t.team.id) {
              <section class="export-team">
                <label class="row">
                  <input type="checkbox" [checked]="teamChosen(t) === 'all'" [indeterminate]="teamChosen(t) === 'some'"
                         [disabled]="!t.boards.length" (change)="chooseTeam(t, $any($event.target).checked)">
                  <strong>{{ t.team.name }}</strong>
                  <span class="muted">{{ t.boards.length ? t.boards.length + ' past ' + (t.boards.length === 1 ? 'board' : 'boards') : 'no past boards yet' }}</span>
                </label>
                @if (t.boards.length) {
                  <ul class="export-boards">
                    @for (b of t.boards; track b.id) {
                      <li><label class="row">
                        <input type="checkbox" [checked]="chosen().has(b.id)" (change)="toggle(b.id)">
                        <span class="grow">{{ b.title }}</span>
                        <span class="muted small">{{ b.cardCount }} cards · {{ (b.closedAt ?? b.createdAt) | date: 'mediumDate' }}</span>
                      </label></li>
                    }
                  </ul>
                }
              </section>
            }
          </div>
        }
        <div class="row end">
          <span class="muted small grow">{{ chosen().size }} {{ chosen().size === 1 ? 'board' : 'boards' }} selected</span>
          <button type="button" class="btn ghost" (click)="closed.emit()">Cancel</button>
          <button type="button" class="btn primary" (click)="run()" [disabled]="!chosen().size || busy()">Export</button>
        </div>
      </div>
    </app-modal>
  `,
})
export class ExportDialog {
  private api = inject(Api);
  private exporter = inject(ExportService);
  private toast = inject(ToastService);

  /** Only this team (from a team's History); every team when empty (from Settings) */
  readonly teamId = input<string | null>(null);
  /** Boards ticked to start with; everything in the history when empty */
  readonly preselect = input<string[]>([]);
  readonly closed = output<void>();

  protected loading = signal(true);
  protected busy = signal(false);
  protected teams = signal<TeamHistory[]>([]);
  protected chosen = signal(new Set<string>());
  protected format: ExportFormat = 'md';

  protected total = computed(() => this.teams().reduce((n, t) => n + t.boards.length, 0));
  protected allChosen = computed(() => this.total() > 0 && this.chosen().size === this.total());
  protected someChosen = computed(() => this.chosen().size > 0);

  constructor() {
    queueMicrotask(() => void this.load());
  }

  private async load() {
    try {
      const only = this.teamId();
      const teams = only ? [await this.api.get<TeamDto>(`/api/teams/${only}`)] : await this.api.get<TeamDto[]>('/api/teams');
      const withBoards = await Promise.all(teams.map(async team => ({
        team,
        // the history: everything that isn't a team's open (current) board, newest first
        boards: (await this.api.get<BoardSummaryDto[]>(`/api/teams/${team.id}/boards`)).filter(b => b.status !== 'open'),
      })));
      this.teams.set(withBoards);
      const ids = this.preselect().length ? this.preselect() : withBoards.flatMap(t => t.boards.map(b => b.id));
      this.chosen.set(new Set(ids));
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.loading.set(false);
    }
  }

  protected teamChosen(t: TeamHistory): 'all' | 'some' | 'none' {
    const n = t.boards.filter(b => this.chosen().has(b.id)).length;
    return n === 0 ? 'none' : n === t.boards.length ? 'all' : 'some';
  }

  protected toggle(id: string) {
    this.chosen.update(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  protected chooseTeam(t: TeamHistory, on: boolean) {
    this.chosen.update(s => {
      const next = new Set(s);
      for (const b of t.boards) if (on) next.add(b.id); else next.delete(b.id);
      return next;
    });
  }

  protected chooseAll(on: boolean) {
    this.chosen.set(new Set(on ? this.teams().flatMap(t => t.boards.map(b => b.id)) : []));
  }

  async run() {
    this.busy.set(true);
    try {
      await this.exporter.download([...this.chosen()], this.format);
      this.closed.emit();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }
}
