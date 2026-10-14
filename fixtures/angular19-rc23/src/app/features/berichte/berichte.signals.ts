import {
  getDerivedId,
  getEventId,
  getModelSignalsFactory,
  getStateId,
  Store,
} from '@rx-signals/store';
import { combineLatest, map, of, switchMap, take } from 'rxjs';
import { loadBerichteEffect } from '../../core/app-effects.service';
import { currentUserState, localeState } from '../../core/app.signals';
import { BerichtEintrag, BerichtFilter } from '../../core/models';

export const berichtFilterSignals = getModelSignalsFactory<BerichtFilter>().build({
  defaultModel: { zeitraum: 'monat', nurEigene: true },
  nameExtension: 'berichtFilter',
});

export const selectedBerichtState = getStateId<string | null>('selectedBericht');
export const berichtSelected = getEventId<string>('berichtSelected');
export const berichtClosed = getEventId<undefined>('berichtClosed');

/** Reads child state (filter) and parent state (user, locale) through the child store. */
export const berichtTitel = getDerivedId<string>('berichtTitel');
export const berichtListe = getDerivedId<ReadonlyArray<BerichtEintrag>>('berichtListe');

/** Passed to `RxSignalsStoreModule.withChildStore` in BerichteModule. */
export const berichteSetup = (store: Store): void => {
  berichtFilterSignals.setup(store);

  store.addState(selectedBerichtState, null);
  store.addReducer(selectedBerichtState, berichtSelected, (_, id) => id);
  store.addReducer(selectedBerichtState, berichtClosed, () => null);

  store.addDerivedState(
    berichtTitel,
    combineLatest([
      store.getBehavior(berichtFilterSignals.output.model),
      store.getBehavior(currentUserState),
      store.getBehavior(localeState),
    ]).pipe(
      map(([berichtFilter, user, locale]) => {
        const owner = berichtFilter.nurEigene ? (user?.name ?? '?') : '*';
        return locale === 'de'
          ? `Berichte (${berichtFilter.zeitraum}) fuer ${owner}`
          : `Reports (${berichtFilter.zeitraum}) for ${owner}`;
      }),
    ),
  );

  store.addDerivedState(
    berichtListe,
    combineLatest([
      store.getBehavior(berichtFilterSignals.output.model),
      store.getBehavior(currentUserState),
    ]).pipe(
      switchMap(([berichtFilter, user]) =>
        user === null
          ? of([])
          : store.getEffect(loadBerichteEffect).pipe(
              take(1),
              switchMap(effect => effect({ filter: berichtFilter, userId: user.id }, store)),
            ),
      ),
    ),
  );
};
