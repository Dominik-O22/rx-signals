import { inject, NgModule, provideAppInitializer } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RxSignalsStoreModule } from '@rx-signals/angular-provider';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { AppEffectsService } from './core/app-effects.service';
import { appStoreSetup } from './core/app.signals';
import { AuswertungComponent } from './features/auswertung/auswertung.component';
import { auswertungSignals } from './features/auswertung/auswertung.signals';
import { KostenstelleEditComponent } from './features/kostenstelle/kostenstelle-edit.component';
import {
  kostenstelleEditSignals,
  kostenstelleFormSetup,
} from './features/kostenstelle/kostenstelle-edit.signals';

@NgModule({
  declarations: [AppComponent, AuswertungComponent],
  imports: [
    BrowserModule,
    AppRoutingModule,
    KostenstelleEditComponent,
    RxSignalsStoreModule.withRootStore(
      appStoreSetup,
      auswertungSignals.setup,
      kostenstelleFormSetup,
      kostenstelleEditSignals.setup,
    ),
  ],
  providers: [provideAppInitializer(() => inject(AppEffectsService).register())],
  bootstrap: [AppComponent],
})
export class AppModule {}
