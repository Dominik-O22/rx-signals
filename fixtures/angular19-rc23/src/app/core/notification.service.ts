import { Injectable } from '@angular/core';
import { EventId, Store } from '@rx-signals/store';
import { Observable } from 'rxjs';
import { notificationAdded, notificationDismissed, notificationsState } from './app.signals';
import { AppNotification } from './models';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly notifications$: Observable<ReadonlyArray<AppNotification>>;
  /** Fires once per notification, for toasts. Unlike `notifications$` it never replays. */
  readonly added$: Observable<AppNotification>;

  constructor(private readonly store: Store) {
    this.notifications$ = store.getBehavior(notificationsState);
    this.added$ = store.getEventStream(notificationAdded);
  }

  info(text: string): void {
    this.emit(notificationAdded, { kind: 'info', text });
  }

  dismiss(index: number): void {
    this.emit(notificationDismissed, index);
  }

  private emit<T>(eventId: EventId<T>, event: T): void {
    this.store.dispatch(eventId, event);
  }
}
