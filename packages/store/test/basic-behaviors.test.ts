import { beforeEach, describe, expect, it } from 'vitest';
import { interval, NEVER, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Store, getDerivedId, getStateId } from '../src';
import { awaitCompletion, awaitError, expectSequence } from './test-utils';
import {
  getIsSubscribedObservable,
  getNumberOfBehaviorSources,
  isSubscribed,
} from '../src/testing';

describe('Behavior basics', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  describe('addLazyBehavior', () => {
    const testId = getDerivedId<number>();

    it('should throw, if behavior with given identifier already has a source', () => {
      store.addDerivedState(testId, NEVER);
      expect(() => {
        store.addDerivedState(testId, NEVER);
      }).toThrow(
        'A behavior or event source with the given identifier has already been added: D_1',
      );
    });
    it('should be possible to add behavior sources again, after initial source has completed', async () => {
      const isSubscribedSequence = expectSequence(getIsSubscribedObservable(store, testId), [
        false,
        true,
        false,
      ]);
      store.addDerivedState(testId, of(1));
      expect(isSubscribed(store, testId)).toBe(false);
      const sequence = expectSequence(store.getBehavior(testId), [1, 2]);
      expect(isSubscribed(store, testId)).toBe(true);
      store.addDerivedState(testId, of(2));
      await sequence;
      await isSubscribedSequence;
    });

    it('should subscribe its source lazily', async () => {
      expect(getNumberOfBehaviorSources(store, testId)).toBe(0);
      await expectSequence(getIsSubscribedObservable(store, testId), [false]);
      store.addDerivedState(testId, of(1));
      expect(getNumberOfBehaviorSources(store, testId)).toBe(1);
      const subscribeSequence = expectSequence(getIsSubscribedObservable(store, testId), [
        false,
        true,
        false,
      ]);
      await expectSequence(store.getBehavior(testId), [1]);
      await subscribeSequence;
    });
  });

  describe('addNonLazyBehavior', () => {
    const testId = getStateId<number>();

    it('should throw, if behavior with given identifier already has a source', () => {
      store.addState(testId, 42);
      expect(() => {
        store.addState(testId, 42);
      }).toThrow(
        'A behavior or event source with the given identifier has already been added: S_1',
      );
    });

    it('should always subscribe its source', async () => {
      expect(getNumberOfBehaviorSources(store, testId)).toBe(0);

      // no source -> nonLazy source
      const subscribeSequence1 = expectSequence(getIsSubscribedObservable(store, testId), [
        false,
        true,
      ]);
      store.addState(testId, 1);
      await subscribeSequence1;
    });
  });

  describe('removeBehaviorSources', () => {
    const testId = getDerivedId<number>();

    it('should work without completing target subscriptions', async () => {
      store.addDerivedState(testId, NEVER);
      const sequence = expectSequence(store.getBehavior(testId), [1, 2]);
      expect(getNumberOfBehaviorSources(store, testId)).toBe(1);
      store.removeBehaviorSources(testId);
      expect(getNumberOfBehaviorSources(store, testId)).toBe(0);
      store.addDerivedState(testId, of(1, 2));
      await sequence;
    });

    it('should propagate source errors and still work after re-subscribe', async () => {
      store.addDerivedState(
        testId,
        interval(10).pipe(
          map(val => {
            if (val === 3) {
              // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error throw must pass through as is
              throw 'ERROR';
            }
            return val;
          }),
        ),
      );
      await awaitError(store.getBehavior(testId));
      expect(getNumberOfBehaviorSources(store, testId)).toBe(1);
      await expectSequence(store.getBehavior(testId), [2, 0]); // v4: the last value survives the error, then the source restarts
    });
  });

  describe('completeBehavior', () => {
    const testId = getDerivedId<number>();

    it('should remove all sources, and complete the target', async () => {
      store.addDerivedState(
        testId,
        interval(10).pipe(
          tap(s => {
            if (s === 3) {
              store.completeBehavior(testId);
            }
          }),
        ),
      );

      await expectSequence(store.getBehavior(testId), [0, 1, 2]);
      expect(getNumberOfBehaviorSources(store, testId)).toBe(1);

      await expectSequence(store.getBehavior(testId), [2, 0, 1, 2]);
      await awaitCompletion(store.getBehavior(testId));
      expect(getNumberOfBehaviorSources(store, testId)).toBe(0);
    });
  });
});
