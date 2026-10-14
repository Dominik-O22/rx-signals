import {
  catchError,
  defer,
  distinctUntilChanged,
  filter,
  map,
  merge,
  NEVER,
  type Observable,
  share,
  switchMap,
} from 'rxjs';
import { type Demand } from './cells/demand';
import { DerivedCell } from './cells/derived-cell';
import { EventCell } from './cells/event-cell';
import { type Initial } from './cells/initial';
import { StateCell } from './cells/state-cell';
import { reportUnhandled, type StoreError, type StoreOptions } from './errors';
import {
  type AnyBehaviorId,
  type AnyEffectId,
  type AnyEventId,
  type AnyStateId,
  type BehaviorId,
  type DerivedId,
  type EffectId,
  type EventId,
  type ReadableSignal,
  type ReadsAs,
  type StateId,
  type ToEventIdValueType,
  type WritableBehavior,
  type WritableEvent,
  type WritesAs,
} from './ids';
import { defaultSchedule, EventQueue } from './queue';

/** An event id bundled with its payload, for sources and streams that carry several event types. */
export type TypedEvent<T> = Readonly<{ type: EventId<T>; event: T }>;

/** `TypedEvent` for each id of a union: `TypedEventOf<EventId<A> | EventId<B>>` is `TypedEvent<A> | TypedEvent<B>`. */
export type TypedEventOf<ID> = ID extends EventId<infer T> ? TypedEvent<T> : never;

/** Pure. If it throws, the state keeps its value and the error goes to `onError`. */
export type StateReducer<T, E> = (state: T, event: E) => T;

/** Potentially impure. Only its first value is used by the effect factories. */
export type Effect<Input, Result> = (
  input: Input,
  store: Store,
  previousInput?: Input,
  previousResult?: Result,
) => Observable<Result>;

/** Both operations are idempotent, and `end()` after `reset()` still ends. */
export type LifecycleHandle = {
  /** Resets every behavior registered in the lifecycle to its initial value. */
  readonly reset: () => void;
  /** Removes everything registered in the lifecycle. Its behaviors complete, event streams do not. */
  readonly end: () => void;
};

const eventSourceHandle: unique symbol = Symbol('rx-signals.EventSourceHandle');
/** Identifies an event source for `removeEventSource`. */
export type EventSourceHandle = { readonly [eventSourceHandle]: string };

// What the store does with cells of any value type. Method syntax keeps these bivariant, so a
// `StateCell<number>` is a `BehaviorCell` although the cell classes are invariant.
type BehaviorCell = {
  readonly sourceCount: number;
  readonly value: { readonly demand: Demand };
  suspend(): void;
  resume(): void;
  detach(): void;
  dispose(): void;
};
type AnyEventCell = {
  readonly sourceCount: number;
  readonly demand: Demand;
  dispatch(value: unknown): Promise<boolean>;
  addSource(handle: object, source: Observable<unknown>): void;
  removeSource(handle: object): void;
  dispose(): void;
};
/** An id seen through either view; private accessors take this to tie a cell's type to its id. */
type Typed<T> = ReadsAs<T> | WritesAs<T>;

/** What `getLifecycleHandle` records for one call of `#register`. */
type Registration = { readonly undo: () => void; readonly resets?: BehaviorCell };

/** Read access for the `/testing` entry, which is not part of the main entry. */
export type StoreInternals = {
  readonly behaviorCell: (id: AnyBehaviorId) => BehaviorCell;
  readonly eventCell: (id: AnyEventId) => AnyEventCell;
  readonly queue: EventQueue;
};

// Cells are keyed by id, and an id's value type is its cell's value type. A Map cannot express
// that link, so this is the one place that restores it.
const cellFor = <Cell>(cells: Map<object, unknown>, id: object, create: () => Cell): Cell => {
  const existing = cells.get(id);
  if (existing !== undefined) return existing as Cell;
  const cell = create();
  cells.set(id, cell);
  return cell;
};

// Two phases, so no cell resumes next to a neighbor that is not reset yet. States resume before
// derived cells, so derived cells reconnect against fresh state.
const resetCells = (cells: readonly BehaviorCell[]): void => {
  const unique = [...new Set(cells)];
  unique.forEach(cell => {
    cell.suspend();
  });
  unique.forEach(cell => {
    if (cell instanceof StateCell) cell.resume();
  });
  unique.forEach(cell => {
    if (cell instanceof DerivedCell) cell.resume();
  });
};

let internalsOf: (store: Store) => StoreInternals;

/** For the `/testing` entry only. */
export const inspectStore = (store: Store): StoreInternals => internalsOf(store);

