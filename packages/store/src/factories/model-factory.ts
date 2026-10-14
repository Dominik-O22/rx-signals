import { type DerivedId, type EventId, getDerivedId, getEventId, getStateId } from '../ids';
import { SignalsFactory } from './signals-factory';

export type ModelInputSignals<T> = {
  setModel: EventId<T>;
  updateModel: EventId<Partial<T>>;
  resetModel: EventId<undefined>;
};

/** `model` mirrors an internal state, so nobody outside can add reducers or a second source to it. */
export type ModelOutputSignals<T> = {
  model: DerivedId<T>;
};

export type ModelConfig<T> = {
  defaultModel: T;
  nameExtension?: string;
};

export type ModelSignalsFactory<T> = SignalsFactory<
  ModelInputSignals<T>,
  ModelOutputSignals<T>,
  ModelConfig<T>
>;

export const getModelSignalsFactory = <T>(): ModelSignalsFactory<T> =>
  new SignalsFactory(config => {
    const name = config.nameExtension ?? '';
    const state = getStateId<T>(`${name}_state`);
    const model = getDerivedId<T>(`${name}_model`);
    const setModel = getEventId<T>(`${name}_setModel`);
    const updateModel = getEventId<Partial<T>>(`${name}_updateModel`);
    const resetModel = getEventId<undefined>(`${name}_resetModel`);
    return {
      input: { setModel, updateModel, resetModel },
      output: { model },
      effects: {},
      setup: store => {
        store.addState(state, () => config.defaultModel);
        store.addReducer(state, setModel, (_, event) => event);
        store.addReducer(state, updateModel, (current, event) => ({ ...current, ...event }));
        store.addReducer(state, resetModel, () => config.defaultModel);
        store.connect(state, model);
      },
    };
  });
