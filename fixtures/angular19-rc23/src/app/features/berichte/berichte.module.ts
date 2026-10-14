import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { RxSignalsStoreModule } from '@rx-signals/angular-provider';
import { BerichteComponent } from './berichte.component';
import { berichteSetup } from './berichte.signals';

/** Lazy feature module. Its components get a child of the root store, so root state stays readable. */
@NgModule({
  declarations: [BerichteComponent],
  imports: [
    CommonModule,
    RouterModule.forChild([{ path: '', component: BerichteComponent }]),
    RxSignalsStoreModule.withChildStore(berichteSetup),
  ],
})
export class BerichteModule {}
