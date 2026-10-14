import {
  combineLatest,
  concatMap,
  distinctUntilChanged,
  filter,
  map,
  type Observable,
  startWith,
  switchMap,
  take,
  takeWhile,
  withLatestFrom,
} from 'rxjs';
import { type DerivedId, type EffectId, type EventId, getDerivedId, getEventId } from '../ids';
import { type Store } from '../store';
import {
  type CombinedEffectResult,
  type EffectError,
  type EffectSuccess,
  mintEffectStage,
  wireEffectStage,
} from './effect-factory';
import { SignalsFactory } from './signals-factory';

export type ValidatedInputWithResult<Input, ValidationResult, Result> = {
  currentInput?: Input;
  validationPending: boolean;
  validatedInput?: Input;
  validationResult?: ValidationResult;
  isValid: boolean;
  resultPending: boolean;
  resultInput?: Input;
  result?: Result;
};

export type ValidatedInputWithResultInput<Input> = {
  input: DerivedId<Input>;
  validationInvalidate: EventId<undefined>;
  resultInvalidate: EventId<undefined>;
  resultTrigger: EventId<undefined>;
};

export type ValidatedInputWithResultOutput<Input, ValidationResult, Result> = {
  combined: DerivedId<ValidatedInputWithResult<Input, ValidationResult, Result>>;
  validationErrors: EventId<EffectError<Input>>;
  validationSuccesses: EventId<EffectSuccess<Input, ValidationResult>>;
  resultErrors: EventId<EffectError<Input>>;
  resultSuccesses: EventId<EffectSuccess<Input, Result>>;
};

export type ValidatedInputWithResultConfig<Input, ValidationResult, Result> = {
  /** Default: valid when the validation result is `null`. */
  isValidationResultValid?: (validationResult: ValidationResult) => boolean;
  validationEffectDebounceTime?: number;
  resultEffectDebounceTime?: number;
  initialResultGetter?: () => Result;
  withResultTrigger?: boolean;
  resultEffectInputEquals?: (a: Input, b: Input) => boolean;
  eagerInputSubscription?: boolean;
  nameExtension?: string;
};

export type ValidatedInputWithResultEffects<Input, ValidationResult, Result> = {
  validation: EffectId<Input, ValidationResult>;
  result: EffectId<Input, Result>;
};

export type ValidatedInputWithResultFactory<Input, ValidationResult, Result> = SignalsFactory<
  ValidatedInputWithResultInput<Input>,
  ValidatedInputWithResultOutput<Input, ValidationResult, Result>,
  ValidatedInputWithResultConfig<Input, ValidationResult, Result>,
  ValidatedInputWithResultEffects<Input, ValidationResult, Result>
>;

/** The last input whose validation finished valid while it was still the current input. */
const latestValidInput = <Input, ValidationResult>(
  validation: Observable<CombinedEffectResult<Input, ValidationResult>>,
  isValid: (validationResult: ValidationResult) => boolean,
): Observable<Input> =>
  validation.pipe(
    concatMap(({ currentInput, resultInput, result }) =>
      resultInput !== undefined &&
      result !== undefined &&
      currentInput === resultInput &&
      isValid(result)
        ? [resultInput]
        : [],
    ),
    distinctUntilChanged(),
  );

/**
 * A result trigger waits for the validation of the input current at trigger time, is dropped if the
 * input changes first, and passes only if that input turned out valid. Forwarding it at once would
 * run the result effect for the last valid input while the current one is invalid or unvalidated.
 */
const validatedTrigger = <Input, ValidationResult>(
  trigger: Observable<undefined>,
  validation: Observable<CombinedEffectResult<Input, ValidationResult>>,
  isValid: (validationResult: ValidationResult) => boolean,
): Observable<undefined> =>
  trigger.pipe(
    withLatestFrom(validation),
    switchMap(([, atTrigger]) =>
      validation.pipe(
        takeWhile(v => v.currentInput === atTrigger.currentInput),
        filter(v => !v.resultPending && v.resultInput === v.currentInput),
        take(1),
      ),
    ),
    filter(v => v.result !== undefined && isValid(v.result)),
    map(() => undefined),
  );

