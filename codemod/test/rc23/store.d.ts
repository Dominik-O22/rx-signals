// The part of @rx-signals/store@3.0.0-rc23's declarations the typed rules look at. Id types and
// MergedConfiguration are copied from rc23; signatures are trimmed to what the tests call.
export interface Observable<T> {
  subscribe(next: (value: T) => void): unknown;
}

export type StateId<T> = symbol & { _rootStateType: T };
export type DerivedId<T> = symbol & { _derivedStateType: T };
export type BehaviorId<T> = StateId<T> | DerivedId<T>;
export type EventId<T> = symbol & { _eventType: T };
export type SignalId<T> = BehaviorId<T> | EventId<T>;
export type EffectId<InputType, ResultType> = symbol & {
  _inputType: InputType;
  _resultType: ResultType;
};
export type ToSignalIdValueType<S> = S extends SignalId<infer T> ? T : never;
export type ToSignalId<S> = S extends SignalId<infer T> ? SignalId<T> : never;

export declare const getStateId: <T>(nameExtension?: string) => StateId<T>;
export declare const getDerivedId: <T>(nameExtension?: string) => DerivedId<T>;
export declare const getEventId: <T>(nameExtension?: string) => EventId<T>;
export declare const getEffectId: <InputType, ResultType>(
  nameExtension?: string,
) => EffectId<InputType, ResultType>;
export declare const isStateId: <T>(id: SignalId<T>) => boolean;
export declare const isDerivedId: <T>(id: SignalId<T>) => boolean;
export declare const isBehaviorId: <T>(id: SignalId<T>) => boolean;
export declare const isEventId: <T>(id: SignalId<T>) => boolean;
export declare const NO_VALUE: symbol;

export type Configuration = Record<string, any>;
export type MergedConfiguration<
  T1 extends Configuration,
  T2 extends Configuration,
> = keyof T1 extends never ? T1 & T2 : keyof T2 extends never ? T1 & T2 : { c1: T1; c2: T2 };

export type AddSignalId<T, N extends string, ID> = T & Record<N, ID>;
export type AddEffectId<T, N extends string, ID> = T & Record<N, ID>;
export type AddOrReplaceId<T, N extends string, ID> = Omit<T, N> & Record<N, ID>;
export type RenameEffectId<T, K1 extends keyof T, K2 extends string> = Omit<T, K1> &
  Record<K2, T[K1]>;

export type TypedEvent<T> = { type: EventId<T>; event: T };

export declare class Store {
  addState<T>(id: StateId<T>, initial: T): void;
  addDerivedState<T>(id: DerivedId<T>, source: Observable<T>, initial?: T | symbol): void;
  getBehavior<T>(id: BehaviorId<T>): Observable<T>;
  add2TypedEventSource<A, B>(
    a: EventId<A>,
    b: EventId<B>,
    source: Observable<TypedEvent<A> | TypedEvent<B>>,
    onlyIfSubscribed?: EventId<any> | null,
  ): symbol;
  add3TypedEventSource<A, B, C>(
    a: EventId<A>,
    b: EventId<B>,
    c: EventId<C>,
    source: Observable<TypedEvent<A> | TypedEvent<B> | TypedEvent<C>>,
    onlyIfSubscribed?: EventId<any> | null,
  ): symbol;
  isSubscribed<T>(id: SignalId<T>): boolean;
  getIsSubscribedObservable<T>(id: SignalId<T>): Observable<boolean>;
  getNumberOfBehaviorSources<T>(id: BehaviorId<T>): number;
  getNumberOfEventSources<T>(id: EventId<T>): number;
  setIdName<T>(id: SignalId<T>, name: string): void;
  getIdName<T>(id: SignalId<T>): string;
}

export declare class SignalsFactory<IN, OUT, CONFIG extends Configuration = {}, EFF = {}> {
  compose<IN2, OUT2, CONFIG2 extends Configuration, EFF2>(
    factory2: SignalsFactory<IN2, OUT2, CONFIG2, EFF2>,
  ): SignalsFactory<IN & IN2, OUT & OUT2, MergedConfiguration<CONFIG, CONFIG2>, EFF & EFF2>;
  connect<KIN extends keyof IN, KOUT extends keyof OUT, B extends boolean>(
    outputName: KOUT,
    inputName: KIN,
    keepInputId: B,
  ): B extends true
    ? SignalsFactory<IN, OUT, CONFIG, EFF>
    : SignalsFactory<Omit<IN, KIN>, OUT, CONFIG, EFF>;
  connectId<K extends keyof IN, B extends boolean>(
    fromId: SignalId<any>,
    inputName: K,
    keepInputId: B,
  ): B extends true
    ? SignalsFactory<IN, OUT, CONFIG, EFF>
    : SignalsFactory<Omit<IN, K>, OUT, CONFIG, EFF>;
  connectObservable<K extends keyof IN, B extends boolean>(
    sourceGetter: (store: Store, output: OUT, config: CONFIG) => Observable<unknown>,
    inputName: K,
    keepInputId: B,
  ): B extends true
    ? SignalsFactory<IN, OUT, CONFIG, EFF>
    : SignalsFactory<Omit<IN, K>, OUT, CONFIG, EFF>;
  useExistingEffect<K extends keyof EFF, B extends boolean>(
    name: K,
    idGetter: (config: CONFIG) => EffectId<any, any>,
    keepEffectId: B,
  ): B extends true
    ? SignalsFactory<IN, OUT, CONFIG, EFF>
    : SignalsFactory<IN, OUT, CONFIG, Omit<EFF, K>>;
  removeInputId<K extends keyof IN>(name: K): SignalsFactory<Omit<IN, K>, OUT, CONFIG, EFF>;
  removeEffectId<K extends keyof EFF>(name: K): SignalsFactory<IN, OUT, CONFIG, Omit<EFF, K>>;
}
