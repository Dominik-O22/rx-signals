import { config } from 'rxjs';
import { type AnyBehaviorId, type AnyEventId } from './ids';

/**
 * A failure the store absorbed instead of propagating. The state it touched keeps its value,
 * and the event stream it touched keeps running.
 */
export type StoreError =
  | {
      readonly origin: 'reducer';
      readonly state: AnyBehaviorId;
      readonly event: AnyEventId;
      readonly cause: unknown;
    }
  | {
      readonly origin: 'state-feed';
      readonly state: AnyBehaviorId;
      readonly cause: unknown;
    }
  | {
      readonly origin: 'event-source';
      readonly events: readonly AnyEventId[];
      readonly cause: unknown;
    };

export type StoreOptions = {
  /**
   * Receives every StoreError. Default: rxjs `config.onUnhandledError` with the cause when set,
   * else an asynchronous rethrow of the cause, so nothing is silent. Child stores use their root's.
   */
  readonly onError?: (error: StoreError) => void;
  /** Schedules a queue flush. Default `setTimeout(flush, 0)`. Child stores use their root's. */
  readonly schedule?: (flush: () => void) => void;
};

export const reportUnhandled = (error: StoreError): void => {
  if (config.onUnhandledError) {
    config.onUnhandledError(error.cause);
    return;
  }
  setTimeout(() => {
    throw error.cause;
  });
};
