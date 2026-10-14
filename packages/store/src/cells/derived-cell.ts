import { type Observable, type Subscription } from 'rxjs';
import { resolveInitial, type Initial } from './initial';
import { Ownership } from './ownership';
import { ValueCell } from './value-cell';

type Source<T> = {
  readonly observable: Observable<T>;
  readonly initial: Initial<T> | undefined;
};

/**
 * Lazy state: one source, subscribed only while the cell is demanded. The latest value survives
 * zero subscribers. The initial value is applied on the first demand after the source is set or
 * the cell is reset.
 *
 * A source error goes to the current subscribers (it is their stream), the latest value is kept,
 * and the next demand subscribes the source again. A completed source is removed.
 */
export class DerivedCell<T> {
  readonly value = new ValueCell<T>(demanded => {
    if (demanded) this.#connect();
    else this.#disconnect();
  });
  readonly #ownership = new Ownership(() => this.#source !== null);
  #source: Source<T> | null = null;
  #initialPending = false;
  #feed: Subscription | null = null;
  #suspended = false;
  readonly #name: string;

  constructor(name: string) {
    this.#name = name;
  }

  get owned$(): Observable<boolean> {
    return this.#ownership.owned$;
  }

  get sourceCount(): number {
    return this.#source === null ? 0 : 1;
  }

  setSource(observable: Observable<T>, initial: Initial<T> | undefined): void {
    if (this.#source !== null) {
      throw new Error(
        `A behavior or event source with the given identifier has already been added: ${this.#name}`,
      );
    }
    this.#source = { observable, initial };
    this.#initialPending = initial !== undefined;
    this.#ownership.changed();
    if (this.value.demand.isDemanded) this.#connect();
  }

  /** Drops the source. Subscribers stay and keep the last value. */
  detach(): void {
    this.#disconnect();
    this.#source = null;
    this.#ownership.changed();
  }

  suspend(): void {
    this.#disconnect();
    this.#suspended = true;
    this.#initialPending = this.#source?.initial !== undefined;
  }

  resume(): void {
    this.#suspended = false;
    if (this.value.demand.isDemanded) this.#connect();
  }

  dispose(): void {
    this.detach();
    this.value.complete();
  }

  #connect(): void {
    const source = this.#source;
    if (source === null || this.#feed !== null || this.#suspended) return;
    if (this.#initialPending && source.initial !== undefined) {
      this.#initialPending = false;
      this.value.set(resolveInitial(source.initial));
    }
    const feed = this.value.demand.connecting(() =>
      source.observable.subscribe({
        next: value => {
          this.value.set(value);
        },
        error: (cause: unknown) => {
          this.#feed = null;
          this.value.fail(cause);
        },
        complete: () => {
          this.#feed = null;
          if (this.#source === source) this.#source = null;
        },
      }),
    );
    if (!feed.closed) this.#feed = feed;
  }

  #disconnect(): void {
    this.#feed?.unsubscribe();
    this.#feed = null;
  }
}
