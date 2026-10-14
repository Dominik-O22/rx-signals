import { config, of } from 'rxjs';
import { describe, expect, it, onTestFinished } from 'vitest';
import { Store, getEventId, getStateId } from '../src';
import { getNumberOfEventSources, settle } from '../src/testing';

// Behaviors that were broken in the published 3.0.0-rc23.

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('rc23 bugs', () => {
  // The leak was a per-event subscription inside the queue. The v4 queue holds plain tasks, so the
  // observable part left is that a completed source is delivered and released.
  it('releases an event source once it completed and was delivered', async () => {
    const store = new Store();
    const event = getEventId<number>();
    store.addEventSource(event, of(1, 2, 3));
    const seen: number[] = [];
    const subscription = store.getEventStream(event).subscribe(value => seen.push(value));
    await settle(store);
    subscription.unsubscribe();
    expect(seen).toEqual([1, 2, 3]);
    expect(getNumberOfEventSources(store, event)).toBe(0);
  });

  it('keeps state alive when a reducer throws', async () => {
    const store = new Store();
    const state = getStateId<number>();
    const add = getEventId<number>();
    store.addState(state, 0);
    store.addReducer(state, add, (value, delta) => {
      if (delta < 0) throw new Error('negative');
      return value + delta;
    });
    const seen: number[] = [];
    store.getBehavior(state).subscribe(value => seen.push(value));
    const reported: unknown[] = [];
    config.onUnhandledError = error => reported.push(error);
    onTestFinished(() => {
      config.onUnhandledError = null;
    });
    await store.dispatch(add, 1);
    await store.dispatch(add, -1);
    await store.dispatch(add, 2);
    await wait(10);
    expect(seen).toEqual([0, 1, 3]);
    expect(reported).toEqual([new Error('negative')]);
  });

  it('ends a lifecycle after it was reset', async () => {
    const store = new Store();
    const state = getStateId<number>();
    const set = getEventId<number>();
    const handle = store.getLifecycleHandle(lifecycleStore => {
      lifecycleStore.addState(state, 0);
      lifecycleStore.addReducer(state, set, (_, value) => value);
    });
    let completed = false;
    store.getBehavior(state).subscribe({ complete: () => (completed = true) });
    await store.dispatch(set, 5);
    handle.reset();
    handle.end();
    await wait(10);
    expect(completed).toBe(true);
  });

  it('switches child subscribers to state the child adds later', async () => {
    const parent = new Store();
    const child = parent.createChildStore();
    const state = getStateId<string>();
    parent.addState(state, 'parent');
    const seen: string[] = [];
    child.getBehavior(state).subscribe(value => seen.push(value));
    child.addState(state, 'child');
    await wait(10);
    expect(seen).toEqual(['parent', 'child']);
  });
});
