import { type Observable } from 'rxjs';
import {
  type AnyBehaviorId,
  type AnyEffectId,
  type AnySignalId,
  type DerivedId,
  getDerivedId,
  type ReadableSignal,
  type ToSignalIdValueType,
} from '../ids';
import { type Store } from '../store';
import { type KeysOfValueType, merge, type Merged, type WithValueType } from './merge';
import { connectIds, connectObservableTo, copyEffect, readId } from './record-ids';

// Recursive, so it cannot be written with Record.

export type NameToSignalId = { readonly [key: string]: AnySignalId | NameToSignalId };

export type NameToEffectId = { readonly [key: string]: AnyEffectId | NameToEffectId };

/** The id record of a factory without ids of that kind. */
// eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type
export type NoIds = Record<never, never>;

export type SignalIds<IN extends NameToSignalId, OUT extends NameToSignalId> = {
  readonly input: IN;
  readonly output: OUT;
};
export type EffectIds<EFF extends NameToEffectId> = { readonly effects: EFF };
export type SetupWithStore = { readonly setup: (store: Store) => void };

/**
 * `input`: ids the caller feeds (dispatch, connect). `output`: ids `setup` registers.
 * `effects`: effect ids the caller registers with `addEffect` or `useExistingEffect`.
 */
export type Signals<
  IN extends NameToSignalId,
  OUT extends NameToSignalId,
  EFF extends NameToEffectId = NoIds,
> = SetupWithStore & SignalIds<IN, OUT> & EffectIds<EFF>;

/** Mints fresh ids on every call, so two builds of one factory never share ids. */
export type SignalsBuild<
  IN extends NameToSignalId,
  OUT extends NameToSignalId,
  CONFIG extends object,
  EFF extends NameToEffectId,
> = (config: CONFIG) => Signals<IN, OUT, EFF>;

export type ExtendSetup<
  IN extends NameToSignalId,
  OUT extends NameToSignalId,
  CONFIG extends object,
  EFF extends NameToEffectId,
> = (store: Store, input: IN, output: OUT, config: CONFIG, effects: EFF) => void;

export type MapConfig<CONFIG1 extends object, CONFIG2 extends object> = (
  config: CONFIG2,
) => CONFIG1;
export type MapSignalIds<T1 extends NameToSignalId, T2 extends NameToSignalId, CONFIG> = (
  ids: T1,
  config: CONFIG,
) => T2;
export type MapEffectIds<T1 extends NameToEffectId, T2 extends NameToEffectId, CONFIG> = (
  ids: T1,
  config: CONFIG,
) => T2;

/** `T` plus key `N`. One type for signal and effect id records. */
export type AddId<T extends object, N extends string, ID> = T & Readonly<Record<N, ID>>;
/** `T` with key `N1` moved to `N2`. */
export type RenameId<T extends object, N1 extends keyof T, N2 extends string> = Omit<T, N1 | N2> &
  Readonly<Record<N2, T[N1]>>;
/** `T` with the id under `N` replaced. */
export type ReplaceId<T extends object, N extends keyof T, ID> = Omit<T, N> &
  Readonly<Record<N, ID>>;

/** Rejects a key that exists already, with a message that says so. */
type FreshKey<K extends string, T> = K extends keyof T ? `'${K}' already exists` : K;

/** Keys of config shared by both sides whose types cannot both hold (their intersection is never). */
type IncompatibleKeys<C1, C2> = {
  [K in keyof C1 & keyof C2]: [C1[K] & C2[K]] extends [never] ? K : never;
}[keyof C1 & keyof C2];

type CompatibleConfig<C1, C2> = [IncompatibleKeys<C1, C2>] extends [never]
  ? unknown
  : { readonly incompatibleConfigKeys: IncompatibleKeys<C1, C2> };

type ValueOf<ID> = ToSignalIdValueType<ID>;

const addKey = <T extends object, N extends string, ID>(record: T, name: N, id: ID) =>
  // Spreading with a computed key widens to an index signature; the result has exactly key N added.
  ({ ...record, [name]: id }) as AddId<T, N, ID>;

const renameKey = <T extends object, N1 extends keyof T, N2 extends string>(
  record: T,
  from: N1,
  to: N2,
) => {
  const { [from]: moved, ...rest } = record;
  // Same widening as in addKey: the result is `rest` plus key N2.
  return { ...rest, [to]: moved } as RenameId<T, N1, N2>;
};

const omitKey = <T extends object, N extends keyof T>(record: T, name: N): Omit<T, N> => {
  const copy = { ...record };
  Reflect.deleteProperty(copy, name);
  return copy;
};

/**
 * Immutable description of a group of signals. Every method returns a new factory; `build` mints
 * fresh ids and returns a `setup` that wires them into a store.
 */
