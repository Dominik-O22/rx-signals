import { Injectable } from '@angular/core';
import { Observable, defer, delay, of, throwError } from 'rxjs';
import {
  AuswertungErgebnis,
  AuswertungFilter,
  AuswertungZeile,
  BerichtEintrag,
  BerichtFilter,
  KostenstelleForm,
  KostenstelleSaveResult,
  User,
} from './models';

const LATENCY_MS = 20;

const USERS: Record<string, User> = {
  'u-100': { id: 'u-100', name: 'Petra Lindner', roles: ['controller'] },
  'u-200': { id: 'u-200', name: 'Jonas Weber', roles: ['viewer'] },
};

const BUCHUNGEN: ReadonlyArray<AuswertungZeile & { kostenstelle: string; jahr: number }> = [
  { kostenstelle: 'KST-100', jahr: 2024, konto: '4000', bezeichnung: 'Personal', betrag: 52000 },
  { kostenstelle: 'KST-100', jahr: 2024, konto: '4100', bezeichnung: 'Reisekosten', betrag: 3400 },
  { kostenstelle: 'KST-100', jahr: 2024, konto: '4200', bezeichnung: 'Software', betrag: 12800 },
  { kostenstelle: 'KST-100', jahr: 2024, konto: '4300', bezeichnung: 'Schulungen', betrag: 2100 },
  { kostenstelle: 'KST-100', jahr: 2024, konto: '4400', bezeichnung: 'Miete', betrag: 18000 },
  { kostenstelle: 'KST-100', jahr: 2023, konto: '4000', bezeichnung: 'Personal', betrag: 49500 },
  { kostenstelle: 'KST-200', jahr: 2024, konto: '4000', bezeichnung: 'Personal', betrag: 31000 },
  { kostenstelle: 'KST-200', jahr: 2024, konto: '4500', bezeichnung: 'Marketing', betrag: 7600 },
];

/**
 * Stand-in for the HttpClient-backed API layer of the real app. Every method is cold and
 * records the call when subscribed, so the self-test can report which requests effects made.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly calls: string[] = [];

  loadUser(id: string): Observable<User> {
    return this.request(`GET /users/${id}`, () => {
      const user = USERS[id];
      return user ? of(user) : throwError(() => new Error(`404 user ${id}`));
    });
  }

  loadAuswertung(filter: AuswertungFilter): Observable<AuswertungErgebnis> {
    return this.request(`GET /auswertung?jahr=${filter.jahr}&kst=${filter.kostenstelle}`, () => {
      if (filter.kostenstelle === 'KST-ERR') {
        return throwError(() => new Error('500 auswertung backend unavailable'));
      }
      const zeilen = BUCHUNGEN.filter(
        b => b.jahr === filter.jahr && b.kostenstelle === filter.kostenstelle,
      ).map(({ konto, bezeichnung, betrag }) => ({ konto, bezeichnung, betrag }));
      return of({ zeilen, summe: zeilen.reduce((sum, z) => sum + z.betrag, 0) });
    });
  }

  loadKostenstelle(nummer: string): Observable<KostenstelleForm> {
    return this.request(`GET /kostenstellen/${nummer}`, () =>
      nummer === 'KST-4711'
        ? of({
            nummer,
            bezeichnung: 'Vertrieb Nord',
            verantwortlich: 'P. Lindner',
            budget: 125_000,
          })
        : throwError(() => new Error(`404 kostenstelle ${nummer}`)),
    );
  }

  saveKostenstelle(form: KostenstelleForm): Observable<KostenstelleSaveResult> {
    return this.request(`PUT /kostenstellen/${form.nummer}`, () =>
      of({ id: `id-${form.nummer}`, nummer: form.nummer, version: 2 }),
    );
  }

  loadBerichte(filter: BerichtFilter, userId: string): Observable<ReadonlyArray<BerichtEintrag>> {
    return this.request(`GET /berichte?zeitraum=${filter.zeitraum}&user=${userId}`, () =>
      of(
        ['Kostenstellenbericht', 'Budgetabweichung', 'Personalkosten'].map((titel, i) => ({
          id: `B-${i + 1}`,
          titel: `${titel} (${filter.zeitraum})`,
          zeitraum: filter.zeitraum,
        })),
      ),
    );
  }

  private request<T>(label: string, respond: () => Observable<T>): Observable<T> {
    return defer(() => {
      this.calls.push(label);
      return respond();
    }).pipe(delay(LATENCY_MS));
  }
}
