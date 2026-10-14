import { type Observable, type Subscription } from 'rxjs';
import { type AnyEventId } from '../ids';
import { resolveInitial, type Initial } from './initial';
import { Ownership } from './ownership';
import { ValueCell } from './value-cell';

/** At most one base: an initial value from `addState`, or an eager feed from `connect`. */
export type StateBase<T> =
  | { readonly kind: 'initial'; readonly initial: Initial<T> }
  | {
      readonly kind: 'feed';
      readonly source: Observable<T>;
      readonly onError: (cause: unknown) => void;
    };

/**
 * Eager state: a base plus reducers keyed by event. While it has any of them, the cell demands
 * itself, so reducers see every event whether or not anybody subscribes.
 *
 * Reducers read the latest value directly. A throwing reducer and an erroring feed are reported;
 * the value stays. Events that arrive before the first value are dropped.
 */
export class StateCell<T> {
  readonly value = new ValueCell<T>(() => undefined);
  readonly #ownership = new Ownership(() => this.sourceCount > 0);
  #base: StateBase<T> | null = null;
  #feed: Subscription | null = null;
  readonly #reducers = new Map<AnyEventId, Subscription>();
  #releaseSelf: (() => void) | null = null;
  readonly #name: string;

  constructor(name: string) {
    this.#name = name;
  }

  get owned$(): Observable<boolean> {
    return this.#ownership.owned$;
  }

  get sourceCount(): number {
    return (this.#base === null ? 0 : 1) + this.#reducers.size;
  }

  setBase(base: StateBase<T>): void {
    if (this.#base !== null) {
      throw new Error(
        `A behavior or event source with the given identifier has already been added: ${this.#name}`,
      );
    }
    this.#base = base;
    this.#sourcesChanged();
    this.#applyBase();
  }

  addReducer<E>(
    event: AnyEventId,
    events: Observable<E>,
    reducer: (state: T, event: E) => T,
    onError: (cause: unknown) => void,
  ): void {
    if (this.#reducers.has(event)) {
      throw new Error(`A source with the given ID has already been added.: ${event.name}`);
    }
    const subscription = events.subscribe(payload => {
      const latest = this.value.latest;
      if (!latest.has) return;
      try {
        this.value.set(reducer(latest.value, payload));
      } catch (cause) {
        onError(cause);
      }
    });
    this.#reducers.set(event, subscription);
    this.#sourcesChanged();
  }

  removeReducer(event: AnyEventId): void {
    this.#reducers.get(event)?.unsubscribe();
    if (this.#reducers.delete(event)) this.#sourcesChanged();
  }

  /** Drops base and reducers. Subscribers stay and keep the last value. */
  detach(): void {
    this.#stopFeed();
    this.#base = null;
    this.#reducers.forEach(subscription => {
      subscription.unsubscribe();
    });
    this.#reducers.clear();
    this.#sourcesChanged();
  }

  suspend(): void {
    this.#stopFeed();
  }

  /** Re-applies the base: the initial value again, or a fresh feed subscription. */
  resume(): void {
    this.#applyBase();
  }

  dispose(): void {
    this.detach();
    this.value.complete();
  }

  #applyBase(): void {
    const base = this.#base;
    if (base === null) return;
    if (base.kind === 'initial') {
      this.value.set(resolveInitial(base.initial));
      return;
    }
    const feed = base.source.subscribe({
      next: value => {
        this.value.set(value);
      },
      error: (cause: unknown) => {
        this.#feed = null;
        base.onError(cause);
      },
      complete: () => {
        this.#feed = null;
        if (this.#base === base) {
          this.#base = null;
          this.#holdDemand();
        }
      },
    });
    if (!feed.closed) this.#feed = feed;
  }

  #stopFeed(): void {
    this.#feed?.unsubscribe();
    this.#feed = null;
  }

  #sourcesChanged(): void {
    this.#holdDemand();
    this.#ownership.changed();
  }

  #holdDemand(): void {
    const hasSources = this.sourceCount > 0;
    if (hasSources && this.#releaseSelf === null) this.#releaseSelf = this.value.demand.acquire();
    if (!hasSources && this.#releaseSelf !== null) {
      this.#releaseSelf();
      this.#releaseSelf = null;
    }
  }
}
