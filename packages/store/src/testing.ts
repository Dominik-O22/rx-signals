// Entry `/testing`: inspection helpers that were Store methods in rc23, plus `settle`.
// Kept out of the main entry so they never reach a production bundle.
import { type Observable } from 'rxjs';
import { type AnyBehaviorId, type AnyEventId, type AnySignalId } from './ids';
import { inspectStore, type Store } from './store';

const demandOf = (store: Store, id: AnySignalId) =>
  id.kind === 'event'
    ? inspectStore(store).eventCell(id).demand
    : inspectStore(store).behaviorCell(id).value.demand;

/** True while the signal has a subscriber. A state with any source counts as subscribed. */
export const isSubscribed = (store: Store, id: AnySignalId): boolean =>
  demandOf(store, id).isDemanded;

/** Emits whether the signal is subscribed now, then every change. */
export const getIsSubscribedObservable = (store: Store, id: AnySignalId): Observable<boolean> =>
  demandOf(store, id).subscribed$;

/** For a state: one for the initial value or feed plus one per reducer. For a derived state: 0 or 1. */
export const getNumberOfBehaviorSources = (store: Store, id: AnyBehaviorId): number =>
  inspectStore(store).behaviorCell(id).sourceCount;

export const getNumberOfEventSources = (store: Store, id: AnyEventId): number =>
  inspectStore(store).eventCell(id).sourceCount;

/** Resolves once the store tree's event queue is empty. */
export const settle = (store: Store): Promise<void> => inspectStore(store).queue.whenIdle();