const combine = <Input, ValidationResult, Result>(
  validation: CombinedEffectResult<Input, ValidationResult>,
  result: CombinedEffectResult<Input, Result>,
  isValid: (validationResult: ValidationResult) => boolean,
): ValidatedInputWithResult<Input, ValidationResult, Result> => ({
  currentInput: validation.currentInput,
  validationPending: validation.resultPending,
  validatedInput: validation.resultInput,
  validationResult: validation.result,
  isValid: validation.result !== undefined ? isValid(validation.result) : false,
  resultPending: result.resultPending,
  resultInput: result.resultInput,
  result: result.result,
});

const sameState = <Input, ValidationResult, Result>(
  a: ValidatedInputWithResult<Input, ValidationResult, Result>,
  b: ValidatedInputWithResult<Input, ValidationResult, Result>,
): boolean =>
  a.currentInput === b.currentInput &&
  a.isValid === b.isValid &&
  a.result === b.result &&
  a.resultInput === b.resultInput &&
  a.resultPending === b.resultPending &&
  a.validatedInput === b.validatedInput &&
  a.validationPending === b.validationPending &&
  a.validationResult === b.validationResult;

/**
 * A validation stage and a result stage of the effect machine. The result stage only ever sees
 * inputs that passed validation.
 */
export const getValidatedInputWithResultSignalsFactory = <
  Input,
  ValidationResult,
  Result,
>(): ValidatedInputWithResultFactory<Input, ValidationResult, Result> =>
  new SignalsFactory(config => {
    const name = config.nameExtension ?? '';
    const validation = mintEffectStage<Input, ValidationResult>(`${name}_validation`);
    const result = mintEffectStage<Input, Result>(`${name}_result`);
    const resultTrigger = getEventId<undefined>(`${name}_resultTrigger`);
    const combined = getDerivedId<ValidatedInputWithResult<Input, ValidationResult, Result>>(
      `${name}_combined`,
    );
    const isValid =
      config.isValidationResultValid ?? (validationResult => validationResult === null);

    const setup = (store: Store) => {
      wireEffectStage(store, validation, {
        effectDebounceTime: config.validationEffectDebounceTime,
        eagerInputSubscription: config.eagerInputSubscription,
      });
      wireEffectStage(store, result, {
        initialResultGetter: config.initialResultGetter,
        withTrigger: config.withResultTrigger,
        effectInputEquals: config.resultEffectInputEquals,
        effectDebounceTime: config.resultEffectDebounceTime,
      });
      const validation$ = store.getBehavior(validation.combined);
      store.connectObservable(latestValidInput(validation$, isValid), result.input);
      store.connectObservable(
        validatedTrigger(store.getEventStream(resultTrigger), validation$, isValid),
        result.trigger,
      );
      store.addDerivedState(
        combined,
        combineLatest([
          validation$,
          store.getBehavior(result.combined).pipe(
            startWith<CombinedEffectResult<Input, Result>>({
              result: config.initialResultGetter?.(),
              resultPending: false,
            }),
          ),
        ]).pipe(
          // Hides the moment a fresh valid validation is in but the result stage has not caught up.
          filter(
            ([v, r]) =>
              v.resultPending ||
              r.currentInput === v.resultInput ||
              v.result === undefined ||
              !isValid(v.result),
          ),
          map(([v, r]) => combine(v, r, isValid)),
          distinctUntilChanged(sameState),
        ),
      );
    };

    return {
      input: {
        input: validation.input,
        validationInvalidate: validation.invalidate,
        resultInvalidate: result.invalidate,
        resultTrigger,
      },
      output: {
        combined,
        validationErrors: validation.errors,
        validationSuccesses: validation.successes,
        resultErrors: result.errors,
        resultSuccesses: result.successes,
      },
      effects: { validation: validation.effect, result: result.effect },
      setup,
    };
  });
