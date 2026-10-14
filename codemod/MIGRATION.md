# Migrating from rx-signals rc23 to v4

This guide moves an Angular app from `@rx-signals/store@3.0.0-rc23` and `@rx-signals/angular-provider@3.0.0-rc4` to `@rx-signals-next/store` and `@rx-signals-next/angular` (v4).

A script does most of the work. It rewrites the code that changed shape. Every spot left for you gets a marker comment, and this guide gives the fix for each one.

## Finding the work left

Every spot that needs you has a comment line directly above it:

```ts
// TODO(rx-signals-v4) C5: effect error is unknown. MIGRATION.md, C5.
```

There are three kinds.

| Marker                      | Meaning                                         | When it goes away                               |
| --------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `C1` to `C9`, `C?`          | A compile error. `--check` writes these.        | `--check` removes it once the error is fixed.   |
| `R1` to `R11`               | A site the script could not rewrite.            | Delete the line after you fix the code.         |
| `verify B1` to `verify B16` | It compiles, but behaves differently than rc23. | Delete the line after you checked the behavior. |

To find them, use your IDE's TODO list (WebStorm: View, Tool Windows, TODO. VS Code: search for `TODO(rx-signals-v4)`), or run:

```sh
grep -rn "TODO(rx-signals-v4)" src
```

`--check` also prints a numbered list of every marker with file and line. The migration is done when `--check` prints "Done".

## What you need

- Node 18 or newer.
- The app as it is today, with rc23 installed (`npm ci` done). The script reads rc23's types, so run it before you install v4.
- A clean git working tree. Review the result with `git diff`.
- Two files from this folder: `migrate-rx-signals.mjs` and this guide. The script has no dependencies. It uses the TypeScript in your app's `node_modules`.

## How to run it

Run every command in the app folder, the one with `package.json`. The examples assume you copied the script to `../migrate-rx-signals.mjs`.

1. Commit or stash your work.

   ```sh
   git status
   ```

2. Install the current dependencies, if you have not.

   ```sh
   npm ci
   ```

3. Look at what the script plans to change. Nothing is written.

   ```sh
   node ../migrate-rx-signals.mjs --dry
   ```

   It lists every edit by rule, with file and line. A section "Hand edits" lists the spots it will leave alone. Those get a marker in step 4.

4. Run it. Pass the v4 version you install.

   ```sh
   node ../migrate-rx-signals.mjs --version 4.0.0
   ```

   It rewrites the source files and the two dependencies in `package.json`, then prints a summary per rule. It also writes the `R` and `verify` markers.

5. Read the diff. If the app uses Prettier, format the changed files, because some rewritten lines get long.

   ```sh
   git diff
   npx prettier --write $(git diff --name-only -- '*.ts')
   ```

6. Install v4.

   ```sh
   npm install
   ```

7. Mark and list the work left.

   ```sh
   node ../migrate-rx-signals.mjs --check
   ```

   It writes a `C` marker above every compile error and prints a numbered list of all markers. Work through the list with this guide: section `C4` for a `C4` marker, and so on. Run `--check` again after your edits. It removes the markers of fixed errors and lists what is still open. Repeat until it prints "Done".

8. Build, then run the tests. The build also checks the templates, which `--check` does not.

   ```sh
   npm run build
   npx ng test --watch=false
   ```

9. The `verify` markers are part of the list from step 7. Check each place, then delete its marker line. The section "Behavior changes without a compile error" explains each one.

Running the script a second time changes nothing. If a run stops with "edit the same text", the script found a case it does not handle. No file is written in that case. Report the file and line.

### Options

- `--dry` prints the plan and writes nothing.
- `--check` compiles the app and groups the errors. Use it after `npm install`.
- `--version <v>` sets the version written to `package.json`. The default is a placeholder, `4.0.0-dev.0`.
- `--project <tsconfig>` picks the tsconfig files to read. Repeat it for several. By default the script reads `tsconfig.app.json` and `tsconfig.spec.json`, or `tsconfig.json` if those do not exist. Pass every tsconfig that includes code using rx-signals.
- A folder as the first argument migrates that app instead of the current folder.

## What the script changes

Each rule has an id. The `--dry` output and the summary use the same ids.

### R1 Module paths

`'@rx-signals/store'` becomes `'@rx-signals-next/store'`. `'@rx-signals/angular-provider'` becomes `'@rx-signals-next/angular'`. This covers `import`, `export ... from`, `import('...')` and `import('...').Type`.

The script also maintains the import lists. It drops a name that the other rules made unused, such as `NO_VALUE`. It adds a name that rewritten code needs, such as `provideRootStore`. It renames the types of R10.

