import { inject, type Injector, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { type AnyBehaviorId, type ReadsAs, Store } from '@rx-signals-next/store';

export type InjectBehaviorOptions = {
  /** Needed outside an injection context. */
  readonly injector?: Injector;
};

/**
 * Reads a behavior of the injected `Store` as an Angular signal. The subscription lives as long
 * as the injection context, so a derived behavior stays computed while the signal is alive.
 * Without `initialValue` or `requireSync` the signal is `undefined` until the behavior emits.
 */
export function injectBehavior<T>(
  id: AnyBehaviorId & ReadsAs<T>,
  options?: InjectBehaviorOptions,
): Signal<T | undefined>;
/** With `initialValue`, the signal starts there. With `requireSync: true`, it throws if the behavior has no value yet. */
export function injectBehavior<T>(
  id: AnyBehaviorId & ReadsAs<T>,
  options: InjectBehaviorOptions & ({ readonly initialValue: T } | { readonly requireSync: true }),
): Signal<T>;
export function injectBehavior<T>(
  id: AnyBehaviorId & ReadsAs<T>,
  options: InjectBehaviorOptions &
    ({ readonly initialValue: T } | { readonly requireSync?: boolean }) = {},
): Signal<T | undefined> {
  const { injector } = options;
  const behavior = (injector?.get(Store) ?? inject(Store)).getBehavior(id);
  if ('initialValue' in options) {
    return toSignal(behavior, { initialValue: options.initialValue, injector });
  }
  if (options.requireSync === true) return toSignal(behavior, { requireSync: true, injector });
  return toSignal(behavior, { injector });
}
