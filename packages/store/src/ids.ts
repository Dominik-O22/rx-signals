import { type Observable } from 'rxjs';

// An id is a frozen `{ kind, name }` plus a phantom slot carrying its value type. `kind` is data,
// so the store never parses a description to learn what an id is (rc23 read effect ids as event
// ids that way). The slot is keyed by a module-private symbol and required, so an object literal
// cannot pass for an id.

const valueType: unique symbol = Symbol('rx-signals.valueType');

// Variance comes from the annotations, not from member types, so it also holds with
// `strictFunctionTypes` off (function parameters are bivariant there).
type ValueSlot<out Read, in Write> = {
  readonly read?: () => Read;
  readonly write?: (value: Write) => void;
};

export type IdKind = 'state' | 'derived' | 'event' | 'effect';

// Distributes over K, so `IdBase<'state' | 'derived'>` is a union that narrows on `kind`.
type IdBase<K extends IdKind> = K extends IdKind
  ? {
      readonly kind: K;
      /** Debug name, e.g. `S_counter3`. Shows up in error messages. */
      readonly name: string;
    }
  : never;

/** Eager root state: `addState` plus reducers, or one eager `connect`. */
export type StateId<in out T> = {
  readonly kind: 'state';
  readonly name: string;
  readonly [valueType]: ValueSlot<T, T>;
};

/** Lazy derived state: its source runs only while somebody subscribes. */
export type DerivedId<in out T> = {
  readonly kind: 'derived';
  readonly name: string;
  readonly [valueType]: ValueSlot<T, T>;
};

/** An asynchronous, ordered event stream. */
export type EventId<in out T> = {
  readonly kind: 'event';
  readonly name: string;
  readonly [valueType]: ValueSlot<T, T>;
};

/** An `Effect<Input, Result>` function registered with `addEffect`. */
export type EffectId<in out Input, in out Result> = {
  readonly kind: 'effect';
  readonly name: string;
  readonly [valueType]: ValueSlot<readonly [Input, Result], readonly [Input, Result]>;
};

export type BehaviorId<T> = StateId<T> | DerivedId<T>;
export type SignalId<T> = BehaviorId<T> | EventId<T>;

// Ids are invariant, so there is no `SignalId<unknown>` supertype. Constraints use these instead:
// any id of the kind, readable as `unknown`, and still not forgeable by an object literal.
type AnyId<K extends IdKind> = IdBase<K> & ReadsAs<unknown>;
export type AnyStateId = AnyId<'state'>;
export type AnyBehaviorId = AnyId<'state' | 'derived'>;
export type AnyEventId = AnyId<'event'>;
export type AnySignalId = AnyId<'state' | 'derived' | 'event'>;
export type AnyEffectId = AnyId<'effect'>;

/** Covariant view: an id you can read a `T` from. `connect` sources use it. */
export type ReadsAs<T> = { readonly [valueType]: ValueSlot<T, never> };
/** Contravariant view: an id you can write a `T` into. `connect` targets use it. */
export type WritesAs<T> = { readonly [valueType]: ValueSlot<unknown, T> };

export type ReadableSignal<T> = AnySignalId & ReadsAs<T>;
export type WritableBehavior<T> = AnyBehaviorId & WritesAs<T>;
export type WritableEvent<T> = AnyEventId & WritesAs<T>;

type ValueOf<ID> = ID extends { readonly [valueType]: ValueSlot<infer T, never> } ? T : never;

export type ToBehaviorIdValueType<B> = B extends AnyBehaviorId ? ValueOf<B> : never;
export type ToEventIdValueType<E> = E extends AnyEventId ? ValueOf<E> : never;
export type ToSignalIdValueType<S> = S extends AnySignalId ? ValueOf<S> : never;
export type ToObservableValueType<O> = O extends Observable<infer T> ? T : never;

const prefixes: Readonly<Record<IdKind, string>> = {
  state: 'S',
  derived: 'D',
  event: 'E',
  effect: 'Effect',
};
const counters: Record<IdKind, number> = { state: 0, derived: 0, event: 0, effect: 0 };

const mint = <K extends IdKind>(kind: K, nameExtension: string | undefined) =>
  Object.freeze({
    kind,
    name: `${prefixes[kind]}_${nameExtension ?? ''}${String(++counters[kind])}`,
    [valueType]: {},
  });

/** `nameExtension` only improves debug names. */
export const getStateId = <T>(nameExtension?: string): StateId<T> => mint('state', nameExtension);
export const getDerivedId = <T>(nameExtension?: string): DerivedId<T> =>
  mint('derived', nameExtension);
export const getEventId = <T>(nameExtension?: string): EventId<T> => mint('event', nameExtension);
export const getEffectId = <Input, Result>(nameExtension?: string): EffectId<Input, Result> =>
  mint('effect', nameExtension);

const isIdOf =
  <K extends IdKind>(kinds: readonly K[]) =>
  (value: object): value is AnyId<K> =>
    valueType in value && 'kind' in value && kinds.some(kind => kind === value.kind);

export const isSignalId = isIdOf(['state', 'derived', 'event']);
export const isEffectId = isIdOf(['effect']);
