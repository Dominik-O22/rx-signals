import { Component, OnInit } from '@angular/core';
import { Store } from '@rx-signals/store';
import { Observable } from 'rxjs';
import { appHeader, lastLogin } from './core/app.signals';
import { AppHeader, AppNotification, User } from './core/models';
import { NotificationService } from './core/notification.service';
import { SessionService } from './core/session.service';
import { SelftestService } from './selftest/selftest.service';

@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  readonly header$: Observable<AppHeader>;
  readonly lastLogin$: Observable<User>;
  readonly notifications$: Observable<ReadonlyArray<AppNotification>>;
  /** JSON report of the startup self-test; rendered into #report for scripts/selftest.mjs. */
  report: string | null = null;

  constructor(
    store: Store,
    private readonly session: SessionService,
    private readonly notifications: NotificationService,
    private readonly selftest: SelftestService,
  ) {
    this.header$ = store.getBehavior(appHeader);
    this.lastLogin$ = store.getBehavior(lastLogin);
    this.notifications$ = notifications.notifications$;
  }

  ngOnInit(): void {
    this.selftest.run().then(report => (this.report = JSON.stringify(report, null, 2)));
  }

  dismiss(index: number): void {
    this.notifications.dismiss(index);
  }

  logout(): void {
    this.session.logout();
  }
}
