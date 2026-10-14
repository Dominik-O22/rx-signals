import { Store } from '@rx-signals/store';
import { filter, firstValueFrom } from 'rxjs';
import {
  appHeader,
  appStoreSetup,
  auditLogState,
  currentUserState,
  notificationAdded,
  notificationsState,
  userLoggedIn,
  userLoggedOut,
} from './app.signals';
import { User } from './models';

const petra: User = { id: 'u-100', name: 'Petra Lindner', roles: ['controller'] };

describe('appStoreSetup', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    appStoreSetup(store);
  });

  afterEach(() => store.completeAllSignals());

  it('derives the header from user, locale and notifications', async () => {
    await store.dispatch(userLoggedIn, petra);
    const header = await firstValueFrom(
      store.getBehavior(appHeader).pipe(filter(h => h.notificationCount === 1)),
    );
    expect(header).toEqual({ userName: 'Petra Lindner', locale: 'de', notificationCount: 1 });
  });

  it('emits a welcome notification and an audit entry for each login', async () => {
    await store.dispatch(userLoggedIn, petra);
    const audit = await firstValueFrom(
      store.getBehavior(auditLogState).pipe(filter(log => log.length > 0)),
    );
    const notifications = await firstValueFrom(store.getBehavior(notificationsState));
    expect(audit).toEqual(['login:u-100']);
    expect(notifications).toEqual([{ kind: 'info', text: 'Willkommen, Petra Lindner' }]);
  });

  it('clears user and notifications on logout', async () => {
    await store.dispatch(userLoggedIn, petra);
    await store.dispatch(notificationAdded, { kind: 'info', text: 'x' });
    await store.dispatch(userLoggedOut);
    expect(await firstValueFrom(store.getBehavior(currentUserState))).toBeNull();
    expect(await firstValueFrom(store.getBehavior(notificationsState))).toEqual([]);
  });
});