Not rewritten: a deep import such as `'@rx-signals/store/dist/esm/store-utils'`. Import from `'@rx-signals-next/store'` instead.

### R2 Typed event sources

The five methods `add2TypedEventSource` to `add6TypedEventSource` become one method that takes the ids as an array.

```ts
store.add2TypedEventSource(a, b, source); // before
store.addTypedEventSource([a, b], source); // after

store.add3TypedEventSource(a, b, c, source, a); // before
store.addTypedEventSource([a, b, c], source, { onlyWhileSubscribed: a }); // after
```

A last argument of `null` was the default, so the script drops it.

### R3 Keep flag of connect, connectId and connectObservable

The third argument of `SignalsFactory.connect`, `connectId` and `connectObservable` is gone. `true` is dropped. `false` meant "remove the input id", so the script chains that removal.

```ts
factory.connect('model', 'input', true); // before
factory.connect('model', 'input'); // after

factory.connectId(formState, 'input', false); // before
factory.connectId(formState, 'input').removeInputId('input'); // after
```

Not rewritten: a flag that is a variable, not `true` or `false`. Delete the argument. Where the value was `false`, add `.removeInputId('<input name>')`.

### R4 Keep flag of useExistingEffect

Same as R3 for `useExistingEffect`. `false` becomes `.removeEffectId('<effect name>')`.

```ts
factory.useExistingEffect('id', () => loadEffect, false); // before
factory.useExistingEffect('id', () => loadEffect).removeEffectId('id'); // after
```

### R5 Compose config nesting

In rc23, `a.compose(b)` guessed the config shape. When both factories had config keys, the composed factory expected `{ c1: configOfA, c2: configOfB }`. When one side had none, it expected one flat config. In v4, `compose` always shares one flat config. You nest it explicitly with `nestConfig`.

The script adds `nestConfig` exactly where rc23 nested, so every existing `build({...})` and `mapConfig(...)` keeps its shape.

```ts
effectFactory.compose(modelFactory); // before
effectFactory.nestConfig('c1').compose(modelFactory.nestConfig('c2')); // after
```

It decides with rc23's types, innermost `compose` first. If one side has an empty config, nothing changes, because rc23 kept that case flat too.

Not rewritten: a `compose` where a config type is a generic parameter. The script cannot tell whether it has keys. Add `.nestConfig('c1')` and `.nestConfig('c2')` by hand if both sides have config keys.

### R6 Id kind checks

Ids are objects with a `kind` field in v4. The four check functions are gone.

```ts
isStateId(id)      ->  id.kind === 'state'
isDerivedId(id)    ->  id.kind === 'derived'
isEventId(id)      ->  id.kind === 'event'
isBehaviorId(id)   ->  (id.kind === 'state' || id.kind === 'derived')
```

The script adds parentheses where needed, for example `!(id.kind === 'event')`.

Not rewritten: a call whose argument is computed, such as `isStateId(ids[0])` or `isStateId(getId())`. The rewrite would evaluate the argument twice. Store it in a variable first, then compare its `kind`.

### R7 NO_VALUE argument

`NO_VALUE` is gone. Omit the initial value instead.

```ts
store.addDerivedState(id, source, NO_VALUE); // before
store.addDerivedState(id, source); // after
```

Other uses of `NO_VALUE` stay and show up as error C1.

### R8 Debug methods

Four `Store` methods moved to the testing entry `@rx-signals-next/store/testing`. They take the store as the first argument.

```ts
store.isSubscribed(id)                       ->  isSubscribed(store, id)
store.getIsSubscribedObservable(id)          ->  getIsSubscribedObservable(store, id)
store.getNumberOfBehaviorSources(id)         ->  getNumberOfBehaviorSources(store, id)
store.getNumberOfEventSources(id)            ->  getNumberOfEventSources(store, id)
```

The script adds `import { ... } from '@rx-signals-next/store/testing'`.

### R9 Id names

An id carries its name in v4, given when you create it: `getEventId<T>('saved')`. The name lookup on the store is gone.

- A `store.setIdName(id, 'name');` statement is deleted.
- `store.getIdName(id)` becomes `id.name`.
- `id.description` on an rx-signals id becomes `id.name`.

Not rewritten: `setIdName` used inside an expression, and `getIdName` with a computed argument.

### R10 Type renames