/**
 * The store. Also the Angular DI token.
 *
 * Registration mistakes throw at the call (a second initial value, a second reducer for one event).
 * Runtime failures never throw into callers and never break a cell: reducers, state feeds and event
 * sources report to `onError`; a derived source's error reaches that behavior's subscribers.
 */
export class Store {
  // Set once: in the constructor, or by createChildStore for a child, which shares its root's
  // queue and error handler so event order and error policy span the tree.
  #parent: Store | null = null;
  #queue: EventQueue;
  #report: (error: StoreError) => void;
  readonly #states = new Map<AnyBehaviorId, BehaviorCell>();
  readonly #derived = new Map<AnyBehaviorId, BehaviorCell>();
  readonly #effects = new Map<AnyEffectId, BehaviorCell>();
  readonly #events = new Map<AnyEventId, AnyEventCell>();
  #recording: Registration[] | null = null;

  static {
    internalsOf = store => ({
      behaviorCell: id => store.#behaviorCell(id),
      eventCell: id => store.#anyEventCell(id),
      queue: store.#queue,
    });
  }

  constructor(options: StoreOptions = {}) {
    this.#queue = new EventQueue(options.schedule ?? defaultSchedule);
    this.#report = options.onError ?? reportUnhandled;
  }

  getParentStore(): Store | null {
    return this.#parent;
  }

  getRootStore(): Store {
    return this.#parent?.getRootStore() ?? this;
  }

  /**
   * Parent events reach child subscribers; child events do not reach the parent. A child reads a
   * behavior or effect from its parent until it registers its own source for the id, then switches.
   */
  createChildStore(): Store {
    const child = new Store();
    child.#parent = this;
    child.#queue = this.#queue;
    child.#report = this.#report;
    return child;
  }

