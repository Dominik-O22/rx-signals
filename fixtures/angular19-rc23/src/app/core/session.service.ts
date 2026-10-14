import { Injectable } from '@angular/core';
import { Store } from '@rx-signals/store';
import { Observable, firstValueFrom, switchMap, take } from 'rxjs';
import { loadUserEffect } from './app-effects.service';
import { currentUserState, localeChanged, userLoggedIn, userLoggedOut } from './app.signals';
import { Locale, User } from './models';

@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly currentUser$: Observable<User | null>;

  constructor(private readonly store: Store) {
    this.currentUser$ = this.store.getBehavior(currentUserState);
  }

  /** Loads the user through the registered effect (not ApiService directly) and stores it. */
  async login(userId: string): Promise<User> {
    const user = await firstValueFrom(
      this.store.getEffect(loadUserEffect).pipe(
        take(1),
        switchMap(effect => effect(userId, this.store)),
      ),
    );
    await this.store.dispatch(userLoggedIn, user);
    return user;
  }

  logout(): void {
    this.store.dispatch(userLoggedOut);
  }

  switchLocale(locale: Locale): Promise<boolean> {
    return this.store.dispatch(localeChanged, locale);
  }
}
