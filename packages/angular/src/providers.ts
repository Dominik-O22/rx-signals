import {
  DestroyRef,
  type EnvironmentProviders,
  ErrorHandler,
  inject,
  InjectionToken,
  makeEnvironmentProviders,
  NgZone,
  type Provider,
} from '@angular/core';
import { Store } from '@rx-signals-next/store';

/** Registers states, reducers, effects and sources on a store. */
export type StoreSetup = (store: Store) => void;

type RootStore = {
  readonly store: Store;
  /** Setups that already ran, so two providers passing the same setup run it once. */
  readonly applied: Set<StoreSetup>;
};

// One root store per root injector, created on first use and completed with that injector.
// A fresh TestBed therefore gets a fresh store, unlike rc4's module-level singleton.
const ROOT_STORE = new InjectionToken<RootStore>('rx-signals root store', {
  providedIn: 'root',
  factory: () => {
    const errorHandler = inject(ErrorHandler);
    const zone = inject(NgZone);
    const store = new Store({
      onError: error => {
        errorHandler.handleError(error.cause);
      },
      // Flush inside the zone even if the batch started outside it, so change detection runs
      // afterwards. Zoneless apps get NoopNgZone, whose run is a plain call.
      schedule: flush => {
        setTimeout(() => {
          zone.run(flush);
        });
      },
    });
    inject(DestroyRef).onDestroy(() => {
      store.completeAllSignals();
    });
    return { store, applied: new Set() };
  },
});

/**
 * Provides the application's root store and runs `setups` on it, each setup function once.
 * Use it in `bootstrapApplication`, `NgModule.providers` or `Route.providers`. In a lazy module or
 * route it adds its setups to the same root store, on the first injection of `Store` there.
 */
export function provideRootStore(...setups: StoreSetup[]): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Store,
      useFactory: () => {
        const root = inject(ROOT_STORE);
        for (const setup of setups) {
          if (root.applied.has(setup)) continue;
          root.applied.add(setup);
          setup(root.store);
        }
        return root.store;
      },
    },
  ]);
}

/**
 * Provides a child store of the nearest `Store` above this injector (else of the root store) and
 * runs `setups` on it. The child is created on the first injection of `Store` and completed when
 * its injector is destroyed, e.g. when a lazy route is left or a component is destroyed.
 * Use it in `Route.providers`, `NgModule.providers` or `Component.providers`.
 */
export function provideChildStore(...setups: StoreSetup[]): Provider {
  return {
    provide: Store,
    useFactory: () => {
      const parent = inject(Store, { skipSelf: true, optional: true }) ?? inject(ROOT_STORE).store;
      const child = parent.createChildStore();
      inject(DestroyRef).onDestroy(() => {
        child.completeAllSignals();
      });
      for (const setup of setups) setup(child);
      return child;
    },
  };
}
