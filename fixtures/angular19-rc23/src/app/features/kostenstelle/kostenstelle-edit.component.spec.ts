import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@rx-signals/store';
import { filter, firstValueFrom, of } from 'rxjs';
import { appStoreSetup } from '../../core/app.signals';
import { KostenstelleForm } from '../../core/models';
import { KostenstelleEditComponent, KostenstelleEditVm } from './kostenstelle-edit.component';
import {
  kostenstelleEditSignals,
  kostenstelleFormSetup,
  kostenstelleLoaded,
} from './kostenstelle-edit.signals';
import { validateKostenstelle } from './kostenstelle.effects';

const FORM: KostenstelleForm = {
  nummer: 'KST-4711',
  bezeichnung: 'Vertrieb Nord',
  verantwortlich: 'P. Lindner',
  budget: 1000,
};

describe('KostenstelleEditComponent', () => {
  let fixture: ComponentFixture<KostenstelleEditComponent>;
  let store: Store;
  let saved: KostenstelleForm[];

  const vmWhere = (until: (vm: KostenstelleEditVm) => boolean) =>
    firstValueFrom(fixture.componentInstance.vm$.pipe(filter(until)));
  const saveButton = (): HTMLButtonElement => fixture.nativeElement.querySelector('button.save');
  const status = (): string => fixture.nativeElement.querySelector('.status').textContent.trim();

  beforeEach(async () => {
    store = new Store();
    appStoreSetup(store);
    kostenstelleFormSetup(store);
    kostenstelleEditSignals.setup(store);
    saved = [];
    store.addEffect(kostenstelleEditSignals.effects.validation, validateKostenstelle);
    store.addEffect(kostenstelleEditSignals.effects.result, form => {
      saved.push(form);
      return of({ id: 'id-1', nummer: form.nummer, version: 1 });
    });

    await TestBed.configureTestingModule({
      imports: [KostenstelleEditComponent],
      providers: [{ provide: Store, useValue: store }],
    }).compileComponents();
    fixture = TestBed.createComponent(KostenstelleEditComponent);
    fixture.detectChanges();
  });

  afterEach(() => store.completeAllSignals());

  it('blocks saving an invalid form', async () => {
    await vmWhere(vm => !vm.validationPending && vm.validatedInput !== undefined);
    fixture.detectChanges();
    expect(status()).toBe('Ungueltig');
    expect(saveButton().disabled).toBeTrue();
  });

  it('saves the validated form only when Speichern is clicked', async () => {
    await store.dispatch(kostenstelleLoaded, FORM);
    await vmWhere(vm => vm.isValid && !vm.validationPending);
    fixture.detectChanges();
    expect(saved).toEqual([]);

    saveButton().click();
    await vmWhere(vm => vm.result !== undefined);
    fixture.detectChanges();
    expect(saved).toEqual([FORM]);
    expect(status()).toContain('Gespeichert: KST-4711 v1');
    expect(fixture.componentInstance.lastSaveDelivered).toBeTrue();
  });
});
