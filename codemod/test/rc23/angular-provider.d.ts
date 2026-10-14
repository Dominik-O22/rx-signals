// The part of @rx-signals/angular-provider@3.0.0-rc4's declarations the rules look at.
import { Store } from '@rx-signals/store';

export declare type ModuleSetupWithStore = (store: Store) => void;

export declare class RxSignalsStoreModule {
  static withRootStore(...setups: ModuleSetupWithStore[]): unknown;
  static withChildStore(...setups: ModuleSetupWithStore[]): unknown;
}
