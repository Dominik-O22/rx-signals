import { type Observable, take } from 'rxjs';
import {
  type AnySignalId,
  type EffectId,
  isEffectId,
  isSignalId,
  type WritableBehavior,
  type WritableEvent,
} from '../ids';
import { type Store } from '../store';

// SignalsFactory methods check how two ids relate in their signatures (this output feeds that
// input, this effect id matches that one). In the body they index generic id records, which
// loses that link. These helpers restore it in one place each, after a runtime kind check.

const expectSignal = (value: object, name: PropertyKey): AnySignalId => {
  if (!isSignalId(value)) throw new Error(`${String(name)} is not a signal id`);
  return value;
};

/** `store.connect(from, to)` for ids taken out of id records. */
export const connectIds = (store: Store, from: object, to: object, name: PropertyKey) => {
  connectObservableTo(store, readId(store, from, name), to, name);
};

/** `store.connectObservable(source, to)` for an id taken out of an id record. */
export const connectObservableTo = (
  store: Store,
  source: Observable<unknown>,
  to: object,
  name: PropertyKey,
) => {
  const target = expectSignal(to, name);
  // The caller's signature proved the source's values fit this target.
  if (target.kind === 'event') store.connectObservable(source, target as WritableEvent<unknown>);
  else store.connectObservable(source, target as WritableBehavior<unknown>);
};

export const readId = (store: Store, from: object, name: PropertyKey): Observable<unknown> => {
  const source = expectSignal(from, name);
  return source.kind === 'event' ? store.getEventStream(source) : store.getBehavior(source);
};

/** Registers the effect found under `from` as `to`, once it exists. */
export const copyEffect = (store: Store, from: object, to: object, name: PropertyKey) => {
  if (!isEffectId(from) || !isEffectId(to)) throw new Error(`${String(name)} is not an effect id`);
  // The caller's signature proved both ids carry the same input and result types.
  const source = from as EffectId<unknown, unknown>;
  const target = to as EffectId<unknown, unknown>;
  store
    .getEffect(source)
    .pipe(take(1))
    .subscribe(effect => {
      store.addEffect(target, effect);
    });
};
