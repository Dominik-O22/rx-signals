import { Effect, getEffectId, Store } from '@rx-signals/store';
import { delay, firstValueFrom, map, of, switchMap, take } from 'rxjs';
import { ApiService } from '../../core/api.service';
import {
  KostenstelleForm,
  KostenstelleSaveResult,
  KostenstelleValidation,
} from '../../core/models';
import { kostenstelleEditSignals, kostenstelleLoaded } from './kostenstelle-edit.signals';

export const loadKostenstelleEffect = getEffectId<string, KostenstelleForm>('loadKostenstelle');

/** Client-side validation, registered as the edit factory's validation effect. */
export const validateKostenstelle: Effect<KostenstelleForm, KostenstelleValidation> = form => {
  const errors: NonNullable<KostenstelleValidation> = {};
  if (!/^KST-\d{3,4}$/.test(form.nummer)) {
    errors.nummer = 'Format KST-0000';
  }
  if (form.bezeichnung.trim().length < 3) {
    errors.bezeichnung = 'mindestens 3 Zeichen';
  }
  if (form.budget <= 0) {
    errors.budget = 'muss positiv sein';
  }
  return of(Object.keys(errors).length === 0 ? null : errors).pipe(delay(10));
};

/** The backend does not bump versions on repeated saves of the same Kostenstelle, so the client does. */
const saveKostenstelle =
  (api: ApiService): Effect<KostenstelleForm, KostenstelleSaveResult> =>
  (form, _store, previousInput, previousResult) =>
    api
      .saveKostenstelle(form)
      .pipe(
        map(saved =>
          previousInput?.nummer === form.nummer && previousResult
            ? { ...saved, version: previousResult.version + 1 }
            : saved,
        ),
      );

export const registerKostenstelleEffects = (store: Store, api: ApiService): void => {
  const loadKostenstelle: Effect<string, KostenstelleForm> = nummer => api.loadKostenstelle(nummer);
  store.addEffect(loadKostenstelleEffect, loadKostenstelle);
  store.addEffect(kostenstelleEditSignals.effects.validation, validateKostenstelle);
  store.addEffect(kostenstelleEditSignals.effects.result, saveKostenstelle(api));
};

/** Fetches a Kostenstelle through its effect and loads it into the edit form. */
export const openKostenstelle = async (store: Store, nummer: string): Promise<KostenstelleForm> => {
  const form = await firstValueFrom(
    store.getEffect(loadKostenstelleEffect).pipe(
      take(1),
      switchMap(effect => effect(nummer, store)),
    ),
  );
  await store.dispatch(kostenstelleLoaded, form);
  return form;
};
