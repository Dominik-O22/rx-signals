import { Observable, Subject, type Subscription } from 'rxjs';
import { type EventQueue } from '../queue';
import { Demand } from './demand';

/**
 * An event stream: a Subject, its demand, and lazy sources keyed by handle.
 *
 * Sources run only while the stream is demanded. A completed source is removed. Sources arrive
 * already guarded by the store, so they never error into this cell. Every value takes exactly one
 * queue hop: `emit` and `dispatch` enqueue, the flush delivers to whoever subscribes by then.
 */
export class EventCell<T> {
  readonly #subject = new Subject<T>();
  readonly #sources = new Map<
    object,
    { readonly source: Observable<T>; running: Subscription | null }
  >();
  readonly #queue: EventQueue;
  readonly demand = new Demand(demanded => {
    if (demanded)
      this.#sources.forEach((_, handle) => {
        this.#start(handle);
      });
    else
      this.#sources.forEach((_, handle) => {
        this.#stop(handle);
      });
  });
  readonly observable = new Observable<T>(subscriber => {
    const subscription = this.#subject.subscribe(subscriber);
    const release = this.demand.acquire();
    return () => {
      subscription.unsubscribe();
      release();
    };
  });

  constructor(queue: EventQueue) {
    this.#queue = queue;
  }

  get sourceCount(): number {
    return this.#sources.size;
  }

  /** Enqueues `value` if anybody listens now. Nobody listening means the event is dropped. */
  emit(value: T): void {
    if (!this.#subject.observed) return;
    this.#queue.push(() => {
      this.#subject.next(value);
    });
  }

  /** Like `emit`, but tells whether the event was delivered. Never rejects. */
  dispatch(value: T): Promise<boolean> {
    if (!this.#subject.observed) return Promise.resolve(false);
    return new Promise(resolve => {
      this.#queue.push(() => {
        this.#subject.next(value);
        resolve(true);
      });
    });
  }

  addSource(handle: object, source: Observable<T>): void {
    this.#sources.set(handle, { source, running: null });
    if (this.demand.isDemanded) this.#start(handle);
  }

  removeSource(handle: object): void {
    this.#stop(handle);
    this.#sources.delete(handle);
  }

  dispose(): void {
    [...this.#sources.keys()].forEach(handle => {
      this.removeSource(handle);
    });
    this.#subject.complete();
  }

  #start(handle: object): void {
    const entry = this.#sources.get(handle);
    if (entry?.running !== null) return;
    const running = this.demand.connecting(() =>
      entry.source.subscribe({
        next: value => {
          this.emit(value);
        },
        complete: () => {
          this.#sources.delete(handle);
        },
      }),
    );
    if (!running.closed) entry.running = running;
  }

  #stop(handle: object): void {
    const entry = this.#sources.get(handle);
    entry?.running?.unsubscribe();
    if (entry !== undefined) entry.running = null;
  }
}