| rc23                         | v4                                 |
| ---------------------------- | ---------------------------------- |
| `AddSignalId`, `AddEffectId` | `AddId`                            |
| `AddOrReplaceId`             | `ReplaceId`                        |
| `RenameEffectId`             | `RenameId`                         |
| `ModuleSetupWithStore`       | `StoreSetup`                       |
| `Configuration`              | `object`                           |
| `ToSignalId<X>`              | `SignalId<ToSignalIdValueType<X>>` |

A local alias stays. `import { AddSignalId as Add }` becomes `import { AddId as Add }`, and the code keeps using `Add`.

### R11 Angular module to providers

`RxSignalsStoreModule` is gone. v4 provides the store with two provider functions. The script moves the module from `imports` to `providers` in every `@NgModule` and every `TestBed.configureTestingModule`.

```ts
imports: [RxSignalsStoreModule.withRootStore(setupA, setupB)]   ->  providers: [provideRootStore(setupA, setupB)]
imports: [RxSignalsStoreModule.withChildStore(setup)]           ->  providers: [provideChildStore(setup)]
imports: [RxSignalsStoreModule]                                 ->  providers: [provideRootStore()]
```

It appends to an existing `providers` array, or adds one after `imports`. `Store` is still the injection token, so `inject(Store)` and constructor injection do not change.

Not rewritten: the module anywhere else, for example in a standalone `@Component` or in `importProvidersFrom(...)`. Put `provideRootStore(...)` or `provideChildStore(...)` in the matching `providers` array by hand. Both return environment providers, so they go into an `@NgModule`, a route's `providers`, or `bootstrapApplication`. A `@Component`'s `providers` does not accept them. For a standalone component, provide the child store on the route that loads it.

### R12 package.json

The two rc23 dependencies are replaced in place.

```json
"@rx-signals/angular-provider": "3.0.0-rc4",   ->   "@rx-signals-next/angular": "<version>",
"@rx-signals/store": "3.0.0-rc23",             ->   "@rx-signals-next/store": "<version>",
```

`package-lock.json` is updated by `npm install`, not by the script.

### R13 Id types of any value

rc23 ids were covariant, so `BehaviorId<unknown>` accepted every behavior id. v4 ids are exact. The type for "any id of this kind" has its own name, and `getBehavior` and `getEventStream` accept it.

| rc23                                               | v4              |
| -------------------------------------------------- | --------------- |
| `StateId<unknown>`, `StateId<any>`                 | `AnyStateId`    |
| `BehaviorId<unknown>`, `BehaviorId<any>`           | `AnyBehaviorId` |
| `EventId<unknown>`, `EventId<any>`                 | `AnyEventId`    |
| `SignalId<unknown>`, `SignalId<any>`               | `AnySignalId`   |
| `EffectId<unknown, unknown>`, `EffectId<any, any>` | `AnyEffectId`   |

`DerivedId<unknown>` stays. If the compiler then complains, use `AnyBehaviorId`.

### R14 Generic helpers infer from the id

A helper like `emit<T>(id: EventId<T>, event: T)` used to accept `emit(added, { kind: 'info', text })`. With exact v4 ids, TypeScript infers `T` from the object literal instead (`kind: string`), and the id no longer fits. The script writes `event: NoInfer<T>`, so `T` comes from the id alone. It does this for every generic function where one parameter is an id of `T` and another parameter is plain `T`. `NoInfer` needs TypeScript 5.4 or newer.

## Removed exports

These rc23 exports have no v4 export. The script rewrites the uses in the left column of R6, R7 and R10. Anything else shows up as error C1.

| rc23                                                    | Use in v4                                                |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `NO_VALUE`                                              | Omit the initial value.                                  |
| `isStateId`, `isDerivedId`, `isEventId`, `isBehaviorId` | `id.kind === 'state'` and so on (R6).                    |
| `Configuration`                                         | `object` (R10).                                          |
| `ToSignalId<X>`                                         | `SignalId<ToSignalIdValueType<X>>` (R10).                |
| `RxSignalsStoreModule`                                  | `provideRootStore`, `provideChildStore` (R11).           |
| `MergedConfiguration<A, B>`                             | `{ c1: A; c2: B }` if both have keys, else `A & B`.      |
| `ComposedFactory`, `BindMapper`, `BuildMapper`          | Delete the annotation and let TypeScript infer the type. |
| `AssertNonExistingKey`, `EffectSignalsBuild`            | Delete the annotation.                                   |

## Compile errors after the script

`--check` prints each error under one of these entries. The C4 and C5 messages are real TypeScript 5.5 output from the fixture app. The others show the usual wording; the type names in your messages differ.

### C0 v4 packages not installed

`Cannot find module '@rx-signals-next/store' or its corresponding type declarations.`

