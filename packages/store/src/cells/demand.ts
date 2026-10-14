import { BehaviorSubject, type Observable } from 'rxjs';

/**
 * Counts who needs a cell and reports the 0 to 1 and 1 to 0 transitions.
 *
 * A subscription made while the cell itself is connecting its own sources is not counted. That is
 * a source reading the cell it feeds (`withLatestFrom(getBehavior(self))`, or an event source on
 * its own stream). Counting it would keep the cell demanded forever, so it could never go lazy.
 */
export class Demand {
  #count = 0;
  #connecting = false;
  readonly #subscribed = new BehaviorSubject(false);
  readonly #onChange: (demanded: boolean) => void;

  constructor(onChange: (demanded: boolean) => void) {
    this.#onChange = onChange;
  }

  get isDemanded(): boolean {
    return this.#count > 0;
  }

  get subscribed$(): Observable<boolean> {
    return this.#subscribed;
  }

  /** Adds one unit of demand unless the cell is connecting. Returns the matching release. */
  acquire(): () => void {
    if (this.#connecting) return () => undefined;
    if (++this.#count === 1) {
      this.#subscribed.next(true);
      this.#onChange(true);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.#count === 0) {
        this.#subscribed.next(false);
        this.#onChange(false);
      }
    };
  }

  /** Runs `connect` with this cell marked as connecting, see the class comment. */
  connecting<R>(connect: () => R): R {
    const outer = this.#connecting;
    this.#connecting = true;
    try {
      return connect();
    } finally {
      this.#connecting = outer;
    }
  }
}
