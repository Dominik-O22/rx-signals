import { beforeEach, describe, expect, it } from 'vitest';
import { interval, of, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { getEventId, type StoreError, Store, type TypedEvent } from '../src';
import { expectSequence, getSequence } from './test-utils';
import { getNumberOfEventSources, isSubscribed } from '../src/testing';
describe('Event streams', () => {
  const testEvent = getEventId<string>();

  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  describe('without sources', () => {
    it('should have no sources', () => {
      store.getEventStream(testEvent);
      expect(getNumberOfEventSources(store, testEvent)).toBe(0);
    });

    it('should not be subscribed', () => {
      store.getEventStream(testEvent);
      expect(isSubscribed(store, testEvent)).toBe(false);
    });
    it('should not dispatch event, if not subscribed', async () => {
      store.getEventStream(testEvent);
      const dispatched = await store.dispatch(testEvent, 'TEST');
      expect(dispatched).toBe(false);
    });

    it('should dispatch event, if subscribed', async () => {
      const eventStream = store.getEventStream(testEvent);
      const sequence = expectSequence(eventStream, ['TEST1', 'TEST2']);

      const dispatched1 = await store.dispatch(testEvent, 'TEST1');
      expect(dispatched1).toBe(true);
      const dispatched2 = await store.dispatch(testEvent, 'TEST2');
      expect(dispatched2).toBe(true);

      await sequence;
      const dispatched3 = await store.dispatch(testEvent, 'TEST3');
      expect(dispatched3).toBe(false);
    });

    it('should provide a typed event stream', async () => {
      const eventStream = store.getTypedEventStream(testEvent);
      const sequence = expectSequence(eventStream, [
        { type: testEvent, event: 'TEST1' },
        { type: testEvent, event: 'TEST2' },
      ]);

      void store.dispatch(testEvent, 'TEST1');
      void store.dispatch(testEvent, 'TEST2');

      await sequence;
    });
  });

  describe('with sources', () => {
    it('should add and remove event sources', () => {
      const sourceId1 = store.addEventSource(testEvent, of('event1', 'event2'));
      store.addEventSource(testEvent, of('event3', 'event4'));
      expect(getNumberOfEventSources(store, testEvent)).toBe(2);
      store.removeEventSource(sourceId1);
      expect(getNumberOfEventSources(store, testEvent)).toBe(1);
    });

    it('should not be subscribed', () => {
      store.addEventSource(testEvent, of('event1', 'event2'));
      store.getEventStream(testEvent);
      expect(isSubscribed(store, testEvent)).toBe(false);
    });

    it('should subscribe sources and dispatch events, if subscribed', async () => {
      store.addEventSource(testEvent, of('event1', 'event2'));
      store.addEventSource(testEvent, of('event3', 'event4'));
      const eventStream = store.getEventStream(testEvent);
      expect(isSubscribed(store, testEvent)).toBe(false);

      const sequence = expectSequence(eventStream, ['event1', 'event2', 'event3', 'event4']);
      expect(isSubscribed(store, testEvent)).toBe(true);

      await sequence;
    });

    it('should remove completed sources', async () => {
      store.addEventSource(testEvent, of('event1', 'event2'));
      store.addEventSource(testEvent, of('event3', 'event4'));
      const eventStream = store.getEventStream(testEvent);
      expect(isSubscribed(store, testEvent)).toBe(false);
      expect(getNumberOfEventSources(store, testEvent)).toBe(2);

      const sequence = expectSequence(eventStream, ['event1', 'event2']);
      expect(isSubscribed(store, testEvent)).toBe(true);

      await sequence;
      expect(getNumberOfEventSources(store, testEvent)).toBe(0); // because upon subscription, both sources have dispatched immediately
    });

    // v4: an erroring event source goes to onError; the stream and its subscribers keep running.
    it('should report source errors and keep the event stream', async () => {
      const errors: StoreError[] = [];
      store = new Store({ onError: error => errors.push(error) });
      store.addEventSource(
        testEvent,
        interval(10).pipe(
          map(val => {
            if (val === 3) {
              // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error throw must pass through as is
              throw 'ERROR';
            }
            return String(val);
          }),
        ),
      );
      const eventStream = store.getEventStream(testEvent);

      const sequence = expectSequence(eventStream, ['0', '1', '2', 'after']);
      await getSequence(eventStream, 3);
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(errors).toEqual([{ origin: 'event-source', events: [testEvent], cause: 'ERROR' }]);
      expect(getNumberOfEventSources(store, testEvent)).toBe(1);

      await store.dispatch(testEvent, 'after');
      await sequence;
    });
  });

  describe('with typed sources', () => {
    const testEvent2 = getEventId<string>();
    const testEvent3 = getEventId<string>();
    const testEvent4 = getEventId<string>();
    const testEvent5 = getEventId<string>();
    const testEvent6 = getEventId<string>();

    it('should work with event sources that emit 2 different event types', async () => {
      store.addTypedEventSource(
        [testEvent, testEvent2],
        of(
          {
            type: testEvent,
            event: 'testEvent1',
          },
          {
            type: testEvent2,
            event: 'testEvent2',
          },
        ),
      );
      expect(getNumberOfEventSources(store, testEvent)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent2)).toBe(1);

      const eventStream1 = store.getEventStream(testEvent);
      const eventStream2 = store.getEventStream(testEvent2);

      const sequence1 = expectSequence(eventStream1, ['testEvent1']);
      const sequence2 = expectSequence(eventStream2, ['testEvent2']);

      await sequence1;
      await sequence2;
    });

    it('should work with event sources that emit 3 different event types', async () => {
      store.addTypedEventSource(
        [testEvent, testEvent2, testEvent3],
        of(
          {
            type: testEvent,
            event: 'testEvent1',
          },
          {
            type: testEvent2,
            event: 'testEvent2',
          },
          {
            type: testEvent3,
            event: 'testEvent3',
          },
        ),
      );
      expect(getNumberOfEventSources(store, testEvent)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent2)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent3)).toBe(1);

      const eventStream1 = store.getEventStream(testEvent);
      const eventStream2 = store.getEventStream(testEvent2);
      const eventStream3 = store.getEventStream(testEvent3);

      const sequence1 = expectSequence(eventStream1, ['testEvent1']);
      const sequence2 = expectSequence(eventStream2, ['testEvent2']);
      const sequence3 = expectSequence(eventStream3, ['testEvent3']);

      await sequence1;
      await sequence2;
      await sequence3;
    });

    it('should work with event sources that emit 4 different event types', async () => {
      store.addTypedEventSource(
        [testEvent, testEvent2, testEvent3, testEvent4],
        of({
          type: testEvent4,
          event: 'testEvent4',
        }),
      );
      expect(getNumberOfEventSources(store, testEvent)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent2)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent3)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent4)).toBe(1);

      const eventStream4 = store.getEventStream(testEvent4);

      await expectSequence(eventStream4, ['testEvent4']);
    });

    it('should work with event sources that emit 5 different event types', async () => {
      store.addTypedEventSource(
        [testEvent, testEvent2, testEvent3, testEvent4, testEvent5],
        of({
          type: testEvent5,
          event: 'testEvent5',
        }),
      );
      expect(getNumberOfEventSources(store, testEvent)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent2)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent3)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent4)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent5)).toBe(1);

      const eventStream5 = store.getEventStream(testEvent5);

      await expectSequence(eventStream5, ['testEvent5']);
    });

    it('should work with event sources that emit 6 different event types', async () => {
      store.addTypedEventSource(
        [testEvent, testEvent2, testEvent3, testEvent4, testEvent5, testEvent6],
        of({
          type: testEvent6,
          event: 'testEvent6',
        }),
      );
      expect(getNumberOfEventSources(store, testEvent)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent2)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent3)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent4)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent5)).toBe(1);
      expect(getNumberOfEventSources(store, testEvent6)).toBe(1);

      const eventStream6 = store.getEventStream(testEvent6);

      await expectSequence(eventStream6, ['testEvent6']);
    });
  });

  describe('with typed sources that are switched depending on subscription of an event', () => {
    const testEvent2 = getEventId<string>();
    const testEvent3 = getEventId<string>();
    const testEvent4 = getEventId<string>();
    it('should NEVER dispatch testEvent2, if testEvent1 is not subscribed', async () => {
      store.addTypedEventSource(
        [testEvent, testEvent2],
        of(
          {
            type: testEvent,
            event: 'testEvent1',
          },
          {
            type: testEvent2,
            event: 'testEvent2',
          },
        ),
        { onlyWhileSubscribed: testEvent },
      );

      const eventStream2 = store.getEventStream(testEvent2);

      const sequence = await getSequence(eventStream2, 1, 100);
      expect(sequence).toEqual([]);
    });

    it('should dispatch testEvent2, if testEvent1 is subscribed', async () => {
      store.addTypedEventSource(
        [testEvent, testEvent2],
        of(
          {
            type: testEvent,
            event: 'testEvent1',
          },
          {
            type: testEvent2,
            event: 'testEvent2',
          },
          {
            type: testEvent,
            event: 'testEvent3',
          },
        ),
        { onlyWhileSubscribed: testEvent },
      );

      const eventStream2 = store.getEventStream(testEvent2);
      const sequence2 = expectSequence(eventStream2, ['testEvent2']);

      const eventStream1 = store.getEventStream(testEvent);
      const sequence1 = expectSequence(eventStream1, ['testEvent1', 'testEvent3']);

      await sequence1;
      await sequence2;
    });

    it('should dispatch testEvent1/2/4, only while testEvent3 is subscribed', async () => {
      const source = new Subject<TypedEvent<string>>();
      store.addTypedEventSource(
        [testEvent, testEvent2, testEvent3, testEvent4],
        source.asObservable(),
        { onlyWhileSubscribed: testEvent3 },
      );

      const eventStream1 = store.getEventStream(testEvent);
      const eventStream2 = store.getEventStream(testEvent2);
      const eventStream3 = store.getEventStream(testEvent3);
      const eventStream4 = store.getEventStream(testEvent4);

      const s1 = expectSequence(eventStream1, ['t1_1', 't1_3']);
      const s2 = expectSequence(eventStream2, ['t2_1', 't2_3']);
      const s4 = expectSequence(eventStream4, ['t4_1', 't4_3']);
      const s3_1 = expectSequence(eventStream3, ['t3_1']);

      source.next({ type: testEvent, event: 't1_1' }); // received, because E3 is subscribed
      source.next({ type: testEvent2, event: 't2_1' }); // received, because E3 is subscribed
      source.next({ type: testEvent4, event: 't4_1' }); // received, because E3 is subscribed
      source.next({ type: testEvent3, event: 't3_1' });
      await s3_1; // will unsubscribe E3

      source.next({ type: testEvent, event: 't1_1' }); // missed, because E3 is not subscribed
      source.next({ type: testEvent2, event: 't2_2' }); // missed, because E3 is not subscribed
      source.next({ type: testEvent4, event: 't4_2' }); // missed, because E3 is not subscribed

      const s3_2 = expectSequence(eventStream3, ['t3_2']);

      source.next({ type: testEvent, event: 't1_3' }); // received, because E3 is subscribed
      source.next({ type: testEvent2, event: 't2_3' }); // received, because E3 is subscribed
      source.next({ type: testEvent4, event: 't4_3' }); // received, because E3 is subscribed

      source.next({ type: testEvent3, event: 't3_2' });

      await s3_2;
      await s1;
      await s2;
      await s4;
    });
  });

  it('dispatch type checking', () => {
    const eNumber = getEventId<number>();
    const eNumberOrNull = getEventId<number | null>();
    const eNumberOrString = getEventId<number | string>();
    const eString = getEventId<string>();
    const eArray = getEventId<number[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pins that an any event accepts any payload
    const eAny = getEventId<any>();
    const eUndefined = getEventId<undefined>();
    const eNull = getEventId<null>();

    // const x: number = 42;
    // store.dispatch(x, 5); // error

    void store.dispatch(eNumber, 5);
    // store.dispatch(eNumber, [5]); // error
    // store.dispatch(eNumber, ''); // error
    // store.dispatch(eNumber, null); // error
    // store.dispatch(eNumber, undefined); // error
    // store.dispatch(eNumber); // error

    void store.dispatch(eNumberOrNull, 5);
    // store.dispatch(eNumberOrNull, [5]); // error
    // store.dispatch(eNumberOrNull, ''); // error
    void store.dispatch(eNumberOrNull, null);
    // store.dispatch(eNumberOrNull, undefined); // error
    // store.dispatch(eNumberOrNull); // error

    void store.dispatch(eNumberOrString, 5);
    // store.dispatch(eNumberOrString, [5]); // error
    void store.dispatch(eNumberOrString, '');
    // store.dispatch(eNumberOrString, null); // error
    // store.dispatch(eNumberOrString, undefined); // error
    // store.dispatch(eNumberOrString); // error

    void store.dispatch(eString, '');
    // store.dispatch(eString, [5]); // error
    // store.dispatch(eString, 5); // error
    // store.dispatch(eString, null); // error
    // store.dispatch(eString, undefined); // error
    // store.dispatch(eString); // error

    void store.dispatch(eArray, [5]);
    // store.dispatch(eArray, ['5']); // error
    // store.dispatch(eArray, ''); // error
    // store.dispatch(eArray, null); // error
    // store.dispatch(eArray, undefined); // error
    // store.dispatch(eArray); // error

    void store.dispatch(eAny, 5);
    void store.dispatch(eAny, [5]);
    void store.dispatch(eAny, '');
    void store.dispatch(eAny, null);
    void store.dispatch(eAny, undefined);
    void store.dispatch(eAny);

    void store.dispatch(eUndefined, undefined);
    // store.dispatch(eUndefined, [5]); // error
    // store.dispatch(eUndefined, ''); // error
    // store.dispatch(eUndefined, null); // error
    void store.dispatch(eUndefined, undefined);
    void store.dispatch(eUndefined);

    void store.dispatch(eNull, null);
    // store.dispatch(eNull, [5]); // error
    // store.dispatch(eNull, ''); // error
    // store.dispatch(eNull, undefined); // error
    // store.dispatch(eNull); // error
  });
});
