import { debounceTime, Observable, Subject, Subscription, switchMap, take, throwError } from 'rxjs';
import {
  type BehaviorId,
  type DerivedId,
  type EffectId,
  type EventId,
  getDerivedId,
  getEffectId,
  getEventId,
  getStateId,
} from '../ids';
import { type Effect, type Store } from '../store';
import {
  type Command,
  type Finished,
  initialState,
  type MachineConfig,
  type MachineState,
  type Msg,
  type Run,
  type Snapshot,
  snapshot,
  step,
} from './effect-machine';
import { type Signals, SignalsFactory } from './signals-factory';

export type CombinedEffectResult<Input, Result> = Snapshot<Input, Result>;

export type EffectError<Input> = { error: unknown; errorInput: Input };

export type EffectSuccess<Input, Result> = {
  result: Result;
  resultInput: Input;
  previousInput?: Input;
  previousResult?: Result;
};

export type EffectInputSignals<Input> = {
  input: DerivedId<Input>;
  /** Marks the current result stale. Never missed, even while `combined` has no subscriber. */
  invalidate: EventId<undefined>;
  /** With `withTrigger`, the current input runs only after this event. */
  trigger: EventId<undefined>;
};

export type EffectOutputSignals<Input, Result> = {
  /** Lazy: the effect runs only while this has a subscriber. */
  combined: DerivedId<CombinedEffectResult<Input, Result>>;
  errors: EventId<EffectError<Input>>;
  successes: EventId<EffectSuccess<Input, Result>>;
};

export type EffectFactoryEffects<Input, Result> = { id: EffectId<Input, Result> };

export type EffectSignals<Input, Result> = Signals<
  EffectInputSignals<Input>,
  EffectOutputSignals<Input, Result>,
  EffectFactoryEffects<Input, Result>
>;

export type EffectConfiguration<Input, Result> = {
  /** Default `===`. Decides when an input counts as a new run. */
  effectInputEquals?: (a: Input, b: Input) => boolean;
  withTrigger?: boolean;
  initialResultGetter?: () => Result;
  /** Debounces the input only; a trigger inside the window is kept. */
  effectDebounceTime?: number;
  wrappedEffectGetter?: (effect: Effect<Input, Result>) => Effect<Input, Result>;
  /** Subscribes the input eagerly, so values arriving while `combined` is unsubscribed are kept. */
  eagerInputSubscription?: boolean;
  nameExtension?: string;
};

export type EffectSignalsFactory<Input, Result> = SignalsFactory<
  EffectInputSignals<Input>,
  EffectOutputSignals<Input, Result>,
  EffectConfiguration<Input, Result>,
  EffectFactoryEffects<Input, Result>
>;

/** The ids one effect stage works on. The effect factory has one stage, the validated factory two. */
export type EffectStage<Input, Result> = EffectInputSignals<Input> &
  EffectOutputSignals<Input, Result> & { readonly effect: EffectId<Input, Result> };

export const getEffectSignalsFactory = <Input, Result>(): EffectSignalsFactory<Input, Result> =>
  new SignalsFactory(config => {
    const stage = mintEffectStage<Input, Result>(config.nameExtension ?? '');
    return {
      input: { input: stage.input, invalidate: stage.invalidate, trigger: stage.trigger },
      output: { combined: stage.combined, errors: stage.errors, successes: stage.successes },
      effects: { id: stage.effect },
      setup: store => {
        wireEffectStage(store, stage, config);
      },
    };
  });

export const mintEffectStage = <Input, Result>(name: string): EffectStage<Input, Result> => ({
  input: getDerivedId(`${name}_input`),
  invalidate: getEventId(`${name}_invalidate`),
  trigger: getEventId(`${name}_trigger`),
  combined: getDerivedId(`${name}_combined`),
  errors: getEventId(`${name}_errors`),
  successes: getEventId(`${name}_successes`),
  effect: getEffectId(name),
});

/**
 * Registers the store-owned part of a stage (`generation` counting invalidations, `finished`
 * holding the last finished run) and `combined`, whose source drives the effect machine.
 */
