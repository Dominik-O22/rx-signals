import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { EffectError, Store } from '@rx-signals/store';
import { ReplaySubject, Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import {
  appConfig,
  appHeader,
  auditLogState,
  lastLogin,
  localeChanged,
  notificationAdded,
  notificationsState,
} from '../core/app.signals';
import { AppNotification, AuswertungFilter, KostenstelleForm } from '../core/models';
import { NotificationService } from '../core/notification.service';
import { SessionService } from '../core/session.service';
import {
  AUSWERTUNG_DEBOUNCE_MS,
  auswertungSignals,
} from '../features/auswertung/auswertung.signals';
import {
  berichtClosed,
  berichtFilterSignals,
  berichtListe,
  berichtSelected,
  berichtTitel,
  selectedBerichtState,
} from '../features/berichte/berichte.signals';
import {
  kostenstelleEditSignals,
  kostenstelleFieldChanged,
} from '../features/kostenstelle/kostenstelle-edit.signals';
import { openKostenstelle } from '../features/kostenstelle/kostenstelle.effects';
import { keepHot, pause, recordEvents, waitFor, waitForBehavior } from './probe';

// rc23 drops a trigger that arrives inside the effect debounce window, so every refresh waits it out.
const SETTLE_MS = AUSWERTUNG_DEBOUNCE_MS * 6;

/**
 * Scripted run over every rx-signals feature of the app. Each step awaits an observable
 * condition (never a bare timer, except the debounce settle above), so the report is
 * deterministic and can be diffed before and after a migration.
 */
@Injectable({ providedIn: 'root' })
export class SelftestService {
  private readonly berichteStore$ = new ReplaySubject<Store>(1);

  constructor(
    private readonly store: Store,
    private readonly api: ApiService,
    private readonly session: SessionService,
    private readonly notifications: NotificationService,
    private readonly router: Router,
  ) {}

  /** Called by BerichteComponent, which is the only holder of the lazy module's child store. */
  attachBerichteStore(childStore: Store): void {
    this.berichteStore$.next(childStore);
  }

  async run(): Promise<Record<string, unknown>> {
    const store = this.store;
    const notificationEvents: AppNotification[] = [];
    const auswertungErrors: EffectError<AuswertungFilter>[] = [];
    const auswertungSuccesses: AuswertungFilter[] = [];
    const subscriptions = new Subscription();
    subscriptions.add(recordEvents(store, notificationAdded, notificationEvents));
    subscriptions.add(recordEvents(store, auswertungSignals.output.errors, auswertungErrors));
    subscriptions.add(
      store
        .getEventStream(auswertungSignals.output.successes)
        .subscribe(success => auswertungSuccesses.push(success.resultInput)),
    );
    subscriptions.add(
      keepHot(store, [
        lastLogin,
        appHeader,
        auswertungSignals.output.result,
        auswertungSignals.output.page,
        auswertungSignals.output.summary,
        kostenstelleEditSignals.output.combined,
      ]),
    );

    const steps: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      ['appConfig', () => waitForBehavior(store, appConfig, 'appConfig')],
      ['session', () => this.runSession()],
      ['auswertung', () => this.runAuswertung(auswertungErrors, auswertungSuccesses)],
      ['kostenstelle', () => this.runKostenstelle()],
      ['berichte', () => this.runBerichte()],
      ['logout', () => this.runLogout()],
      ['auditLog', () => waitForBehavior(store, auditLogState, 'auditLog')],
    ];
    // Sections complete in order; on failure the report keeps what ran plus an `error` entry.
    const report: Record<string, unknown> = {};
    try {
      for (const [section, step] of steps) {
        try {
          report[section] = await step();
        } catch (error) {
          report['error'] = `${section}: ${error instanceof Error ? error.message : String(error)}`;
          break;
        }
      }
      report['notificationEvents'] = notificationEvents;
      report['apiCalls'] = [...this.api.calls];
      return report;
    } finally {
      subscriptions.unsubscribe();
    }
  }

  private async runSession() {
    const store = this.store;
    const headerBefore = await waitForBehavior(store, appHeader, 'header before login');
    const user = await this.session.login('u-100');
    const headerAfterLogin = await waitForBehavior(
      store,
      appHeader,
      'header after login',
      h => h.userName === user.name && h.notificationCount === 1,
    );
    const lastLoginUser = await waitForBehavior(store, lastLogin, 'lastLogin');

    this.notifications.info('Selbsttest gestartet');
    await waitForBehavior(store, notificationsState, 'info notification', l => l.length === 2);
    this.notifications.dismiss(0);
    const notificationsAfterDismiss = await waitForBehavior(
      store,
      notificationsState,
      'dismiss',
      l => l.length === 1,
    );

    const localeDelivered = await this.session.switchLocale('en');
    const headerAfterLocale = await waitForBehavior(
      store,
      appHeader,
      'header after locale',
      h => h.locale === 'en',
    );
    return {
      headerBefore,
      user,
      headerAfterLogin,
      lastLoginUser,
      notificationsAfterDismiss,
      localeDelivered,
      headerAfterLocale,
    };
  }

  private async runAuswertung(
    errors: EffectError<AuswertungFilter>[],
    successes: AuswertungFilter[],
  ) {
    const store = this.store;
    const { input, output } = auswertungSignals;

    const initial = await waitForBehavior(
      store,
      output.result,
      'auswertung initial',
      r => r.currentInput !== undefined,
    );
    const initialSummary = await waitForBehavior(store, output.summary, 'initial summary');

    await store.dispatch(input.updateFilter, { jahr: 2024 });
    await waitForBehavior(store, output.filter, 'filter 2024', f => f.jahr === 2024);
    await pause(SETTLE_MS);
    const untriggered = await waitForBehavior(store, output.result, 'untriggered');
    const callsBeforeRefresh = this.api.calls.length;

    await store.dispatch(input.refresh);
    const loaded = await waitForBehavior(
      store,
      output.result,
      'result 2024',
      r => r.resultInput?.jahr === 2024 && !r.resultPending,
    );
    const firstPage = await waitForBehavior(store, output.page, 'page 0', p => p.items.length > 0);

    await store.dispatch(input.setPage, 1);
    const secondPage = await waitForBehavior(store, output.page, 'page 1', p => p.index === 1);

    await store.dispatch(input.updateFilter, { sortierung: 'betrag' });
    await waitForBehavior(store, output.filter, 'sort betrag', f => f.sortierung === 'betrag');
    await pause(SETTLE_MS);
    const resortedPage = await waitForBehavior(store, output.page, 'resorted page');
    const summaryAfterSort = await waitForBehavior(store, output.summary, 'summary after sort');
    const callsAfterSort = this.api.calls.length;

    await store.dispatch(input.updateFilter, { kostenstelle: 'KST-ERR' });
    await pause(SETTLE_MS);
    const staleSummary = await waitForBehavior(store, output.summary, 'stale', s => s.stale);
    await store.dispatch(input.refresh);
    const afterError = await waitForBehavior(
      store,
      output.result,
      'error result',
      r => r.resultInput?.kostenstelle === 'KST-ERR' && !r.resultPending,
    );

    await store.dispatch(input.updateFilter, { kostenstelle: 'KST-200' });
    await pause(SETTLE_MS);
    await store.dispatch(input.refresh);
    const kst200 = await waitForBehavior(
      store,
      output.result,
      'result KST-200',
      r => r.resultInput?.kostenstelle === 'KST-200' && !r.resultPending,
    );

    const successesBeforeInvalidate = successes.length;
    await store.dispatch(input.invalidate);
    await waitFor(
      store.getEventStream(output.successes),
      'success after invalidate',
      () => successes.length === successesBeforeInvalidate + 1,
    );
    const afterInvalidate = await waitForBehavior(
      store,
      output.result,
      'after invalidate',
      r => !r.resultPending,
    );

    return {
      initial,
      initialSummary,
      untriggered,
      apiCallsBeforeRefresh: callsBeforeRefresh,
      loaded,
      firstPage,
      secondPage,
      resortedPage,
      summaryAfterSort,
      apiCallsAfterSort: callsAfterSort,
      staleSummary,
      afterError,
      errors: errors.map(e => ({
        message: String(e.error?.message ?? e.error),
        input: e.errorInput,
      })),
      kst200,
      afterInvalidate,
      successInputs: successes,
    };
  }

  private async runKostenstelle() {
    const store = this.store;
    const { input, output } = kostenstelleEditSignals;
    const settled = (label: string, until: (vm: { currentInput?: KostenstelleForm }) => boolean) =>
      waitForBehavior(
        store,
        output.combined,
        label,
        vm => !vm.validationPending && vm.validatedInput === vm.currentInput && until(vm),
      );

    const empty = await settled('empty form validated', vm => vm.currentInput !== undefined);

    const opened = await openKostenstelle(store, 'KST-4711');
    const loaded = await settled('loaded form validated', vm => vm.currentInput === opened);

    const saveDelivered = await store.dispatch(input.resultTrigger);
    const saved = await waitForBehavior(
      store,
      output.combined,
      'saved',
      vm => vm.result !== undefined && !vm.resultPending,
    );

    await store.dispatch(kostenstelleFieldChanged, { bezeichnung: 'Vertrieb Nord-Ost' });
    const edited = await settled(
      'edited form validated',
      vm => vm.currentInput?.bezeichnung === 'Vertrieb Nord-Ost',
    );
    await store.dispatch(input.resultTrigger);
    const savedAgain = await waitForBehavior(
      store,
      output.combined,
      'saved again',
      vm => vm.result?.version === 3 && !vm.resultPending,
    );

    await store.dispatch(kostenstelleFieldChanged, { budget: -1 });
    const invalid = await settled('invalid budget', vm => vm.currentInput?.budget === -1);

    return { empty, loaded, saveDelivered, saved, edited, savedAgain, invalid };
  }

  private async runBerichte() {
    await this.router.navigateByUrl('/berichte');
    const child = await waitFor(this.berichteStore$, 'berichte child store');
    const hot = keepHot(child, [berichtTitel, berichtListe, selectedBerichtState]);
    try {
      const titelEn = await waitForBehavior(child, berichtTitel, 'titel en');
      const listeMonat = await waitForBehavior(
        child,
        berichtListe,
        'liste monat',
        l => l.length > 0,
      );

      await child.dispatch(berichtFilterSignals.input.updateModel, { zeitraum: 'quartal' });
      const listeQuartal = await waitForBehavior(
        child,
        berichtListe,
        'liste quartal',
        l => l.length > 0 && l.every(b => b.zeitraum === 'quartal'),
      );

      await this.store.dispatch(localeChanged, 'de');
      const titelDe = await waitForBehavior(child, berichtTitel, 'titel de', t =>
        t.startsWith('Berichte'),
      );

      await child.dispatch(berichtSelected, 'B-2');
      const selected = await waitForBehavior(
        child,
        selectedBerichtState,
        'selected',
        s => s === 'B-2',
      );
      await child.dispatch(berichtClosed);
      const closed = await waitForBehavior(child, selectedBerichtState, 'closed', s => s === null);

      // A parent event dispatched on the child store has no subscriber there, so rc23 drops it.
      const parentEventViaChild = await child.dispatch(localeChanged, 'en');

      return {
        childParentIsRoot: child.getParentStore() === this.store,
        titelEn,
        listeMonat,
        listeQuartal,
        titelDe,
        selected,
        closed,
        parentEventViaChild,
      };
    } finally {
      hot.unsubscribe();
    }
  }

  private async runLogout() {
    this.session.logout();
    const header = await waitForBehavior(
      this.store,
      appHeader,
      'header after logout',
      h => h.userName === null && h.notificationCount === 0,
    );
    const notifications = await waitForBehavior(this.store, notificationsState, 'notifications');
    return { header, notifications };
  }
}
