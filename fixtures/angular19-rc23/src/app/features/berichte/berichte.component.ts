import { Component, OnInit } from '@angular/core';
import { BehaviorId, Store } from '@rx-signals/store';
import { Observable } from 'rxjs';
import { currentUserState } from '../../core/app.signals';
import { BerichtEintrag, BerichtFilter, User } from '../../core/models';
import { SelftestService } from '../../selftest/selftest.service';
import {
  berichtClosed,
  berichtFilterSignals,
  berichtListe,
  berichtSelected,
  berichtTitel,
  selectedBerichtState,
} from './berichte.signals';

@Component({
  selector: 'app-berichte',
  standalone: false,
  templateUrl: './berichte.component.html',
})
export class BerichteComponent implements OnInit {
  /** Child state: filter and selection live only in the BerichteModule child store. */
  readonly filter$: Observable<BerichtFilter>;
  readonly selected$: Observable<string | null>;
  readonly liste$: Observable<ReadonlyArray<BerichtEintrag>>;
  /** Combines child and parent state. */
  readonly titel$: Observable<string>;
  /** Parent (root store) state, read through the child store. */
  readonly user$: Observable<User | null>;

  constructor(
    private readonly store: Store,
    private readonly selftest: SelftestService,
  ) {
    this.filter$ = this.read(berichtFilterSignals.output.model);
    this.selected$ = this.read(selectedBerichtState);
    this.liste$ = this.read(berichtListe);
    this.titel$ = this.read(berichtTitel);
    this.user$ = this.read(currentUserState);
  }

  ngOnInit(): void {
    this.selftest.attachBerichteStore(this.store);
  }

  onZeitraumChange(zeitraum: BerichtFilter['zeitraum']): void {
    this.store.dispatch(berichtFilterSignals.input.updateModel, { zeitraum });
  }

  toggleNurEigene(nurEigene: boolean): void {
    this.store.dispatch(berichtFilterSignals.input.updateModel, { nurEigene });
  }

  open(bericht: BerichtEintrag): void {
    this.store.dispatch(berichtSelected, bericht.id);
  }

  close(): void {
    this.store.dispatch(berichtClosed);
  }

  private read<T>(id: BehaviorId<T>): Observable<T> {
    return this.store.getBehavior(id);
  }
}