Run `npm install`. Check that `package.json` lists both `@rx-signals-next` packages.

### C1 Removed export

`Module '"@rx-signals-next/store"' has no exported member 'NO_VALUE'.`

Replace the name with the entry in "Removed exports". The script also lists these spots under "Hand edits" with `[R1]`.

### C2 Id used as a symbol

`Type 'EventId<number>' is not assignable to type 'symbol'.`
`Argument of type 'symbol' is not assignable to parameter of type 'EventId<number>'.`

rc23 ids were symbols. v4 ids are frozen objects `{ kind, name }`. Type the variable, field, parameter or `Map` key with the id type, for example `EventId<number>`. For a collection of mixed ids use `AnySignalId`, `AnyBehaviorId`, `AnyEventId` or `AnyEffectId`.

### C3 Event source handle is not a symbol

`Type 'EventSourceHandle' is not assignable to type 'symbol'.`

`addEventSource`, `connect` to an event and `addTypedEventSource` return an `EventSourceHandle` now. Change the declared type from `symbol` to `EventSourceHandle`. Pass it to `removeEventSource` as before.

### C4 Id value types must match exactly

`Argument of type 'EventId<AppNotification>' is not assignable to parameter of type 'EventId<{ kind: string; text: string; }>'.`
`Type 'DerivedId<User>' is not assignable to type 'BehaviorId<unknown>'.`
`Type 'EventId<undefined>' is not assignable to type 'EventId<void>'.`

In rc23 an id with a narrow value type passed where a wider one was declared. A `StateId<'a'>` was a `StateId<string>`, so a reducer could write any string into a state that only allows `'a'`. v4 ids are exact. The value types on both sides must be the same. The message names the two types. Three cases come up.

- **Declared type differs from the created id.** For example `EventId<void>` for an id created with `getEventId<undefined>()`. Make both the same type.
- **A generic helper infers the type from another argument.** For example `emit<T>(id: EventId<T>, event: T)` called with an object literal infers `T` from the literal. Write `event: NoInfer<T>` in the helper (TypeScript 5.4 and newer). The id then decides `T`.
- **A parameter or list holds ids of different value types,** declared as `BehaviorId<unknown>` or `SignalId<unknown>`. `unknown` is a value type like any other now, so `DerivedId<User>` does not fit. Declare it as `BehaviorId<any>` (or `SignalId<any>`, `EventId<any>`).

### C5 Effect error is unknown

`'e.error' is of type 'unknown'.`
`Property 'message' does not exist on type '{}'.` (from `e.error?.message`)

`EffectError.error` is `unknown` in v4, not `any`. Narrow it before you read a property.

```ts
String(e.error?.message ?? e.error); // before
e.error instanceof Error ? e.error.message : String(e.error); // after
```

For Angular HTTP errors check `e.error instanceof HttpErrorResponse`. `HttpErrorResponse` is not an `Error`.

### C6 Keep flag that is not a literal

`Expected 2 arguments, but got 3.`

The script prints these under "Hand edits" with `[R3]` or `[R4]`. Delete the third argument. Where it was `false`, chain `.removeInputId('<input name>')` after `connect`, `connectId` or `connectObservable`, or `.removeEffectId('<effect name>')` after `useExistingEffect`.

### C7 Compose config shape

`Object literal may only specify known properties, and 'c1' does not exist in type '...'.`
`Property 'c2' is missing in type '...'.`

The config passed to `build` or returned from `mapConfig` does not match the composed factory. This happens after a `compose` the script could not decide (R5 under "Hand edits"). If both factories have config keys and the config is nested as `{ c1, c2 }`, add `.nestConfig('c1')` to the left factory and `.nestConfig('c2')` to the right one. If you prefer one flat config, remove the `c1` and `c2` level instead. Keys of both sides then share one object.

### C8 Function-valued state

`Argument of type '(n: number) => string' is not assignable to parameter of type '() => Formatter'.`

A state or derived state whose value is a function takes its initial value as a getter. Wrap it: `store.addState(formatterState, () => formatNumber)`.

### C9 Removed method

`Property 'bind' does not exist on type 'SignalsFactory<...>'.`
`Property 'add2TypedEventSource' does not exist on type 'Store'.`

- `f.bind(mapper)` becomes `f.fmap(build => mapper(build).build)`.
- `add2TypedEventSource` and the others become `addTypedEventSource([ids], source)`. The script rewrites plain calls (R2). This error means the call was not plain, for example `store['add2TypedEventSource'](...)`.
- `isSubscribed` and the other three debug methods are functions in `@rx-signals-next/store/testing` (R8). This error means the receiver was not typed as `Store`.
- `setIdName` and `getIdName` are gone (R9). Use `id.name`.