  /** Eager state. Throws if `id` already has an initial value or a feed. */
  addState<T>(id: StateId<T>, initial: Initial<NoInfer<T>>): void {
    const cell = this.#stateCell<T>(id);
    this.#register(() => {
      cell.setBase({ kind: 'initial', initial });
      return {
        undo: () => {
          this.#drop(this.#states, id, cell);
        },
        resets: cell,
      };
    });
  }

  /** Lazy state. Throws if `id` already has a source. The initial value is applied on first demand. */
  addDerivedState<T>(
    id: DerivedId<T>,
    source: Observable<NoInfer<T>>,
    initial?: Initial<NoInfer<T>>,
  ): void {
    this.#addDerived(id, source, initial);
  }

  /** Reducers may come before `addState`; events arriving before the initial value are dropped. */
  addReducer<T, E>(
    id: StateId<T>,
    event: EventId<E>,
    reducer: StateReducer<NoInfer<T>, NoInfer<E>>,
  ): void {
    const cell = this.#stateCell<T>(id);
    this.#register(() => {
      cell.addReducer(event, this.getEventStream(event), reducer, cause => {
        this.#report({ origin: 'reducer', state: id, event, cause });
      });
      return {
        undo: () => {
          cell.removeReducer(event);
        },
      };
    });
  }

  removeReducer(id: AnyStateId, event: AnyEventId): void {
    const cell = this.#states.get(id);
    if (cell instanceof StateCell) cell.removeReducer(event);
  }

  /**
   * Feeds `target` from `source`, which may be narrower than the target. Derived and event targets
   * are lazy; a state target is subscribed eagerly and has no initial value. Throws if a behavior
   * target already has a source.
   */
  connect<T>(source: ReadableSignal<T>, target: WritableBehavior<T>): void;
  connect<T>(source: ReadableSignal<T>, target: WritableEvent<T>): EventSourceHandle;
  connect<T>(
    source: ReadableSignal<T>,
    target: WritableBehavior<T> | WritableEvent<T>,
  ): EventSourceHandle | undefined {
    const observable =
      source.kind === 'event' ? this.#eventStream<T>(source) : this.#behavior<T>(source);
    return this.#connect(observable, target);
  }

  connectObservable<T>(source: Observable<T>, target: WritableBehavior<T>): void;
  connectObservable<T>(source: Observable<T>, target: WritableEvent<T>): EventSourceHandle;
  connectObservable<T>(
    source: Observable<T>,
    target: WritableBehavior<T> | WritableEvent<T>,
  ): EventSourceHandle | undefined {
    return this.#connect(source, target);
  }

  /**
   * The current value on subscribe once there is one, then every distinct change. Subscribing a
   * derived behavior connects its source; the latest value survives zero subscribers.
   */
  getBehavior<T>(id: BehaviorId<T>): Observable<T> {
    return this.#behavior(id);
  }

  /** Removes every source and reducer. Subscribers stay and keep the last value. */
  removeBehaviorSources(id: AnyBehaviorId): void {
    this.#behaviorCell(id).detach();
  }

  /** Removes every source and reducer, then completes the subscribers. */
  completeBehavior(id: AnyBehaviorId): void {
    this.#drop(this.#states, id, this.#states.get(id));
    this.#drop(this.#derived, id, this.#derived.get(id));
  }

  /** Ends this store: every cell is dropped and its subscribers complete. The store stays usable. */
  completeAllSignals(): void {
    for (const table of [this.#states, this.#derived, this.#effects, this.#events]) {
      table.forEach(cell => {
        cell.dispose();
      });
      table.clear();
    }
  }

  /** Back to initial values: every state, effect and derived behavior of this store. */
  resetBehaviors(): void {
    resetCells([...this.#states.values(), ...this.#effects.values(), ...this.#derived.values()]);
  }

  /**
   * Queues an event. Resolves `true` once it was delivered, `false` right away if nobody listens.
   * Never rejects. The payload is optional when `undefined` is a valid payload.
   */
  dispatch<ID extends AnyEventId>(
    id: ID,
    ...event: undefined extends ToEventIdValueType<ID>
      ? [event?: ToEventIdValueType<ID>]
      : [event: ToEventIdValueType<ID>]
  ): Promise<boolean>;
  dispatch(id: AnyEventId, event?: unknown): Promise<boolean> {
    return this.#anyEventCell(id).dispatch(event);
  }

  /** Always asynchronous. In a child store, this merges the parent's stream with the child's. */
  getEventStream<T>(id: EventId<T>): Observable<T> {
    return this.#eventStream(id);
  }

  getTypedEventStream<T>(id: EventId<T>): Observable<TypedEvent<T>> {
    return this.#eventStream(id).pipe(map(event => ({ type: id, event })));
  }

  /** Lazy: subscribed while the event has subscribers. An erroring source is reported and retried on the next demand. */
  addEventSource<T>(id: EventId<T>, source: Observable<NoInfer<T>>): EventSourceHandle {
    return this.#addEventSources([id], () => this.#guard([id], source));
  }

  /**
   * One source emitting several event types. With `onlyWhileSubscribed`, the source runs only while
   * that event has subscribers. Each emission takes one queue hop, like every other event.
   */
  addTypedEventSource<IDS extends readonly AnyEventId[]>(
    ids: IDS,
    source: Observable<TypedEventOf<IDS[number]>>,
    options: { readonly onlyWhileSubscribed?: AnyEventId } = {},
  ): EventSourceHandle {
    const shared = this.#guard(ids, source).pipe(share());
    const gate = options.onlyWhileSubscribed;
    const running =
      gate === undefined
        ? shared
        : this.#anyEventCell(gate).demand.subscribed$.pipe(
            switchMap(subscribed => (subscribed ? shared : NEVER)),
          );
    return this.#addEventSources(ids, id =>
      running.pipe(
        filter(typed => typed.type === id),
        map(typed => typed.event),
      ),
    );
  }

  removeEventSource(handle: EventSourceHandle): void {
    this.#events.forEach(cell => {
      cell.removeSource(handle);
    });
  }

  /** Throws if `id` already has an effect. */
  addEffect<Input, Result>(id: EffectId<Input, Result>, effect: Effect<Input, Result>): void {
    const cell = this.#effectCell<Input, Result>(id);
    this.#register(() => {
      cell.setBase({ kind: 'initial', initial: () => effect });
      return {
        undo: () => {
          this.#drop(this.#effects, id, cell);
        },
        resets: cell,
      };
    });
  }

  /** Emits the effect once it is added, from this store or else its parent. */
  getEffect<Input, Result>(id: EffectId<Input, Result>): Observable<Effect<Input, Result>> {
    return defer(() =>
      this.#ownOrParent(this.#effectCell<Input, Result>(id), parent => parent.getEffect(id)),
    );
  }

  /**
   * Everything registered on this store while `register` runs belongs to the lifecycle: states,
   * derived states, reducers, feeds, event sources and effects. Lifecycles do not nest.
   */
  getLifecycleHandle(register: (store: Store) => void): LifecycleHandle {
    if (this.#recording !== null) {
      throw new Error(
        'getLifecycleHandle cannot be called while already within a lifecycleRegistrationCallback',
      );
    }
    const registrations: Registration[] = [];
    this.#recording = registrations;
    try {
      register(this);
    } finally {
      this.#recording = null;
    }
    let ended = false;
    return {
      reset: () => {
        if (!ended) resetCells(registrations.flatMap(({ resets }) => (resets ? [resets] : [])));
      },
      end: () => {
        if (ended) return;
        ended = true;
        [...registrations].reverse().forEach(({ undo }) => {
          undo();
        });
      },
    };
  }

  /** The one path for every registration: `claim` throws on duplicates before anything is recorded. */
  #register(claim: () => Registration): void {
    const registration = claim();
    this.#recording?.push(registration);
  }

  #addDerived<T>(
    id: AnyBehaviorId & WritesAs<T>,
    source: Observable<T>,
    initial: Initial<T> | undefined,
  ): void {
    const cell = this.#derivedCell<T>(id);
    this.#register(() => {
      cell.setSource(source, initial);
      return {
        undo: () => {
          this.#drop(this.#derived, id, cell);
        },
        resets: cell,
      };
    });
  }

  #connect<T>(
    source: Observable<T>,
    target: WritableBehavior<T> | WritableEvent<T>,
  ): EventSourceHandle | undefined {
    if (target.kind === 'event') {
      return this.#addEventSources([target], () => this.#guard([target], source));
    }
    if (target.kind === 'derived') {
      this.#addDerived(target, source, undefined);
      return undefined;
    }
    const cell = this.#stateCell<T>(target);
    this.#register(() => {
      cell.setBase({
        kind: 'feed',
        source,
        onError: cause => {
          this.#report({ origin: 'state-feed', state: target, cause });
        },
      });
      return {
        undo: () => {
          this.#drop(this.#states, target, cell);
        },
        resets: cell,
      };
    });
    return undefined;
  }

  #addEventSources(
    ids: readonly AnyEventId[],
    sourceFor: (id: AnyEventId) => Observable<unknown>,
  ): EventSourceHandle {
    const handle: EventSourceHandle = Object.freeze({
      [eventSourceHandle]: ids.map(id => id.name).join(','),
    });
    this.#register(() => {
      ids.forEach(id => {
        this.#anyEventCell(id).addSource(handle, sourceFor(id));
      });
      return {
        undo: () => {
          this.removeEventSource(handle);
        },
      };
    });
    return handle;
  }

  #guard<T>(ids: readonly AnyEventId[], source: Observable<T>): Observable<T> {
    return source.pipe(
      catchError((cause: unknown) => {
        this.#report({ origin: 'event-source', events: ids, cause });
        return NEVER;
      }),
    );
  }

  #behavior<T>(id: AnyBehaviorId & ReadsAs<T>): Observable<T> {
    return defer(() =>
      this.#ownOrParent(
        id.kind === 'state' ? this.#stateCell<T>(id) : this.#derivedCell<T>(id),
        parent => parent.#behavior(id),
      ),
    );
  }

  #eventStream<T>(id: AnyEventId & ReadsAs<T>): Observable<T> {
    const own = defer(() => this.#eventCell<T>(id).observable);
    return this.#parent === null ? own : merge(own, this.#parent.#eventStream(id));
  }

  #ownOrParent<T>(
    cell: {
      readonly owned$: Observable<boolean>;
      readonly value: { readonly observable: Observable<T> };
    },
    fromParent: (parent: Store) => Observable<T>,
  ): Observable<T> {
    const parent = this.#parent;
    if (parent === null) return cell.value.observable;
    return cell.owned$.pipe(
      distinctUntilChanged(),
      switchMap(owned => (owned ? cell.value.observable : fromParent(parent))),
      distinctUntilChanged(),
    );
  }

  #drop(table: Map<object, BehaviorCell>, id: object, cell: BehaviorCell | undefined): void {
    if (cell === undefined || table.get(id) !== cell) return;
    cell.dispose();
    table.delete(id);
  }

  #behaviorCell(id: AnyBehaviorId): BehaviorCell {
    return id.kind === 'state'
      ? cellFor(this.#states, id, () => new StateCell<unknown>(id.name))
      : cellFor(this.#derived, id, () => new DerivedCell<unknown>(id.name));
  }

  #stateCell<T>(id: AnyBehaviorId & Typed<T>): StateCell<T> {
    return cellFor(this.#states, id, () => new StateCell<T>(id.name));
  }

  #derivedCell<T>(id: AnyBehaviorId & Typed<T>): DerivedCell<T> {
    return cellFor(this.#derived, id, () => new DerivedCell<T>(id.name));
  }

  #effectCell<Input, Result>(id: EffectId<Input, Result>): StateCell<Effect<Input, Result>> {
    return cellFor(this.#effects, id, () => new StateCell<Effect<Input, Result>>(id.name));
  }

  #eventCell<T>(id: AnyEventId & Typed<T>): EventCell<T> {
    return cellFor(this.#events, id, () => new EventCell<T>(this.#queue));
  }

  #anyEventCell(id: AnyEventId): AnyEventCell {
    return cellFor(this.#events, id, () => new EventCell<unknown>(this.#queue));
  }
}
