import {
  BehaviorId,
  DerivedId,
  EventId,
  getDerivedId,
  getEventId,
  getStateId,
  StateId,
  Store,
  TypedEvent,
} from '@rx-signals/store';
import { combineLatest, delay, map, of, switchMap } from 'rxjs';
import { AppConfig, AppHeader, AppNotification, Locale, User } from './models';

const APP_CONFIG: AppConfig = { pageSize: 3, currency: 'EUR', environment: 'fixture' };

// Root state, shared by every feature through the root store.
export const currentUserState: StateId<User | null> = getStateId<User | null>('currentUser');
export const localeState = getStateId<Locale>('locale');
export const notificationsState = getStateId<ReadonlyArray<AppNotification>>('notifications');
export const auditLogState = getStateId<ReadonlyArray<string>>('auditLog');

export const appConfig: DerivedId<AppConfig> = getDerivedId<AppConfig>('appConfig');
export const lastLogin = getDerivedId<User>('lastLogin');
const appHeaderId = getDerivedId<AppHeader>('appHeader');
// Exposed as BehaviorId so features can read the header but cannot add sources to it.
export const appHeader: BehaviorId<AppHeader> = appHeaderId;

export const userLoggedIn: EventId<User> = getEventId<User>('userLoggedIn');
export const userLoggedOut = getEventId<undefined>('userLoggedOut');
export const localeChanged = getEventId<Locale>('localeChanged');
export const notificationAdded: EventId<AppNotification> =
  getEventId<AppNotification>('notificationAdded');
export const notificationDismissed = getEventId<number>('notificationDismissed');
export const auditEntryAdded = getEventId<string>('auditEntryAdded');

/** Passed to `RxSignalsStoreModule.withRootStore` in AppModule; specs call it on a fresh Store. */
export const appStoreSetup = (store: Store): void => {
  store.addState(currentUserState, null);
  store.addReducer(currentUserState, userLoggedIn, (_, user) => user);
  store.addReducer(currentUserState, userLoggedOut, () => null);

  store.addState(localeState, 'de');
  store.addReducer(localeState, localeChanged, (_, locale) => locale);

  store.addState(notificationsState, []);
  store.addReducer(notificationsState, notificationAdded, (list, notification) => [
    ...list,
    notification,
  ]);
  store.addReducer(notificationsState, notificationDismissed, (list, index) =>
    list.filter((_, i) => i !== index),
  );
  store.addReducer(notificationsState, userLoggedOut, () => []);

  store.addState(auditLogState, []);
  store.addReducer(auditLogState, auditEntryAdded, (log, entry) => [...log, entry]);

  // The real app loads this from /assets/config.json.
  store.connectObservable(of(APP_CONFIG).pipe(delay(5)), appConfig);
  store.connect(userLoggedIn, lastLogin);

  store.addDerivedState(
    appHeaderId,
    combineLatest([
      store.getBehavior(currentUserState),
      store.getBehavior(localeState),
      store.getBehavior(notificationsState),
    ]).pipe(
      map(([user, locale, notifications]) => ({
        userName: user?.name ?? null,
        locale,
        notificationCount: notifications.length,
      })),
    ),
  );

  store.add2TypedEventSource(
    notificationAdded,
    auditEntryAdded,
    store.getEventStream(userLoggedIn).pipe(
      switchMap(user => {
        const welcome: TypedEvent<AppNotification> = {
          type: notificationAdded,
          event: { kind: 'info', text: `Willkommen, ${user.name}` },
        };
        const audit: TypedEvent<string> = { type: auditEntryAdded, event: `login:${user.id}` };
        return of(welcome, audit);
      }),
    ),
  );
};
