import { beforeEach, describe, expect, it } from 'vitest';
import { map, withLatestFrom } from 'rxjs/operators';
import { Store, getDerivedId, getEventId } from '../src';
import { expectSequence } from './test-utils';
import { isSubscribed } from '../src/testing';
describe('Cyclic dependencies all lazy', () => {
  const cyclicBehavior = getDerivedId<number>();
  const derivedBehavior = getDerivedId<number>();
  const inputEvent = getEventId<number>();

  let store: Store;

  beforeEach(() => {
    store = new Store();

    // derivedBehavior depends on cyclicBehavior && cyclicBehavior depends on derivedBehavior

    store.addDerivedState(
      cyclicBehavior,
      store
        .getEventStream(inputEvent)
        .pipe(withLatestFrom(store.getBehavior(derivedBehavior).pipe(map(val => val * 10))))
        .pipe(map(pair => pair[0] * pair[1])),
      1,
    );

    store.addDerivedState(
      derivedBehavior,
      store.getBehavior(cyclicBehavior).pipe(map(val => val * 10)),
    );
  });

  it('should have correct initial value', async () => {
    expect(isSubscribed(store, cyclicBehavior)).toBe(false);
    expect(isSubscribed(store, derivedBehavior)).toBe(false);
    expect(isSubscribed(store, inputEvent)).toBe(false);

    await expectSequence(store.getBehavior(derivedBehavior), [10]);

    expect(isSubscribed(store, cyclicBehavior)).toBe(false);
    expect(isSubscribed(store, derivedBehavior)).toBe(false);
    expect(isSubscribed(store, inputEvent)).toBe(false);
  });

  it('should get correct value on first dispatch', async () => {
    expect(isSubscribed(store, cyclicBehavior)).toBe(false);
    expect(isSubscribed(store, derivedBehavior)).toBe(false);
    expect(isSubscribed(store, inputEvent)).toBe(false);

    const sequence = expectSequence(store.getBehavior(derivedBehavior), [10, 1000]);

    expect(isSubscribed(store, cyclicBehavior)).toBe(true);
    expect(isSubscribed(store, derivedBehavior)).toBe(true);
    expect(isSubscribed(store, inputEvent)).toBe(true);

    store.dispatch(inputEvent, 1);

    await sequence;

    expect(isSubscribed(store, cyclicBehavior)).toBe(false);
    expect(isSubscribed(store, derivedBehavior)).toBe(false);
    expect(isSubscribed(store, inputEvent)).toBe(false);
  });

  it('should not change, if second event sent while unsubscribed', async () => {
    const sequence = expectSequence(store.getBehavior(derivedBehavior), [10, 1000]);

    store.dispatch(inputEvent, 1);

    await sequence;

    await store.dispatch(inputEvent, 2);

    await expectSequence(store.getBehavior(derivedBehavior), [1000]);
  });

  it('should get correct value on dispatch after resubscribe', async () => {
    const sequence = expectSequence(store.getBehavior(derivedBehavior), [10, 1000]);

    store.dispatch(inputEvent, 1);

    await sequence;

    await store.dispatch(inputEvent, 2);

    const sequence2 = expectSequence(store.getBehavior(derivedBehavior), [1000, 300000]);

    await store.dispatch(inputEvent, 3);

    await sequence2;
  });
});
