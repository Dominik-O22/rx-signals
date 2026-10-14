import { concat, config, defer, delay, NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDerivedId,
  getEventId,
  getStateId,
  type NoIds,
  SignalsFactory,
  Store,
  type DerivedId,
  type StoreError,
} from '../src';
import { getNumberOfBehaviorSources, settle } from '../src/testing';

// Semantics synthesis.md pins for v4 that the ported suites do not already cover.

const collect =
  <T>(values: T[]) =>
  (value: T) => {
    values.push(value);
  };

describe('error policy', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a state when its eager feed errors and reports the feed', () => {
    const errors: StoreError[] = [];
    const store = new Store({ onError: collect(errors) });
    const state = getStateId<number>();
    const feed = new Subject<number>();
    store.connectObservable(feed, state);
    const seen: number[] = [];
    store.getBehavior(state).subscribe(collect(seen));
    feed.next(1);
    feed.error('boom');
    expect(seen).toEqual([1]);
    expect(errors).toEqual([{ origin: 'state-feed', state, cause: 'boom' }]);
  });

  it('rethrows asynchronously when neither onError nor rxjs onUnhandledError is set', () => {
    vi.useFakeTimers();
    expect(config.onUnhandledError).toBeNull();
    const store = new Store();
    const state = getStateId<number>();
    store.connectObservable(
      throwError(() => new Error('feed failed')),
      state,
    );
    expect(() => vi.runOnlyPendingTimers()).toThrow('feed failed');
  });

  it('errors current derived subscribers, keeps the value, and retries on the next demand', () => {
    const store = new Store();
    const derived = getDerivedId<number>();
    const sources: Subject<number>[] = [];
    store.addDerivedState(
      derived,
      defer(() => {
        const source = new Subject<number>();
        sources.push(source);
        return source;
      }),
    );
    const failures: unknown[] = [];
    store.getBehavior(derived).subscribe({ error: collect(failures) });
    sources[0]?.next(1);
    sources[0]?.error('broken');
    expect(failures).toEqual(['broken']);

    const seen: number[] = [];
    store.getBehavior(derived).subscribe(collect(seen));
    expect(seen).toEqual([1]);
    expect(sources.length).toBe(2);
  });
});

describe('dispatch', () => {
  it('resolves after its own delivery, also for payloads that are not equal to themselves', async () => {
    const store = new Store();
    const event = getEventId<number>();
    const seen: number[] = [];
    store.getEventStream(event).subscribe(collect(seen));
    const delivered = store.dispatch(event, NaN).then(result => [result, seen.length]);
    expect(seen).toEqual([]);
    expect(await delivered).toEqual([true, 1]);
  });

  it('resolves false without rejecting when nobody listens', async () => {
    const store = new Store();
    await expect(store.dispatch(getEventId<undefined>())).resolves.toBe(false);
  });
});

describe('event queue', () => {
  it('gives typed and plain sources the same single queue hop', async () => {
    const store = new Store();
    const plain = getEventId<string>();
    const typed = getEventId<string>();
    const order: string[] = [];
    store.getEventStream(plain).subscribe(collect(order));
    store.getEventStream(typed).subscribe(collect(order));
    store.addTypedEventSource([typed], of({ type: typed, event: 'typed' }));
    store.addEventSource(plain, of('plain'));
    void store.dispatch(plain, 'dispatched');
    expect(order).toEqual([]);
    await settle(store);
    expect(order).toEqual(['typed', 'plain', 'dispatched']);
  });

  it('delivers in dispatch order across parent and child stores', async () => {
    const parent = new Store();
    const child = parent.createChildStore();
    const event = getEventId<string>();
    const seen: string[] = [];
    child.getEventStream(event).subscribe(collect(seen));
    void child.dispatch(event, 'child 1');
    void parent.dispatch(event, 'parent 1');
    void child.dispatch(event, 'child 2');
    await settle(parent);
    expect(seen).toEqual(['child 1', 'parent 1', 'child 2']);
  });
});

describe('first subscriber of a derived behavior', () => {
  it('sees a synchronous source fresh', () => {
    const store = new Store();
    const derived = getDerivedId<number>();
    let next = 1;
    store.addDerivedState(
      derived,
      defer(() => concat(of(next++), NEVER)),
    );
    store.getBehavior(derived).subscribe().unsubscribe();
    const seen: number[] = [];
    store.getBehavior(derived).subscribe(collect(seen));
    expect(seen).toEqual([2]);
  });

  it('sees the cached value first, then the fresh one, for an asynchronous source', async () => {
    const store = new Store();
    const derived = getDerivedId<number>();
    let next = 1;
    store.addDerivedState(
      derived,
      defer(() => concat(of(next++).pipe(delay(5)), NEVER)),
    );
    const first: number[] = [];
    const subscription = store.getBehavior(derived).subscribe(collect(first));
    await new Promise(resolve => setTimeout(resolve, 10));
    subscription.unsubscribe();
    expect(first).toEqual([1]);

    const second: number[] = [];
    store.getBehavior(derived).subscribe(collect(second));
    expect(second).toEqual([1]);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(second).toEqual([1, 2]);
  });
});

describe('lifecycles', () => {
  it('own every registration made on the store during the callback, reducers included', async () => {
    const store = new Store();
    const state = getStateId<number>();
    const add = getEventId<number>();
    store.addState(state, 0);
    const handle = store.getLifecycleHandle(lifecycleStore => {
      lifecycleStore.addReducer(state, add, (value, delta) => value + delta);
    });
    const seen: number[] = [];
    store.getBehavior(state).subscribe(collect(seen));
    await store.dispatch(add, 2);
    handle.end();
    handle.end();
    await store.dispatch(add, 3);
    expect(seen).toEqual([0, 2]);
    expect(getNumberOfBehaviorSources(store, state)).toBe(1);
  });
});

describe('SignalsFactory config', () => {
  type Named = { name: string };
  const named = new SignalsFactory<NoIds, { name: DerivedId<string> }, Named>(config => {
    const name = getDerivedId<string>();
    return {
      input: {},
      output: { name },
      effects: {},
      setup: store => {
        store.addDerivedState(name, NEVER, config.name);
      },
    };
  });

  const read = (store: Store, ...ids: DerivedId<string>[]) => {
    const names: string[] = [];
    ids.forEach(id => store.getBehavior(id).subscribe(collect(names)));
    return names;
  };

  it('shares one config between composed factories', () => {
    const store = new Store();
    const { output, setup } = named.compose(named).build({ name: 'shared' });
    setup(store);
    expect(read(store, output.conflicts1.name, output.conflicts2.name)).toEqual([
      'shared',
      'shared',
    ]);
  });

  // rc23 guessed the routing with `config.c1 ?? config` and handed `left` to the right side here.
  it('routes nested configs to their side, also when a side is itself composed', () => {
    const store = new Store();
    const { output, setup } = named
      .compose(named)
      .nestConfig('c1')
      .compose(named.nestConfig('c2'))
      .build({ c1: { name: 'left' }, c2: { name: 'right' } });
    setup(store);
    expect(read(store, output.conflicts1.name, output.conflicts2.name, output.name)).toEqual([
      'left',
      'left',
      'right',
    ]);
  });
});
