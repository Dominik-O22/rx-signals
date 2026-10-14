# @rx-signals-next/store

Reactive state and effects management on RxJS. You describe state as behaviors and changes as events. Effects stay behind ids, so tests can swap them without mocks.

This is a maintained fork of [`@rx-signals/store`](https://github.com/gneu77/rx-signals) by Gerd Neudert, whose last release was 3.0.0-rc46 in 2023. The fork starts from 3.0.0-rc23 and fixes its bugs. Version 4 has a new core with an API close to rc23's. To migrate an rc23 app, use [the codemod](../../codemod/MIGRATION.md).

## Install

```sh
npm install @rx-signals-next/store rxjs
```

The only peer dependency is `rxjs` 7.8 or newer. The typings work with TypeScript 5.5 and newer.

## A first store

```ts
import { map } from 'rxjs';
import { getDerivedId, getEventId, getStateId, Store } from '@rx-signals-next/store';

const counter = getStateId<number>('counter');
const add = getEventId<number>('add');
const doubled = getDerivedId<number>('doubled');

const store = new Store();
store.addState(counter, 0);
store.addReducer(counter, add, (value, delta) => value + delta);
store.addDerivedState(doubled, store.getBehavior(counter).pipe(map(value => value * 2)));

store.getBehavior(doubled).subscribe(console.log); // 0, then 6
await store.dispatch(add, 3);
```

- **State** (`addState` plus `addReducer`) is eager. Reducers run even while nobody subscribes.
- **Derived state** (`addDerivedState`) is lazy. Its source runs only while something subscribes, and the last value stays cached.
- **Events** are delivered asynchronously, in dispatch order, across a store and its child stores. `dispatch` resolves after delivery and never rejects.
- **Effects** live under an `EffectId`. `getEffectSignalsFactory` turns one into input, result and pending state, with optional trigger, debounce and invalidation.

## Errors

A reducer that throws keeps the previous state. The same goes for a state source or an event source that errors. The store reports the error to `onError`:

```ts
const store = new Store({ onError: error => log(error.origin, error.cause) });
```

Without `onError`, errors go to rxjs `config.onUnhandledError`, or are rethrown asynchronously the way rxjs reports unhandled errors. A derived state whose source errors passes the error to its current subscribers, keeps its last value, and retries on the next subscription.

## Ids

Ids are frozen objects with a `kind` and a `name`, and their value types are exact: an `EventId<'a'>` is not an `EventId<string>`. To accept any id of one kind, for example in a helper that subscribes to several behaviors, use `AnyBehaviorId`, `AnyEventId` and friends. `getBehavior` and `getEventStream` accept them and return `Observable<unknown>`.

## Testing helpers

`@rx-signals-next/store/testing` has `settle(store)`, which resolves once the event queue is empty, plus inspection functions such as `isSubscribed(store, id)`.

## Angular

Use [`@rx-signals-next/angular`](../angular/README.md) for `provideRootStore`, `provideChildStore` and `injectBehavior`.

## Learn more

[The tutorial](../../docs/rx-signals_start.md) explains the concepts. It was written for rc23, but the concepts and most code still apply. [MIGRATION.md](../../codemod/MIGRATION.md) lists every API change since rc23.

## License

MIT. Copyright 2020 Gerd Neudert, 2026 Dominik Opwis.
