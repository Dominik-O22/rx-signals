/**
 * The one event queue of a store tree. Child stores share their root's queue, so delivery order is
 * the order of `push` across all event ids and across parent and child.
 *
 * Delivery is never synchronous with `push`. A flush delivers the tasks queued when it started, in
 * order; tasks pushed during a flush wait for the next one. A delivered task is dropped, so nothing
 * is retained per event (rc23 kept one subscription per event alive).
 */
export class EventQueue {
  #pending: (() => void)[] = [];
  #scheduled = false;
  #idleWaiters: (() => void)[] = [];
  readonly #schedule: (flush: () => void) => void;

  constructor(schedule: (flush: () => void) => void) {
    this.#schedule = schedule;
  }

  push(task: () => void): void {
    this.#pending.push(task);
    if (!this.#scheduled) {
      this.#scheduled = true;
      this.#schedule(() => {
        this.#flush();
      });
    }
  }

  /** Resolves once nothing is queued. */
  whenIdle(): Promise<void> {
    if (!this.#scheduled) return Promise.resolve();
    return new Promise(resolve => this.#idleWaiters.push(resolve));
  }

  #flush(): void {
    const batch = this.#pending;
    this.#pending = [];
    this.#scheduled = false;
    batch.forEach(task => {
      task();
    });
    if (this.#pending.length === 0) {
      const waiters = this.#idleWaiters;
      this.#idleWaiters = [];
      waiters.forEach(resolve => {
        resolve();
      });
    }
  }
}

export const defaultSchedule = (flush: () => void): void => {
  setTimeout(flush, 0);
};