### C? Not a known migration error

Anything else. The app compiled before, so the migration caused it. Read the message for the rx-signals type it names and compare with the entries above. Report it if none fits.

## Behavior changes without a compile error

These compile and run, but behave differently. Most are rc23 bug fixes. The script puts a `verify` marker on the sites of B3, B5, B6 and B8. B7 matters for tests that relied on state carried over between them.

- **B1 dispatch.** The promise resolves after the event was delivered, and it never rejects. In rc23 it could reject on a source error, and it resolved about one millisecond later.
- **B2 Errors no longer kill state.** A reducer that throws, a source that errors on a state, and an event source that errors no longer break the state or the stream for good. The state keeps its last value. The error goes to Angular's `ErrorHandler`. A derived state whose source errors passes the error to its current subscribers, keeps its last value, and retries the source on the next subscription.
- **B3 Typed event sources are one step faster.** rc23 delayed events of `add2TypedEventSource` and the others by one macrotask (`delay(1)`). `addTypedEventSource` does not. Events arrive in the order they were dispatched, across parent and child stores. Check code that relied on a typed source event arriving after a plain dispatch made in the same turn.
- **B4 Lifecycles.** `getLifecycleHandle` records everything registered while its callback runs, as in rc23. `end()` now also works after `reset()`.
- **B5 Effect factory fixes.** An effect that completes without a value ends `resultPending`. A trigger applies to the input that was current when it was dispatched. A trigger during the debounce time is no longer lost. An input that is equal per `effectInputEquals` no longer cancels a running triggered effect. `invalidate` re-runs a triggered input without a new trigger.
- **B6 Validated input with result.** A result trigger while the current input is invalid no longer saves the old valid input.
- **B7 Root store per injector.** rc4 kept one root store per page in a module variable. v4 creates one root store per Angular root injector. In tests, every `TestBed` gets a fresh root store, so state no longer leaks from one test into the next.
- **B8 Child store per injector.** `provideChildStore` creates the child store when its injector first injects `Store`, not when the module file loads. The parent is the nearest store above it. The child is completed when its injector is destroyed, for example when a lazy route is left. A lazy route that loads again gets a fresh child store with fresh state.
- **B9 Setups run once per store.** Setup functions run lazily on the first injection of `Store`, as in rc4. Passing the same setup function to `provideRootStore` in two modules no longer throws. It runs once.
- **B10 Ids are objects.** `typeof id` is `'object'`, not `'symbol'`. `String(id)` differs. Ids still work as `Map` and `Set` keys. `id.kind` of an effect id is `'effect'`. rc23's `isEventId` returned `true` for effect ids.
- **B11 Id names.** Names set with `setIdName` are gone. `id.name` contains the name given to `get*Id('name')`. Check log output or tests that compared names.
- **B12 No subscription leak per event.** rc23 kept about 1.9 KB per dispatched event for every direct `getEventStream` subscriber. v4 does not.
- **B13 Child state overrides parent state.** A child store's `addState` for an id that the parent also has now takes over for the child's subscribers.

- **B14 Model output is derived state.** `getModelSignalsFactory` exposes `output.model` as a `DerivedId`. In rc23 it was a state id typed as `BehaviorId`. Code that only reads it does not change.
- **B15 Behaviors resolve their cell on subscribe.** An observable from `getBehavior` or `getEventStream` looks up its signal when it is subscribed. After `completeBehavior` or `completeAllSignals`, subscribing an observable you kept from before reads the new state, not a completed one.
- **B16 Id names in messages.** Error messages and `id.name` show `D_1` or the name you passed, not `Symbol(D_1)`. Check tests that compare error messages.

## What the fixture app needed

The repository's fixture app (`fixtures/angular19-rc23`) mirrors the real app's use of rx-signals. 20 of its 25 TypeScript files use rx-signals. The script changed all 20 and marked 4 behavior changes to check. After it, 2 files needed a hand edit, both `C5`:

- `selftest/selftest.service.ts`. `String(e.error?.message ?? e.error)`. Fix: `e.error instanceof Error ? e.error.message : String(e.error)`.
- `features/auswertung/auswertung-signals.factory.ts`. The same pattern in an error notification.

`fixture-hand-edits.patch` holds exactly these edits. `node scripts/fixture-gate.mjs --migrate` runs the script on a copy of the fixture, applies the patch, deletes the verify markers, installs the v4 packages built from this repository, requires `--check` to print "Done", and checks the result against the rc23 baseline.
