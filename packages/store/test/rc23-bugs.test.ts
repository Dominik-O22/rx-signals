import { delay, EMPTY, type Observable, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { DelayedEventQueue } from '../src/delayed-event-queue';
import { type EffectConfiguration, getEffectSignalsFactory } from '../src/effect-signals-factory';
import { Store } from '../src/store';
import { getEventId, getStateId } from '../src/store-utils';
import { getValidatedInputWithResultSignalsFactory } from '../src/validated-input-with-result-signals-factory';

// Behaviors that were broken in the published 3.0.0-rc23.

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const addInputState = <T>(store: Store, initial: T) => {
  const id = getStateId<T>();
  const set = getEventId<T>();
  store.addState(id, initial);
  store.addReducer(id, set, (_, value) => value);
  return { id, set };
};

const setupTriggeredEffect = <T, R>(
  config: EffectConfiguration<T, R>,
  initial: T,
  effect: (input: T) => Observable<R>,
) => {
  const store = new Store();
  const input = addInputState(store, initial);
  const factory = getEffectSignalsFactory<T, R>().build({ withTrigger: true, ...config });
  factory.setup(store);
  store.connect(input.id, factory.input.input);
  const calls: T[] = [];
  store.addEffect(factory.effects.id, (value: T) => {
    calls.push(value);
    return effect(value);
  });
  const results: { result?: R; resultPending: boolean }[] = [];
  store.getBehavior(factory.output.combined).subscribe(value => results.push(value));
  return { store, input, trigger: factory.input.trigger, calls, latest: () => results.at(-1) };
};

describe('rc23 bugs', () => {
  it('completes the delayed event stream once its source completes', async () => {
    let completed = false;
    new DelayedEventQueue()
      .getQueueDelayedObservable(of(1, 2, 3))
      .subscribe({ complete: () => (completed = true) });
    await wait(10);
    expect(completed).toBe(true);
  });

  it('keeps state alive when a reducer throws', async () => {
    const store = new Store();
    const state = getStateId<number>();
    const add = getEventId<number>();
    store.addState(state, 0);
    store.addReducer(state, add, (value, delta) => {
      if (delta < 0) throw new Error('negative');
      return value + delta;
    });
    const seen: number[] = [];
    store.getBehavior(state).subscribe(value => seen.push(value));
    const reported = new Promise(resolve => process.once('uncaughtException', resolve));
    await store.dispatch(add, 1);
    await store.dispatch(add, -1);
    await store.dispatch(add, 2);
    await wait(10);
    expect(seen).toEqual([0, 1, 3]);
    expect(await reported).toEqual(new Error('negative'));
  });

  it('ends a lifecycle after it was reset', async () => {
    const store = new Store();
    const state = getStateId<number>();
    const set = getEventId<number>();
    const handle = store.getLifecycleHandle(lifecycleStore => {
      lifecycleStore.addState(state, 0);
      lifecycleStore.addReducer(state, set, (_, value) => value);
    });
    let completed = false;
    store.getBehavior(state).subscribe({ complete: () => (completed = true) });
    await store.dispatch(set, 5);
    handle.reset();
    handle.end();
    await wait(10);
    expect(completed).toBe(true);
  });

  it('switches child subscribers to state the child adds later', async () => {
    const parent = new Store();
    const child = parent.createChildStore();
    const state = getStateId<string>();
    parent.addState(state, 'parent');
    const seen: string[] = [];
    child.getBehavior(state).subscribe(value => seen.push(value));
    child.addState(state, 'child');
    await wait(10);
    expect(seen).toEqual(['parent', 'child']);
  });

  it('stops pending when the effect completes without a result', async () => {
    const effect = setupTriggeredEffect({ withTrigger: false }, 'A', () => EMPTY);
    await wait(10);
    expect(effect.latest()).toEqual({
      currentInput: 'A',
      resultPending: false,
    });
  });

  it('runs a trigger only for the input it was dispatched for', async () => {
    const effect = setupTriggeredEffect({}, 'A', input => of(`${input}_r`));
    await wait(10);
    effect.store.dispatch(effect.trigger);
    await wait(10);
    effect.store.dispatch(effect.input.set, 'B');
    await wait(10);
    effect.store.dispatch(effect.input.set, 'A');
    await wait(10);
    effect.store.dispatch(effect.trigger);
    await wait(10);
    effect.store.dispatch(effect.input.set, 'B');
    await wait(20);
    expect(effect.calls).toEqual(['A', 'A']);
  });

  it('keeps a trigger dispatched during the debounce window', async () => {
    const effect = setupTriggeredEffect({ effectDebounceTime: 30 }, 'A', input => of(`${input}_r`));
    await wait(50);
    effect.store.dispatch(effect.input.set, 'B');
    await wait(5);
    effect.store.dispatch(effect.trigger);
    await wait(80);
    expect(effect.calls).toEqual(['B']);
  });

  it('finishes a triggered run when an equal input arrives', async () => {
    const effect = setupTriggeredEffect<{ q: string }, string>(
      { effectInputEquals: (a, b) => a.q === b.q },
      { q: 'x' },
      input => of(`${input.q}_r`).pipe(delay(30)),
    );
    await wait(10);
    effect.store.dispatch(effect.trigger);
    await wait(10);
    effect.store.dispatch(effect.input.set, { q: 'x' });
    await wait(60);
    expect(effect.latest()?.result).toBe('x_r');
  });

  it('does not run the result effect while the input is invalid', async () => {
    const store = new Store();
    const input = addInputState(store, 'good');
    const factory = getValidatedInputWithResultSignalsFactory<
      string,
      string | null,
      string
    >().build({ withResultTrigger: true });
    factory.setup(store);
    store.connect(input.id, factory.input.input);
    const saved: string[] = [];
    store.addEffect(factory.effects.validation, (value: string) =>
      of(value.startsWith('bad') ? 'invalid' : null),
    );
    store.addEffect(factory.effects.result, (value: string) => {
      saved.push(value);
      return of(`${value}_saved`);
    });
    store.getBehavior(factory.output.combined).subscribe();
    await wait(10);
    store.dispatch(input.set, 'bad-edit');
    await wait(10);
    store.dispatch(factory.input.resultTrigger);
    await wait(20);
    expect(saved).toEqual([]);
  });
});
