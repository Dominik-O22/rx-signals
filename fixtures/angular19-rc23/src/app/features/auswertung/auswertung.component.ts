import { Component } from '@angular/core';
import { CombinedEffectResult, Store } from '@rx-signals/store';
import { Observable, combineLatest, map } from 'rxjs';
import { AuswertungErgebnis, AuswertungFilter, AuswertungZeile } from '../../core/models';
import { AuswertungSummary, Page } from './auswertung-signals.factory';
import { auswertungSignals } from './auswertung.signals';

type AuswertungVm = {
  result: CombinedEffectResult<AuswertungFilter, AuswertungErgebnis>;
  page: Page<AuswertungZeile>;
  summary: AuswertungSummary;
  pageIndexes: number[];
};

@Component({
  selector: 'app-auswertung',
  standalone: false,
  templateUrl: './auswertung.component.html',
})
export class AuswertungComponent {
  readonly vm$: Observable<AuswertungVm>;
  readonly filter$: Observable<AuswertungFilter>;

  constructor(private readonly store: Store) {
    this.filter$ = store.getBehavior(auswertungSignals.output.filter);
    this.vm$ = combineLatest([
      store.getBehavior(auswertungSignals.output.result),
      store.getBehavior(auswertungSignals.output.page),
      store.getBehavior(auswertungSignals.output.summary),
    ]).pipe(
      map(([result, page, summary]) => ({
        result,
        page,
        summary,
        pageIndexes: Array.from({ length: page.pageCount }, (_, i) => i),
      })),
    );
  }

  onJahrChange(value: string): void {
    this.store.dispatch(auswertungSignals.input.updateFilter, { jahr: Number(value) });
  }

  onKostenstelleChange(kostenstelle: string): void {
    this.store.dispatch(auswertungSignals.input.updateFilter, { kostenstelle });
  }

  onSortierungChange(sortierung: AuswertungFilter['sortierung']): void {
    this.store.dispatch(auswertungSignals.input.updateFilter, { sortierung });
  }

  refresh(): void {
    this.store.dispatch(auswertungSignals.input.refresh);
  }

  showPage(index: number): void {
    this.store.dispatch(auswertungSignals.input.setPage, index);
  }

  async resetAndReload(): Promise<void> {
    await this.store.dispatch(auswertungSignals.input.resetFilter);
    this.store.dispatch(auswertungSignals.input.invalidate);
  }
}
