// A consumer of the emitted .d.ts (imports resolve through the package's own `exports`).
// Every `@ts-expect-error` must be a real error, or tsc fails with "Unused directive".
import { type Observable, of } from 'rxjs';
import {
  type AnyBehaviorId,
  type BehaviorId,
  type EffectId,
  type EventId,
  getDerivedId,
  getEffectId,
  getEffectSignalsFactory,
  getEventId,
  getStateId,
  type NoIds,
  SignalsFactory,
  type StateId,
  Store,
  type ToSignalIdValueType,
} from '@rx-signals-next/store';
import { getNumberOfBehaviorSources, isSubscribed, settle } from '@rx-signals-next/store/testing';

const store = new Store({ onError: error => error.cause });

// Ids are invariant.
const a = getStateId<'a'>();
export const asBehavior: BehaviorId<'a'> = a;
// @ts-expect-error a StateId<'a'> cannot widen to StateId<string>
export const widened: StateId<string> = a;
// @ts-expect-error a StateId<string> cannot narrow to StateId<'a'>
export const narrowed: StateId<'a'> = getStateId<string>();
// @ts-expect-error event ids neither
export const wideEvent: EventId<number | string> = getEventId<number>();
// @ts-expect-error an effect's result type cannot widen (rc23's useExistingEffect hole)
export const wideEffect: EffectId<number, unknown> = getEffectId<number, string>();
export const value: ToSignalIdValueType<EventId<number>> = 1;

// Object literals cannot pass for ids.
// @ts-expect-error forged event id
export const forged: EventId<number> = { kind: 'event', name: 'E_1' };
// @ts-expect-error forged read view
export const forgedAny: AnyBehaviorId = { kind: 'state', name: 'S_1' };

// connect: a narrow source may feed a wide target, never the reverse.
const count = getStateId<number>();
const maybeCount = getStateId<number | undefined>();
store.addState(count, 0);
store.connect(count, getDerivedId<number | undefined>());
// @ts-expect-error undefined does not fit a number target
store.connect(maybeCount, getDerivedId<number>());
store.connect(getEventId<number>(), getEventId<number | null>()) satisfies object;
store.connectObservable(of(1), getDerivedId<number | null>());
// @ts-expect-error a string observable cannot feed a number target
store.connectObservable(of('1'), getDerivedId<number>());

// Write paths stay invariant.
const increase = getEventId<number>();
store.addReducer(count, increase, (state, by) => state + by);
// @ts-expect-error a reducer cannot return a wider value
store.addReducer(count, getEventId<string>(), (_, text) => text);
// @ts-expect-error the initial value must match
store.addState(getStateId<number>(), 'zero');

// dispatch payloads.
void store.dispatch(increase, 1);
// @ts-expect-error wrong payload type
void store.dispatch(increase, '1');
// @ts-expect-error a number payload is required
void store.dispatch(increase);
void store.dispatch(getEventId<undefined>());
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- apps declare void events
void store.dispatch(getEventId<void>());
void store.dispatch(getEventId<number | null>(), null);
void store.dispatch(getEventId<'x' | 'y'>(), 'x');
// @ts-expect-error 'z' is not a payload of this event
void store.dispatch(getEventId<'x' | 'y'>(), 'z');
// @ts-expect-error states cannot be dispatched to
void store.dispatch(count, 1);

// The read side takes covariant views: a helper can hold behaviors of any value type.
const keepHot = (target: Store, ids: readonly AnyBehaviorId[]): Observable<unknown>[] =>
  ids.map(id => target.getBehavior(id));
keepHot(store, [count, maybeCount, getDerivedId<string>(), getStateId<{ deep: boolean[] }>()]);
// @ts-expect-error event ids are not behaviors
keepHot(store, [increase]);
export const readNumber: Observable<number> = store.getBehavior(count);
export const readWide: Observable<number | undefined> = store.getBehavior(count);

// A generic emit helper with an object literal payload.
type Filter = { readonly name: string; readonly page: number };
const emit = <T>(target: Store, id: EventId<T>, event: T): Promise<boolean> =>
  target.dispatch(id, event);
const setFilter = getEventId<Filter>();
void emit(store, setFilter, { name: 'x', page: 1 });
// @ts-expect-error the literal must match the event type
void emit(store, setFilter, { name: 'x' });

// Typed sources.
const progress = getEventId<number>();
const done = getEventId<string>();
store.addTypedEventSource(
  [progress, done],
  of({ type: progress, event: 1 }, { type: done, event: 'ok' }),
  { onlyWhileSubscribed: done },
);
// @ts-expect-error the payload must match its event id
store.addTypedEventSource([progress], of({ type: progress, event: 'one' }));

// Effects and factories.
const search = getEffectId<string, readonly string[]>();
store.addEffect(search, query => of([query]));
const searchFactory = getEffectSignalsFactory<string, readonly string[]>();
searchFactory.useExistingEffect('id', () => search);
// @ts-expect-error the existing effect must have exactly the factory's types
searchFactory.useExistingEffect('id', () => getEffectId<string, readonly unknown[]>());

type Named = { readonly name: string };
const named = new SignalsFactory<NoIds, { name: BehaviorId<string> }, Named>(config => {
  const name = getDerivedId<string>();
  return {
    input: {},
    output: { name },
    effects: {},
    setup: s => {
      s.addDerivedState(name, of(config.name));
    },
  };
});
named.compose(searchFactory).build({ name: 'shared', withTrigger: true });
named
  .nestConfig('c1')
  .compose(searchFactory.nestConfig('c2'))
  .build({ c1: { name: 'x' }, c2: {} });
const numbered = new SignalsFactory<NoIds, NoIds, { readonly name: number }>(() => ({
  input: {},
  output: {},
  effects: {},
  setup: () => undefined,
}));
// @ts-expect-error both sides read `name`, as string and as number
named.compose(numbered);

// The /testing entry.
export const subscribed: boolean = isSubscribed(store, count);
export const sources: number = getNumberOfBehaviorSources(store, count);
export const settled: Promise<void> = settle(store);