export class SignalsFactory<
  IN extends NameToSignalId,
  OUT extends NameToSignalId,
  CONFIG extends object = object,
  EFF extends NameToEffectId = NoIds,
> {
  constructor(readonly build: SignalsBuild<IN, OUT, CONFIG, EFF>) {}

  /**
   * Builds both factories with the same config and merges their ids; ids with the same name move
   * under `conflicts1` / `conflicts2`. Give each side its own config with `nestConfig`.
   */
  compose<
    IN2 extends NameToSignalId,
    OUT2 extends NameToSignalId,
    CONFIG2 extends object,
    EFF2 extends NameToEffectId,
  >(
    other: SignalsFactory<IN2, OUT2, CONFIG2, EFF2> & CompatibleConfig<CONFIG, CONFIG2>,
  ): SignalsFactory<Merged<IN, IN2>, Merged<OUT, OUT2>, CONFIG & CONFIG2, Merged<EFF, EFF2>> {
    return new SignalsFactory(config => {
      const first = this.build(config);
      const second = other.build(config);
      return {
        setup: store => {
          first.setup(store);
          second.setup(store);
        },
        input: merge(first.input, second.input),
        output: merge(first.output, second.output),
        effects: merge(first.effects, second.effects),
      };
    });
  }

  /** Reads this factory's config from `config[key]`. `a.nestConfig('c1').compose(b.nestConfig('c2'))` takes `{ c1, c2 }`. */
  nestConfig<K extends string>(key: K): SignalsFactory<IN, OUT, Readonly<Record<K, CONFIG>>, EFF> {
    return this.mapConfig((config: Readonly<Record<K, CONFIG>>) => config[key]);
  }

  mapConfig<CONFIG2 extends object>(
    mapper: MapConfig<CONFIG, CONFIG2>,
  ): SignalsFactory<IN, OUT, CONFIG2, EFF> {
    return new SignalsFactory(config => this.build(mapper(config)));
  }

  /** Escape hatch for anything the named methods do not cover. */
  fmap<
    IN2 extends NameToSignalId,
    OUT2 extends NameToSignalId,
    CONFIG2 extends object,
    EFF2 extends NameToEffectId,
  >(
    mapper: (build: SignalsBuild<IN, OUT, CONFIG, EFF>) => SignalsBuild<IN2, OUT2, CONFIG2, EFF2>,
  ): SignalsFactory<IN2, OUT2, CONFIG2, EFF2> {
    return new SignalsFactory(mapper(this.build));
  }

  /** Runs `extend` after this factory's setup. */
  extendSetup(extend: ExtendSetup<IN, OUT, CONFIG, EFF>): SignalsFactory<IN, OUT, CONFIG, EFF> {
    return this.fmap(build => config => {
      const signals = build(config);
      return {
        ...signals,
        setup: store => {
          signals.setup(store);
          extend(store, signals.input, signals.output, config, signals.effects);
        },
      };
    });
  }

  /** In setup, connects `output[from]` into `input[to]`. Chain `.removeInputId(to)` to hide the input. */
  connect<KIN extends keyof IN & string>(
    from: keyof WithValueType<OUT, ReadableSignal<ValueOf<IN[KIN]>>>,
    to: KIN,
  ): SignalsFactory<IN, OUT, CONFIG, EFF> {
    return this.extendSetup((store, input, output) => {
      connectIds(store, output[from], input[to], to);
    });
  }

  /** In setup, connects `fromId` into `input[to]`. */
  connectId<KIN extends keyof IN & string>(
    fromId: ReadableSignal<ValueOf<IN[KIN]>>,
    to: KIN,
  ): SignalsFactory<IN, OUT, CONFIG, EFF> {
    return this.extendSetup((store, input) => {
      connectIds(store, fromId, input[to], to);
    });
  }

  /** In setup, connects `source(store, output, config)` into `input[to]`. */
  connectObservable<KIN extends keyof IN & string>(
    source: (store: Store, output: OUT, config: CONFIG) => Observable<ValueOf<IN[KIN]>>,
    to: KIN,
  ): SignalsFactory<IN, OUT, CONFIG, EFF> {
    return this.extendSetup((store, input, output, config) => {
      connectObservableTo(store, source(store, output, config), input[to], to);
    });
  }

  mapInput<IN2 extends NameToSignalId>(
    mapper: MapSignalIds<IN, IN2, CONFIG>,
  ): SignalsFactory<IN2, OUT, CONFIG, EFF> {
    return this.fmap(build => config => {
      const signals = build(config);
      return { ...signals, input: mapper(signals.input, config) };
    });
  }

  addInputId<K extends string, ID extends AnySignalId>(
    name: FreshKey<K, IN>,
    id: (config: CONFIG) => ID,
  ): SignalsFactory<AddId<IN, K, ID>, OUT, CONFIG, EFF> {
    return this.mapInput((input, config) => addKey(input, name as K, id(config)));
  }

  renameInputId<K1 extends keyof IN, K2 extends string>(
    from: K1,
    to: K2,
  ): SignalsFactory<RenameId<IN, K1, K2>, OUT, CONFIG, EFF> {
    return this.mapInput(input => renameKey(input, from, to));
  }

  removeInputId<K extends keyof IN>(name: K): SignalsFactory<Omit<IN, K>, OUT, CONFIG, EFF> {
    return this.mapInput(input => omitKey(input, name));
  }

  mapOutput<OUT2 extends NameToSignalId>(
    mapper: MapSignalIds<OUT, OUT2, CONFIG>,
  ): SignalsFactory<IN, OUT2, CONFIG, EFF> {
    return this.fmap(build => config => {
      const signals = build(config);
      return { ...signals, output: mapper(signals.output, config) };
    });
  }

  addOutputId<K extends string, ID extends AnySignalId>(
    name: FreshKey<K, OUT>,
    id: (config: CONFIG) => ID,
  ): SignalsFactory<IN, AddId<OUT, K, ID>, CONFIG, EFF> {
    return this.mapOutput((output, config) => addKey(output, name as K, id(config)));
  }

  renameOutputId<K1 extends keyof OUT, K2 extends string>(
    from: K1,
    to: K2,
  ): SignalsFactory<IN, RenameId<OUT, K1, K2>, CONFIG, EFF> {
    return this.mapOutput(output => renameKey(output, from, to));
  }

  removeOutputId<K extends keyof OUT>(name: K): SignalsFactory<IN, Omit<OUT, K>, CONFIG, EFF> {
    return this.mapOutput(output => omitKey(output, name));
  }

  /** Replaces output behavior `name` by a new DerivedId mapped from it. */
  mapOutputBehavior<T, K extends KeysOfValueType<OUT, AnyBehaviorId> & string>(
    name: K,
    mapper: (
      old: Observable<ValueOf<OUT[K]>>,
      store: Store,
      input: IN,
      output: OUT,
      config: CONFIG,
    ) => Observable<T>,
  ): SignalsFactory<IN, ReplaceId<OUT, K, DerivedId<T>>, CONFIG, EFF> {
    return this.fmap(build => config => {
      const signals = build(config);
      const mapped = getDerivedId<T>();
      return {
        ...signals,
        setup: store => {
          // The key constraint proved `output[name]` is a behavior of this value type.
          const old = readId(store, signals.output[name], name) as Observable<ValueOf<OUT[K]>>;
          store.addDerivedState(mapped, mapper(old, store, signals.input, signals.output, config));
          signals.setup(store);
        },
        output: { ...omitKey(signals.output, name), ...addKey({}, name, mapped) },
      };
    });
  }

  mapEffects<EFF2 extends NameToEffectId>(
    mapper: MapEffectIds<EFF, EFF2, CONFIG>,
  ): SignalsFactory<IN, OUT, CONFIG, EFF2> {
    return this.fmap(build => config => {
      const signals = build(config);
      return { ...signals, effects: mapper(signals.effects, config) };
    });
  }

  addEffectId<K extends string, ID extends AnyEffectId>(
    name: FreshKey<K, EFF>,
    id: (config: CONFIG) => ID,
  ): SignalsFactory<IN, OUT, CONFIG, AddId<EFF, K, ID>> {
    return this.mapEffects((effects, config) => addKey(effects, name as K, id(config)));
  }

  renameEffectId<K1 extends keyof EFF, K2 extends string>(
    from: K1,
    to: K2,
  ): SignalsFactory<IN, OUT, CONFIG, RenameId<EFF, K1, K2>> {
    return this.mapEffects(effects => renameKey(effects, from, to));
  }

  removeEffectId<K extends keyof EFF>(name: K): SignalsFactory<IN, OUT, CONFIG, Omit<EFF, K>> {
    return this.mapEffects(effects => omitKey(effects, name));
  }

  /**
   * In setup, registers the effect under `existing(config)` as `effects[name]`. Ids are invariant,
   * so `existing` must return exactly the type of `effects[name]`. Chain `.removeEffectId(name)`
   * to hide the id.
   */
  useExistingEffect<K extends KeysOfValueType<EFF, AnyEffectId> & string>(
    name: K,
    existing: (config: CONFIG) => EFF[K],
  ): SignalsFactory<IN, OUT, CONFIG, EFF> {
    return this.extendSetup((store, _input, _output, config, effects) => {
      copyEffect(store, existing(config), effects[name], name);
    });
  }
}
