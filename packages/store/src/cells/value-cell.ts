import { Observable, Subject } from 'rxjs';
import { Demand } from './demand';

/** The latest value of a cell, or none yet. Replaces rc23's NO_VALUE sentinel. */
export type Latest<T> = { readonly has: false } | { readonly has: true; readonly value: T };

const none: Latest<never> = { has: false };

/**
 * Latest value, change notification and demand of a behavior.
 *
 * `observable` emits the latest value on subscribe, then every later value, each subscriber
 * deduplicating with `===`. The first subscriber's demand fires before that read, so a source that
 * emits synchronously on connect is seen fresh, not stale.
 */
export class ValueCell<T> {
  #latest: Latest<T> = none;
  #changes = new Subject<T>();
  #completed = false;
  readonly demand: Demand;
  readonly observable: Observable<T>;

  constructor(onDemand: (demanded: boolean) => void) {
    this.demand = new Demand(onDemand);
    this.observable = new Observable<T>(subscriber => {
      if (this.#completed) {
        subscriber.complete();
        return undefined;
      }
      let seen: Latest<T> = none;
      let connected = false;
      const emit = (value: T) => {
        if (!connected || (seen.has && seen.value === value)) return;
        seen = { has: true, value };
        subscriber.next(value);
      };
      // Subscribed before acquiring demand so a source failing while it connects reaches this
      // subscriber; values set while connecting are skipped in favor of the latest one below.
      const changes = this.#changes.subscribe({
        next: emit,
        error: (cause: unknown) => {
          subscriber.error(cause);
        },
        complete: () => {
          subscriber.complete();
        },
      });
      const release = this.demand.acquire();
      connected = true;
      if (this.#latest.has) emit(this.#latest.value);
      return () => {
        changes.unsubscribe();
        release();
      };
    });
  }

  get latest(): Latest<T> {
    return this.#latest;
  }

  set(value: T): void {
    if (this.#latest.has && this.#latest.value === value) return;
    this.#latest = { has: true, value };
    this.#changes.next(value);
  }

  /** Errors the current subscribers only. Later subscribers get the kept latest value. */
  fail(cause: unknown): void {
    const failing = this.#changes;
    this.#changes = new Subject<T>();
    failing.error(cause);
  }

  complete(): void {
    this.#completed = true;
    this.#changes.complete();
  }
}
