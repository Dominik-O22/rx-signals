import { expect } from 'vitest';
import { combineLatest, firstValueFrom, type Observable, of } from 'rxjs';
import { catchError, delay, filter, map, scan, startWith, take, timeout } from 'rxjs/operators';

export const getSequence = async <T>(
  observable: Observable<T>,
  length: number,
  timeoutAfter = 3000, // Jest can be slow sometimes...
): Promise<T[]> => {
  const accObservable: Observable<T[]> = observable.pipe(
    scan((acc: T[], next: T) => [...acc, next], []),
    startWith([] as T[]),
  );
  const timeoutObservable = of(true).pipe(delay(timeoutAfter), startWith(false));
  const combined: Observable<[T[], boolean]> = combineLatest([accObservable, timeoutObservable]);
  return firstValueFrom(
    combined.pipe(
      filter(([result, hasTimedOut]) => hasTimedOut || result.length === length),
      map(([result]) => result),
    ),
  );
};

export const expectSequence = async <T>(
  observable: Observable<T>,
  sequence: T[],
  timeoutAfter = 3000, // Jest can be slow sometimes...
): Promise<void> => {
  return getSequence(observable, sequence.length, timeoutAfter).then(result => {
    expect(result).toEqual(sequence);
  });
};

export const awaitStringifyEqualState = async <T>(
  observable: Observable<T>,
  expectedState: T,
  timeoutAfter = 3000,
): Promise<void> =>
  new Promise<void>(resolve => {
    observable
      .pipe(
        filter(state => JSON.stringify(state) === JSON.stringify(expectedState)),
        take(1),
        timeout(timeoutAfter),
      )
      .subscribe(() => {
        resolve();
      });
  });

export const awaitError = async (
  observable: Observable<unknown>,
  timeoutAfter = 3000,
): Promise<void> =>
  new Promise<void>(resolve => {
    observable
      .pipe(
        map(() => null),
        catchError(error => of(error)),
        filter(value => value !== null),
        take(1),
        timeout(timeoutAfter),
      )
      .subscribe(() => {
        resolve();
      });
  });

export const awaitCompletion = async (observable: Observable<unknown>): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    observable.subscribe({ error: reject, complete: resolve });
  });

export const withSubscription = async (
  observable: Observable<unknown>,
  callback: () => Promise<void>,
): Promise<void> => {
  const subscription = observable.subscribe();
  await callback();
  subscription.unsubscribe();
};
