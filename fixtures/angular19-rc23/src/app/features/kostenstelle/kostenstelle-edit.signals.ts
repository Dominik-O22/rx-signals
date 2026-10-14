import {
  EventId,
  getEventId,
  getStateId,
  getValidatedInputWithResultSignalsFactory,
  Store,
} from '@rx-signals/store';
import { map } from 'rxjs';
import { notificationAdded } from '../../core/app.signals';
import {
  KostenstelleForm,
  KostenstelleSaveResult,
  KostenstelleValidation,
} from '../../core/models';

export const EMPTY_KOSTENSTELLE: KostenstelleForm = {
  nummer: '',
  bezeichnung: '',
  verantwortlich: '',
  budget: 0,
};

export const kostenstelleFormState = getStateId<KostenstelleForm>('kostenstelleForm');
export const kostenstelleLoaded: EventId<KostenstelleForm> =
  getEventId<KostenstelleForm>('kostenstelleLoaded');
export const kostenstelleFieldChanged = getEventId<Partial<KostenstelleForm>>(
  'kostenstelleFieldChanged',
);
export const kostenstelleFormReset = getEventId<undefined>('kostenstelleFormReset');

export const kostenstelleFormSetup = (store: Store): void => {
  store.addState(kostenstelleFormState, EMPTY_KOSTENSTELLE);
  store.addReducer(kostenstelleFormState, kostenstelleLoaded, (_, form) => form);
  store.addReducer(kostenstelleFormState, kostenstelleFieldChanged, (form, patch) => ({
    ...form,
    ...patch,
  }));
  store.addReducer(kostenstelleFormState, kostenstelleFormReset, () => EMPTY_KOSTENSTELLE);
};

export const kostenstelleEditFactory = getValidatedInputWithResultSignalsFactory<
  KostenstelleForm,
  KostenstelleValidation,
  KostenstelleSaveResult
>()
  .connectId(kostenstelleFormState, 'input', false)
  .extendSetup((store, _input, output) => {
    store.addEventSource(
      notificationAdded,
      store.getEventStream(output.resultSuccesses).pipe(
        map(success => ({
          kind: 'success' as const,
          text: `Kostenstelle ${success.result.nummer} gespeichert (v${success.result.version})`,
        })),
      ),
    );
  });

export const kostenstelleEditSignals = kostenstelleEditFactory.build({
  withResultTrigger: true,
  validationEffectDebounceTime: 0,
  nameExtension: 'kostenstelleEdit',
});
