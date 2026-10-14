import { Injectable } from '@angular/core';
import { Effect, EffectId, getEffectId, Store } from '@rx-signals/store';
import { registerKostenstelleEffects } from '../features/kostenstelle/kostenstelle.effects';
import { ApiService } from './api.service';
import {
  AuswertungErgebnis,
  AuswertungFilter,
  BerichtEintrag,
  BerichtFilter,
  User,
} from './models';

export const loadUserEffect = getEffectId<string, User>('loadUser');
export const loadAuswertungEffect: EffectId<AuswertungFilter, AuswertungErgebnis> = getEffectId<
  AuswertungFilter,
  AuswertungErgebnis
>('loadAuswertung');
export const loadBerichteEffect = getEffectId<
  { filter: BerichtFilter; userId: string },
  ReadonlyArray<BerichtEintrag>
>('loadBerichte');

/**
 * Registers every HTTP-backed effect in the root store. Runs once from an app initializer,
 * because effects need DI (ApiService) and the store setup functions do not have it.
 */
@Injectable({ providedIn: 'root' })
export class AppEffectsService {
  constructor(
    private readonly store: Store,
    private readonly api: ApiService,
  ) {}

  register(): void {
    const loadUser: Effect<string, User> = userId => this.api.loadUser(userId);
    this.store.addEffect(loadUserEffect, loadUser);

    this.store.addEffect(loadAuswertungEffect, filter => this.api.loadAuswertung(filter));

    this.store.addEffect(loadBerichteEffect, ({ filter, userId }) =>
      this.api.loadBerichte(filter, userId),
    );

    registerKostenstelleEffects(this.store, this.api);
  }
}