export const wireEffectStage = <Input, Result>(
  store: Store,
  stage: EffectStage<Input, Result>,
  config: EffectConfiguration<Input, Result>,
): void => {
  const generation = getStateId<number>();
  store.addState(generation, 0);
  store.addReducer(generation, stage.invalidate, value => value + 1);

  const initialResult = config.initialResultGetter?.();
  const finished = getStateId<Finished<Input, Result>>();
  const finishedEvent = getEventId<Finished<Input, Result>>();
  store.addState(finished, { run: null, result: initialResult });
  store.addReducer(finished, finishedEvent, (_, value) => value);

  let input: BehaviorId<Input> = stage.input;
  if (config.eagerInputSubscription === true) {
    input = getStateId<Input>();
    store.connect(stage.input, input);
  }

  const machine: MachineConfig<Input> = {
    equals: config.effectInputEquals ?? ((a, b) => a === b),
    withTrigger: config.withTrigger === true,
  };
  const debounce = config.effectDebounceTime ?? 0;
  const wrap = config.wrappedEffectGetter ?? (effect => effect);

  const runEffect = (run: Run<Input>, previous: Finished<Input, Result>): Subscription => {
    let delivered = false;
    const previousInput = previous.run?.input;
    return store
      .getEffect(stage.effect)
      .pipe(
        take(1),
        switchMap(effect => {
          try {
            return wrap(effect)(run.input, store, previousInput, previous.result).pipe(take(1));
          } catch (error) {
            return throwError(() => error);
          }
        }),
      )
      .subscribe({
        next: result => {
          delivered = true;
          void store.dispatch(finishedEvent, { run, result });
          void store.dispatch(stage.successes, {
            result,
            resultInput: run.input,
            previousInput,
            previousResult: previous.result,
          });
        },
        error: (error: unknown) => {
          void store.dispatch(stage.errors, { error, errorInput: run.input });
          void store.dispatch(finishedEvent, { run, result: undefined });
        },
        complete: () => {
          if (!delivered) void store.dispatch(finishedEvent, { run, result: undefined });
        },
      });
  };

  const drive = new Observable<CombinedEffectResult<Input, Result>>(subscriber => {
    let state: MachineState<Input, Result> = initialState({ run: null, result: initialResult });
    let running = new Subscription();
    let last: CombinedEffectResult<Input, Result> | null = null;
    const mailbox: Msg<Input, Result>[] = [];
    let draining = false;

    const apply = (command: Command<Input, Result>) => {
      running.unsubscribe();
      if (command.type === 'run') running = runEffect(command.run, command.previous);
    };

    // A synchronous effect must not re-enter `step`, so messages queue while one is processed.
    const send = (msg: Msg<Input, Result>) => {
      mailbox.push(msg);
      if (draining) return;
      draining = true;
      for (let next = mailbox.shift(); next !== undefined; next = mailbox.shift()) {
        const result = step(machine, state, next);
        state = result.state;
        if (result.command !== null) apply(result.command);
        if (state.input.has) {
          const current = snapshot(machine, state);
          if (last === null || !sameSnapshot(last, current)) {
            last = current;
            subscriber.next(current);
          }
        }
      }
      draining = false;
    };

    const subscriptions = new Subscription(() => {
      running.unsubscribe();
    });
    subscriptions.add(
      store.getBehavior(generation).subscribe(value => {
        send({ type: 'generation', value });
      }),
    );
    subscriptions.add(
      store.getBehavior(finished).subscribe(value => {
        send({ type: 'finished', finished: value });
      }),
    );
    if (machine.withTrigger) {
      subscriptions.add(
        store.getEventStream(stage.trigger).subscribe(() => {
          send({ type: 'trigger' });
        }),
      );
    }
    const raw = new Subject<Input>();
    if (debounce > 0) {
      subscriptions.add(
        raw.pipe(debounceTime(debounce)).subscribe(value => {
          send({ type: 'settled', input: value });
        }),
      );
    }
    subscriptions.add(
      store.getBehavior(input).subscribe(value => {
        send({ type: 'input', input: value, debounced: debounce > 0 });
        raw.next(value);
      }),
    );
    return subscriptions;
  });

  store.addDerivedState(
    stage.combined,
    drive,
    config.initialResultGetter ? { result: initialResult, resultPending: false } : undefined,
  );
};

const sameSnapshot = <I, R>(a: Snapshot<I, R>, b: Snapshot<I, R>): boolean =>
  a.currentInput === b.currentInput &&
  a.result === b.result &&
  a.resultInput === b.resultInput &&
  a.resultPending === b.resultPending;
