import { defer, map, type Observable, startWith, Subject } from 'rxjs';

/**
 * Whether a cell has its own source, for child stores that read their parent's cell otherwise.
 *
 * Each subscriber reads the current answer, then re-reads after every registration change. A source
 * that completes is not such a change: current subscribers keep the value it left behind and only
 * later subscribers fall back to the parent (rc23 behaved the same way).
 */
export class Ownership {
  readonly #changes = new Subject<void>();
  readonly owned$: Observable<boolean>;

  constructor(owns: () => boolean) {
    this.owned$ = defer(() => this.#changes.pipe(startWith(undefined), map(owns)));
  }

  changed(): void {
    this.#changes.next();
  }
}
