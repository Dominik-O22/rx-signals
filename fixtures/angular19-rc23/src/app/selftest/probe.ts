import { BehaviorId, EventId, Store } from '@rx-signals/store';
import { Observable, Subscription, filter, firstValueFrom, throwError, timeout } from 'rxjs';

const WAIT_TIMEOUT_MS = 4000;

/** Resolves with the first value matching `until`; rejects with `label` if none arrives in time. */
export const waitFor = <T>(
  source: Observable<T>,
  label: string,
  until: (value: T) => boolean = () => true,
): Promise<T> =>
  firstValueFrom(
    source.pipe(
      filter(until),
      timeout({
        first: WAIT_TIMEOUT_MS,
        with: () => throwError(() => new Error(`selftest timed out waiting for ${label}`)),
      }),
    ),
  );

export const waitForBehavior = <T>(
  store: Store,
  id: BehaviorId<T>,
  label: string,
  until?: (value: T) => boolean,
): Promise<T> => waitFor(store.getBehavior(id), label, until);

/** Collects every event of `id` into `sink` until the returned subscription ends. */
export const recordEvents = <T>(store: Store, id: EventId<T>, sink: T[]): Subscription =>
  store.getEventStream(id).subscribe(event => sink.push(event));

/** Lazy (derived) behaviors only compute while subscribed, so the self-test holds them open. */
export const keepHot = (store: Store, ids: ReadonlyArray<BehaviorId<unknown>>): Subscription => {
  const hot = new Subscription();
  ids.forEach(id => hot.add(store.getBehavior(id).subscribe()));
  return hot;
};

export const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
