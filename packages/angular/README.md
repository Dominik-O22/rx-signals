# @rx-signals-next/angular

Angular providers for [`@rx-signals-next/store`](../store/README.md). It works with Angular 19 to 22, in standalone and NgModule apps. It replaces `@rx-signals/angular-provider`'s `RxSignalsStoreModule`.

```sh
npm install @rx-signals-next/angular @rx-signals-next/store rxjs
```

## Root store

```ts
bootstrapApplication(App, { providers: [provideRootStore(setupCounter, setupEffects)] });
```

Or in an NgModule: `providers: [provideRootStore(setupCounter)]`. A setup is a function `(store: Store) => void` that adds states, reducers and effects. Setups run on the first injection of `Store`, and each setup function runs once, even if several modules or routes provide it.

There is one root store per root injector, so every `TestBed` gets a fresh one. A lazy module or route can call `provideRootStore(setupFeature)` to add its setups to the same root store.

## Child stores

```ts
const routes: Routes = [
  {
    path: 'reports',
    providers: [provideChildStore(setupReports)],
    loadComponent: () => ReportsPage,
  },
];
```

A child store reads the parent's state and events until it adds its own state for an id. Its parent is the nearest `Store` above its injector. The store is created on first injection and completed when its injector is destroyed, for example when the user leaves the route. `provideChildStore` also works in `Component.providers`.

## Errors and change detection

Reducer and source errors go to Angular's `ErrorHandler`. Event batches run inside `NgZone`, so change detection runs after them.

## Signals

```ts
readonly count = injectBehavior(counter, { requireSync: true }); // Signal<number>
readonly results = injectBehavior(search.output.combined, { initialValue: emptyResult });
```

`injectBehavior` reads a behavior of the injected `Store` as an Angular signal. The subscription ends with the injection context. It is optional: `async` pipe and `toSignal` work as well.

## License

MIT. Copyright 2026 Dominik Opwis.
