import { LifecycleHandle, Store } from '@rx-signals/store';
import { filter, firstValueFrom, of } from 'rxjs';
import { appStoreSetup } from '../../core/app.signals';
import { loadAuswertungEffect } from '../../core/app-effects.service';
import { AuswertungErgebnis, AuswertungFilter } from '../../core/models';
import { getAuswertungSignalsFactory } from './auswertung-signals.factory';

const ERGEBNIS: AuswertungErgebnis = {
  zeilen: [
    { konto: '4000', bezeichnung: 'Personal', betrag: 500 },
    { konto: '4100', bezeichnung: 'Reisen', betrag: 900 },
    { konto: '4200', bezeichnung: 'Software', betrag: 100 },
    { konto: '4300', bezeichnung: 'Miete', betrag: 700 },
  ],
  summe: 2200,
};

describe('getAuswertungSignalsFactory', () => {
  const signals = getAuswertungSignalsFactory().build({
    defaultFilter: { jahr: 2024, kostenstelle: 'KST-100', sortierung: 'konto' },
    debounceMs: 0,
    nameExtension: 'spec',
  });
  let store: Store;
  let requests: AuswertungFilter[];
  let lifecycle: LifecycleHandle;

  beforeEach(() => {
    store = new Store();
    appStoreSetup(store);
    requests = [];
    store.addEffect(loadAuswertungEffect, input => {
      requests.push(input);
      return of(ERGEBNIS);
    });
    lifecycle = store.getLifecycleHandle(s => signals.setup(s));
  });

  afterEach(() => lifecycle.end());

  const loadedResult = () =>
    firstValueFrom(
      store
        .getBehavior(signals.output.result)
        .pipe(filter(r => r.resultInput !== undefined && !r.resultPending)),
    );

  it('does not load until refresh is dispatched', async () => {
    const result = loadedResult();
    await store.dispatch(signals.input.updateFilter, { jahr: 2023 });
    expect(requests).toEqual([]);

    await store.dispatch(signals.input.refresh);
    expect((await result).result).toEqual(ERGEBNIS);
    expect(requests).toEqual([{ jahr: 2023, kostenstelle: 'KST-100', sortierung: 'konto' }]);
  });

  it('pages rows sorted by the filter, using the configured page size', async () => {
    const page = firstValueFrom(
      store.getBehavior(signals.output.page).pipe(filter(p => p.items.length > 0)),
    );
    await store.dispatch(signals.input.updateFilter, { sortierung: 'betrag' });
    await store.dispatch(signals.input.refresh);
    expect((await page).items.map(z => z.konto)).toEqual(['4100', '4300', '4000']);
    expect((await page).pageCount).toBe(2);
  });

  it('restores the default filter on lifecycle reset', async () => {
    await store.dispatch(signals.input.updateFilter, { jahr: 2020 });
    lifecycle.reset();
    const restored = await firstValueFrom(store.getBehavior(signals.output.filter));
    expect(restored).toEqual({ jahr: 2024, kostenstelle: 'KST-100', sortierung: 'konto' });
  });
});
