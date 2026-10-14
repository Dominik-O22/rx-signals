import { Store } from '@rx-signals/store';
import { filter, firstValueFrom, of } from 'rxjs';
import { loadBerichteEffect } from '../../core/app-effects.service';
import { appStoreSetup, localeChanged, userLoggedIn } from '../../core/app.signals';
import {
  berichteSetup,
  berichtFilterSignals,
  berichtListe,
  berichtTitel,
} from './berichte.signals';

describe('berichteSetup in a child store', () => {
  let root: Store;
  let child: Store;

  beforeEach(async () => {
    root = new Store();
    appStoreSetup(root);
    root.addEffect(loadBerichteEffect, ({ filter: f, userId }) =>
      of([{ id: 'B-1', titel: `Bericht ${userId}`, zeitraum: f.zeitraum }]),
    );
    child = root.createChildStore();
    berichteSetup(child);
    await root.dispatch(userLoggedIn, { id: 'u-200', name: 'Jonas Weber', roles: ['viewer'] });
  });

  afterEach(() => root.completeAllSignals());

  it('builds the title from child filter and root user and locale', async () => {
    expect(await firstValueFrom(child.getBehavior(berichtTitel))).toBe(
      'Berichte (monat) fuer Jonas Weber',
    );
    await root.dispatch(localeChanged, 'en');
    expect(await firstValueFrom(child.getBehavior(berichtTitel))).toBe(
      'Reports (monat) for Jonas Weber',
    );
  });

  it('loads reports through the root effect when the child filter changes', async () => {
    const quartal = firstValueFrom(
      child.getBehavior(berichtListe).pipe(filter(l => l[0]?.zeitraum === 'quartal')),
    );
    await child.dispatch(berichtFilterSignals.input.updateModel, { zeitraum: 'quartal' });
    expect(await quartal).toEqual([{ id: 'B-1', titel: 'Bericht u-200', zeitraum: 'quartal' }]);
  });
});
