import {
  createEnvironmentInjector,
  EnvironmentInjector,
  type EnvironmentProviders,
  ErrorHandler,
  type Provider,
  provideExperimentalZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { getDerivedId, getEventId, getStateId, Store } from '@rx-signals-next/store';
import { settle } from '@rx-signals-next/store/testing';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { injectBehavior, provideChildStore, provideRootStore, type StoreSetup } from '../src';

const counter = getStateId<number>('counter');
const add = getEventId<number>('add');
const label = getStateId<string>('label');

const setupCounter: StoreSetup = store => {
  store.addState(counter, 0);
  store.addReducer(counter, add, (value, delta) => value + delta);
};

const configure = (...providers: (Provider | EnvironmentProviders)[]) =>
  TestBed.configureTestingModule({
    providers: [provideExperimentalZonelessChangeDetection(), ...providers],
  });

/** A lazy route or module: an environment injector below the root one. */
const childInjector = (...providers: (Provider | EnvironmentProviders)[]) =>
  createEnvironmentInjector(providers, TestBed.inject(EnvironmentInjector));

describe('provideRootStore', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('runs each setup once, also when a lazy injector provides it again', async () => {
    let runs = 0;
    const counting: StoreSetup = store => {
      runs += 1;
      setupCounter(store);
    };
    configure(provideRootStore(counting));
    const root = TestBed.inject(Store);
    const lazy = childInjector(provideRootStore(counting)).get(Store);

    expect(lazy).toBe(root);
    expect(runs).toBe(1);
    await root.dispatch(add, 2);
    expect(await firstValueFrom(lazy.getBehavior(counter))).toBe(2);
  });

  it('gives every TestBed a fresh root store', async () => {
    configure(provideRootStore(setupCounter));
    await TestBed.inject(Store).dispatch(add, 5);
    TestBed.resetTestingModule();

    configure(provideRootStore(setupCounter));
    expect(await firstValueFrom(TestBed.inject(Store).getBehavior(counter))).toBe(0);
  });

  it('reports a throwing reducer to the ErrorHandler and keeps the state', async () => {
    const handled: unknown[] = [];
    configure(provideRootStore(setupCounter), {
      provide: ErrorHandler,
      useValue: { handleError: (error: unknown) => handled.push(error) },
    });
    const store = TestBed.inject(Store);
    const boom = getEventId<undefined>('boom');
    store.addReducer(counter, boom, () => {
      throw new Error('boom');
    });
    await store.dispatch(add, 1);
    await store.dispatch(boom);
    expect(await firstValueFrom(store.getBehavior(counter))).toBe(1);
    expect(handled).toEqual([new Error('boom')]);
  });
});

describe('provideChildStore', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('reads parent state, shadows it with its own, and ends with its injector', async () => {
    configure(
      provideRootStore(store => {
        store.addState(label, 'root');
      }),
    );
    const root = TestBed.inject(Store);
    const injector = childInjector(
      provideChildStore(store => {
        store.addState(label, 'child');
      }),
    );
    const child = injector.get(Store);

    expect(child.getParentStore()).toBe(root);
    expect(await firstValueFrom(child.getBehavior(label))).toBe('child');
    expect(await firstValueFrom(root.getBehavior(label))).toBe('root');

    let completed = false;
    child.getBehavior(label).subscribe({ complete: () => (completed = true) });
    injector.destroy();
    expect(completed).toBe(true);
  });

  it('parents a nested child to the nearest child store', () => {
    configure(provideRootStore());
    const outer = childInjector(provideChildStore());
    const inner = createEnvironmentInjector([provideChildStore()], outer);
    expect(inner.get(Store).getParentStore()).toBe(outer.get(Store));
  });
});

describe('injectBehavior', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('follows the behavior as a signal', async () => {
    configure(provideRootStore(setupCounter));
    const store = TestBed.inject(Store);
    const value = TestBed.runInInjectionContext(() =>
      injectBehavior(counter, { requireSync: true }),
    );
    expect(value()).toBe(0);
    await store.dispatch(add, 3);
    await settle(store);
    expect(value()).toBe(3);
  });

  it('starts with initialValue until a lazy behavior emits', () => {
    configure(provideRootStore());
    const pending = getDerivedId<number>('pending');
    const value = TestBed.runInInjectionContext(() =>
      injectBehavior(pending, { initialValue: -1 }),
    );
    expect(value()).toBe(-1);
  });
});
