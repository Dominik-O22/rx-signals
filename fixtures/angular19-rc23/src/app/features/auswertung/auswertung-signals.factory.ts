import {
  BehaviorId,
  CombinedEffectResult,
  DerivedId,
  EffectError,
  EffectSuccess,
  EventId,
  getDerivedId,
  getEffectSignalsFactory,
  getEventId,
  getModelSignalsFactory,
  getStateId,
  Signals,
  SignalsFactory,
  Store,
} from '@rx-signals/store';
import { combineLatest, map } from 'rxjs';
import { appConfig, notificationAdded } from '../../core/app.signals';
import { loadAuswertungEffect } from '../../core/app-effects.service';
import { AuswertungErgebnis, AuswertungFilter, AuswertungZeile } from '../../core/models';

export type Page<T> = {
  index: number;
  size: number;
  pageCount: number;
  items: ReadonlyArray<T>;
};

type PagingInput<T> = {
  setPage: EventId<number>;
  rows: DerivedId<ReadonlyArray<T>>;
  pageSize: DerivedId<number>;
};

type PagingOutput<T> = {
  page: DerivedId<Page<T>>;
};

type PagingConfig = {
  nameExtension?: string;
};

/** Hand-written factory: pages any row list; rows and page size are connected by the caller. */
export const getPagingSignalsFactory = <T>(): SignalsFactory<
  PagingInput<T>,
  PagingOutput<T>,
  PagingConfig
> =>
  new SignalsFactory<PagingInput<T>, PagingOutput<T>, PagingConfig>(
    (config): Signals<PagingInput<T>, PagingOutput<T>> => {
      const ext = config.nameExtension ?? '';
      const pageIndex = getStateId<number>(`${ext}_pageIndex`);
      const input: PagingInput<T> = {
        setPage: getEventId<number>(`${ext}_setPage`),
        rows: getDerivedId<ReadonlyArray<T>>(`${ext}_rows`),
        pageSize: getDerivedId<number>(`${ext}_pageSize`),
      };
      const output: PagingOutput<T> = {
        page: getDerivedId<Page<T>>(`${ext}_page`),
      };
      return {
        input,
        output,
        effects: {},
        setup: (store: Store) => {
          store.addState(pageIndex, 0);
          store.addReducer(pageIndex, input.setPage, (_, index) => index);
          store.addDerivedState(
            output.page,
            combineLatest([
              store.getBehavior(input.rows),
              store.getBehavior(input.pageSize),
              store.getBehavior(pageIndex),
            ]).pipe(
              map(([rows, size, requested]) => {
                const pageCount = Math.max(1, Math.ceil(rows.length / size));
                const index = Math.min(requested, pageCount - 1);
                return {
                  index,
                  size,
                  pageCount,
                  items: rows.slice(index * size, (index + 1) * size),
                };
              }),
            ),
          );
        },
      };
    },
  );

export type AuswertungSummary = {
  filterLabel: string;
  rowCount: number;
  summe: number;
  /** true while the shown result belongs to an older filter (trigger mode: user has not refreshed). */
  stale: boolean;
};

export type AuswertungConfig = {
  defaultFilter: AuswertungFilter;
  debounceMs: number;
  nameExtension: string;
};

export type AuswertungInput = {
  setFilter: EventId<AuswertungFilter>;
  updateFilter: EventId<Partial<AuswertungFilter>>;
  resetFilter: EventId<undefined>;
  refresh: EventId<undefined>;
  invalidate: EventId<undefined>;
  setPage: EventId<number>;
};

export type AuswertungOutput = {
  result: DerivedId<CombinedEffectResult<AuswertungFilter, AuswertungErgebnis>>;
  filter: BehaviorId<AuswertungFilter>;
  page: DerivedId<Page<AuswertungZeile>>;
  summary: DerivedId<AuswertungSummary>;
  errors: EventId<EffectError<AuswertungFilter>>;
  successes: EventId<EffectSuccess<AuswertungFilter, AuswertungErgebnis>>;
};

export type AuswertungSignals = Signals<AuswertungInput, AuswertungOutput>;
export type AuswertungSignalsFactory = SignalsFactory<
  AuswertungInput,
  AuswertungOutput,
  AuswertungConfig,
  {}
