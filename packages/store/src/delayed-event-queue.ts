import { type Observable, Subject } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';

export class DelayedEventQueue {
  private queueArray: Subject<void>[] = [];

  getQueueDelayedObservable<T>(observable: Observable<T>): Observable<T> {
    return observable.pipe(mergeMap(value => this.fromDelayedQueue().pipe(map(() => value))));
  }

  private fromDelayedQueue(): Observable<void> {
    const subject = new Subject<void>();
    this.queueSubject(subject);
    return subject.asObservable();
  }

  private queueSubject(subject: Subject<void>): void {
    this.queueArray.push(subject);
    if (this.queueArray.length === 1) {
      this.signalNext();
    }
  }

  private signalNext(): void {
    setTimeout(() => {
      const queueLength = this.queueArray.length;

      for (let i = 0; i < queueLength; ++i) {
        // Each subject is a one-shot signal. Completing it ends the inner
        // subscription in getQueueDelayedObservable; without that, every
        // event stays subscribed for the lifetime of the store.
        const subject = this.queueArray[0];
        subject.next();
        this.queueArray.shift();
        subject.complete();
      }
      if (this.queueArray.length > 0) {
        this.signalNext();
      }
    }, 0);
  }
}

export default DelayedEventQueue;
