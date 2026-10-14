import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Store, ValidatedInputWithResult } from '@rx-signals/store';
import { Observable } from 'rxjs';
import {
  KostenstelleForm,
  KostenstelleSaveResult,
  KostenstelleValidation,
} from '../../core/models';
import {
  kostenstelleEditSignals,
  kostenstelleFieldChanged,
  kostenstelleFormReset,
} from './kostenstelle-edit.signals';
import { openKostenstelle } from './kostenstelle.effects';

export type KostenstelleEditVm = ValidatedInputWithResult<
  KostenstelleForm,
  KostenstelleValidation,
  KostenstelleSaveResult
>;

@Component({
  selector: 'app-kostenstelle-edit',
  standalone: true,
  imports: [AsyncPipe],
  templateUrl: './kostenstelle-edit.component.html',
})
export class KostenstelleEditComponent {
  private readonly store = inject(Store);

  readonly vm$: Observable<KostenstelleEditVm> = this.store.getBehavior(
    kostenstelleEditSignals.output.combined,
  );

  lastSaveDelivered: boolean | null = null;

  async load(nummer: string): Promise<void> {
    await openKostenstelle(this.store, nummer);
  }

  onTextChange(field: 'nummer' | 'bezeichnung' | 'verantwortlich', value: string): void {
    this.store.dispatch(kostenstelleFieldChanged, { [field]: value });
  }

  onBudgetChange(value: string): void {
    this.store.dispatch(kostenstelleFieldChanged, { budget: Number(value) });
  }

  /** Awaited so the button can tell whether the save trigger reached the factory. */
  async save(): Promise<void> {
    this.lastSaveDelivered = await this.store.dispatch(kostenstelleEditSignals.input.resultTrigger);
  }

  revalidate(): void {
    this.store.dispatch(kostenstelleEditSignals.input.validationInvalidate);
  }

  reset(): void {
    this.store.dispatch(kostenstelleFormReset);
  }
}