>;

export const EMPTY_ERGEBNIS: AuswertungErgebnis = { zeilen: [], summe: 0 };

/** Sort order is a client-side concern, so changing only `sortierung` must not refetch. */
export const auswertungFilterEquals = (a: AuswertungFilter, b: AuswertungFilter): boolean =>
  a.jahr === b.jahr && a.kostenstelle === b.kostenstelle;

const sortZeilen = (
  zeilen: ReadonlyArray<AuswertungZeile>,
  sortierung: AuswertungFilter['sortierung'],
): ReadonlyArray<AuswertungZeile> =>
  [...zeilen].sort((a, b) =>
    sortierung === 'betrag' ? b.betrag - a.betrag : a.konto.localeCompare(b.konto),
  );

const filterLabel = (filter: AuswertungFilter): string => `${filter.kostenstelle}/${filter.jahr}`;

/**
 * Effect (trigger mode, debounced) + filter model + paging, wired into one factory.
 * The effect itself is the app-level `loadAuswertungEffect`, reused via useExistingEffect.
 */
export const getAuswertungSignalsFactory = (): AuswertungSignalsFactory =>
  getEffectSignalsFactory<AuswertungFilter, AuswertungErgebnis>()
    .renameInputId('trigger', 'refresh')
    .compose(getModelSignalsFactory<AuswertungFilter>())
    .connect('model', 'input', false)
    .compose(getPagingSignalsFactory<AuswertungZeile>())
    .connectObservable(
      (store, output) =>
        combineLatest([store.getBehavior(output.combined), store.getBehavior(output.model)]).pipe(
          map(([combined, filter]) => sortZeilen(combined.result?.zeilen ?? [], filter.sortierung)),
        ),
      'rows',
      false,
    )
    .connectObservable(
      store => store.getBehavior(appConfig).pipe(map(config => config.pageSize)),
      'pageSize',
      false,
    )
    .useExistingEffect('id', () => loadAuswertungEffect, false)
    .mapConfig((config: AuswertungConfig) => ({
      c1: {
        c1: {
          withTrigger: true,
          effectDebounceTime: config.debounceMs,
          effectInputEquals: auswertungFilterEquals,
          initialResultGetter: () => EMPTY_ERGEBNIS,
          nameExtension: `${config.nameExtension}_effect`,
        },
        c2: {
          defaultModel: config.defaultFilter,
          nameExtension: `${config.nameExtension}_filter`,
        },
      },
      c2: {
        nameExtension: `${config.nameExtension}_paging`,
      },
    }))
    .addOutputId('summary', config =>
      getDerivedId<AuswertungSummary>(`${config.nameExtension}_summary`),
    )
    .extendSetup((store, _input, output) => {
      store.addDerivedState(
        output.summary,
        combineLatest([store.getBehavior(output.combined), store.getBehavior(output.model)]).pipe(
          map(([combined, filter]) => ({
            filterLabel: filterLabel(filter),
            rowCount: combined.result?.zeilen.length ?? 0,
            summe: combined.result?.summe ?? 0,
            stale:
              combined.resultInput === undefined ||
              !auswertungFilterEquals(combined.resultInput, filter),
          })),
        ),
      );
      store.addEventSource(
        notificationAdded,
        store.getEventStream(output.errors).pipe(
          map(({ error, errorInput }) => ({
            kind: 'error' as const,
            text: `Auswertung ${filterLabel(errorInput)} fehlgeschlagen: ${String(error?.message ?? error)}`,
          })),
        ),
      );
    })
    .mapInput(
      (input): AuswertungInput => ({
        setFilter: input.setModel,
        updateFilter: input.updateModel,
        resetFilter: input.resetModel,
        refresh: input.refresh,
        invalidate: input.invalidate,
        setPage: input.setPage,
      }),
    )
    .mapOutput(
      (output): AuswertungOutput => ({
        result: output.combined,
        filter: output.model,
        page: output.page,
        summary: output.summary,
        errors: output.errors,
        successes: output.successes,
      }),
    );
