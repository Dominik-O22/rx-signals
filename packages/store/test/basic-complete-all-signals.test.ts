import { beforeEach, describe, expect, it } from 'vitest';
import { merge, type Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Store, getEventId, getStateId } from '../src';
import { expectSequence } from './test-utils';
import { isSubscribed } from '../src/testing';

describe('completeAllSignals', () => {
  let store: Store;
  let calculationCalled = 0;

  const calculator = (input: number): number => {
    calculationCalled = calculationCalled + 1;
    return input * 2;
  };

  const id = getStateId<number>();
  const calculateEvent = getEventId<void>();

  let observable: Observable<number>;

  beforeEach((): void => {
    store = new Store();
    calculationCalled = 0;

    store.addState(id, 1);
    store.addReducer(id, calculateEvent, calculator);

    observable = store.getBehavior(id);
  });

  it('should not do anything after a call to completeAllSignals', async () => {
    const sequence = expectSequence(observable, [1, 2, 4, 8]);
    store.dispatch(calculateEvent);
    store.dispatch(calculateEvent);
    store.dispatch(calculateEvent);
    await sequence;
    await expectSequence(observable, [8]);
    expect(calculationCalled).toBe(3);
    expect(isSubscribed(store, calculateEvent)).toBe(true);

    store.completeAllSignals();
    expect(isSubscribed(store, calculateEvent)).toBe(false);
    const sequence2 = expectSequence(
      merge(store.getEventStream(calculateEvent).pipe(map(() => 3)), observable),
      [3, 3],
    );
    store.dispatch(calculateEvent);
    store.dispatch(calculateEvent);
    await sequence2;
    expect(calculationCalled).toBe(3);
    expect(isSubscribed(store, calculateEvent)).toBe(false);
  });
});
