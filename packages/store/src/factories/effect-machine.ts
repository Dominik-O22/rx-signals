// The effect run state machine. Pure: no rxjs, no store, no timers.
//
// A run is one execution: an input under a generation. `invalidate` raises the generation, which
// makes an equal input a new run. Two runs are the same when generation matches and the inputs
// match under `effectInputEquals`. "Should a run exist" has one answer, `wantedRun`; everything
// else follows from comparing it with the run in flight and the last finished run.
//
// The store owns `generation` and `finished` (eager states), so resets and lifecycles restore them
// and no invalidation is missed while nobody listens. The rest lives here and is rebuilt whenever
// the effect's `combined` behavior gets its first subscriber.

export type Slot<T> = { readonly has: false } | { readonly has: true; readonly value: T };

const none: Slot<never> = { has: false };
const some = <T>(value: T): Slot<T> => ({ has: true, value });

export type Run<I> = { readonly input: I; readonly generation: number };

/** The last finished run. `result` is undefined after an error or an effect that completed empty. */
export type Finished<I, R> = { readonly run: Run<I> | null; readonly result: R | undefined };

export type MachineConfig<I> = {
  readonly equals: (a: I, b: I) => boolean;
  readonly withTrigger: boolean;
};

export type MachineState<I, R> = {
  readonly generation: number;
  /** The latest input as the input behavior emitted it. Shown as `currentInput`; triggers refer to it. */
  readonly input: Slot<I>;
  /** The input after the debounce window. Decides what runs. */
  readonly settled: Slot<I>;
  /** Trigger mode: the input the last trigger referred to. A real input change clears it. */
  readonly triggered: Slot<I>;
  readonly running: Run<I> | null;
  readonly finished: Finished<I, R>;
};

export type Msg<I, R> =
  | { readonly type: 'generation'; readonly value: number }
  | { readonly type: 'input'; readonly input: I; readonly debounced: boolean }
  | { readonly type: 'settled'; readonly input: I }
  | { readonly type: 'trigger' }
  | { readonly type: 'finished'; readonly finished: Finished<I, R> };

/** Start `run` (replacing any run in flight), or stop whatever runs. */
export type Command<I, R> =
  | { readonly type: 'run'; readonly run: Run<I>; readonly previous: Finished<I, R> }
  | { readonly type: 'stop' };

export type Snapshot<I, R> = {
  currentInput?: I;
  result?: R;
  resultInput?: I;
  resultPending: boolean;
};

export const initialState = <I, R>(finished: Finished<I, R>): MachineState<I, R> => ({
  generation: 0,
  input: none,
  settled: none,
  triggered: none,
  running: null,
  finished,
});

const sameRun = <I>(config: MachineConfig<I>, a: Run<I> | null, b: Run<I> | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.generation === b.generation && config.equals(a.input, b.input));

const wantedRun = <I, R>(
  config: MachineConfig<I>,
  state: MachineState<I, R>,
  from: Slot<I>,
): Run<I> | null => {
  if (!from.has) return null;
  if (
    config.withTrigger &&
    !(state.triggered.has && config.equals(state.triggered.value, from.value))
  ) {
    return null;
  }
  return { input: from.value, generation: state.generation };
};

const isPending = <I, R>(
  config: MachineConfig<I>,
  wanted: Run<I> | null,
  finished: Finished<I, R>,
) => wanted !== null && !sameRun(config, wanted, finished.run);

export const snapshot = <I, R>(
  config: MachineConfig<I>,
  state: MachineState<I, R>,
): Snapshot<I, R> => ({
  currentInput: state.input.has ? state.input.value : undefined,
  result: state.finished.result,
  resultInput: state.finished.run?.input,
  resultPending: isPending(config, wantedRun(config, state, state.input), state.finished),
});

const reduce = <I, R>(
  config: MachineConfig<I>,
  state: MachineState<I, R>,
  msg: Msg<I, R>,
): MachineState<I, R> => {
  switch (msg.type) {
    case 'generation':
      return { ...state, generation: msg.value };
    case 'input': {
      // Only a real change withdraws a trigger; an equal input keeps an in-flight triggered run.
      const changed = !state.input.has || !config.equals(state.input.value, msg.input);
      return {
        ...state,
        input: some(msg.input),
        settled: msg.debounced ? state.settled : some(msg.input),
        triggered: changed ? none : state.triggered,
      };
    }
    case 'settled':
      return { ...state, settled: some(msg.input) };
    case 'trigger':
      // Refers to the input current now, even inside the debounce window, and starts nothing if
      // that input already finished.
      return state.input.has ? { ...state, triggered: state.input } : state;
    case 'finished':
      return {
        ...state,
        finished: msg.finished,
        running: sameRun(config, state.running, msg.finished.run) ? null : state.running,
      };
  }
};

/** One transition: the new state plus what to do about the run in flight. */
export const step = <I, R>(
  config: MachineConfig<I>,
  state: MachineState<I, R>,
  msg: Msg<I, R>,
): { readonly state: MachineState<I, R>; readonly command: Command<I, R> | null } => {
  const next = reduce(config, state, msg);
  const wanted = wantedRun(config, next, next.settled);
  if (wanted === null || !isPending(config, wanted, next.finished)) {
    return next.running === null
      ? { state: next, command: null }
      : { state: { ...next, running: null }, command: { type: 'stop' } };
  }
  if (sameRun(config, next.running, wanted)) return { state: next, command: null };
  return {
    state: { ...next, running: wanted },
    command: { type: 'run', run: wanted, previous: next.finished },
  };
};
