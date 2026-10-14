# rx-signals fixture

A stand-in for the internal Angular app that uses `@rx-signals/store@3.0.0-rc23`. The codemod that migrates to the forked v4 must pass this app before it touches the real one.

Pinned like the real app: Angular 19.2.17, TypeScript 5.5.4, rxjs 7.8.1, `@rx-signals/store` 3.0.0-rc23, `@rx-signals/angular-provider` 3.0.0-rc4, npm with `package-lock.json`. The root is an NgModule app. `KostenstelleEditComponent` is standalone and imported into `AppModule`.

## Gate

```sh
npm ci
npm run typecheck                              # tsc on app and spec tsconfigs
npm run build                                  # ng build
npm run -s selftest > report.json              # headless Chromium, prints the #report JSON
diff baseline-report.json report.json
CHROME_BIN=/usr/bin/chromium npx ng test --watch=false --browsers=ChromeHeadless
```

`scripts/selftest.mjs` needs Node 22 or newer for the global `WebSocket`. It serves `dist/` on a free port, starts the first of `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `chrome` it finds on `PATH` (or `CHROME_BIN`), and polls for `<pre id="report">`. It exits 1 if the report has an `error` key or never appears.

On startup the root component runs `SelftestService`. It dispatches a fixed script against the root store and the lazy child store and waits for an observable condition after each step. The report holds values only, never ids or timestamps, so two runs on rc23 are byte-identical. If a step fails, the report keeps the finished sections plus `"error": "<section>: <reason>"`.

The script stays clear of the nine known rc23 bugs listed in the brief. One exception is deliberate. `berichte.parentEventViaChild` records that dispatching a root event on the child store returns `false` in rc23. If v4 changes that, the diff will show it.

## API coverage

Paths are relative to `src/app/`.

| File | rc23 API |
|---|---|
| `app.module.ts` | `RxSignalsStoreModule.withRootStore(...setups)`, effects registered from `provideAppInitializer` |
| `core/app.signals.ts` | `getStateId`, `getDerivedId`, `getEventId`, typed `StateId`/`DerivedId`/`EventId`/`BehaviorId` constants, `addState`, 7 x `addReducer`, `addDerivedState` combining 3 behaviors, `connect` (event to derived), `connectObservable`, `add2TypedEventSource` with `TypedEvent`, `getEventStream` |
| `core/app-effects.service.ts` | `getEffectId`, `EffectId`, `Effect` typed variable, `addEffect` with `Store` injected in a service |
| `core/session.service.ts` | `getEffect` and calling the effect by hand, awaited `dispatch`, `dispatch` of an `EventId<undefined>` without payload |
| `core/notification.service.ts` | `getBehavior`, `getEventStream`, generic `dispatch` through an `EventId<T>` parameter |
| `core/api.service.ts` | HttpClient-like fake: `of(...).pipe(delay(20))`, logs every request |
| `features/auswertung/auswertung-signals.factory.ts` | `getEffectSignalsFactory` with `withTrigger`, `effectDebounceTime`, `effectInputEquals`, `initialResultGetter`. Also `getModelSignalsFactory`, two levels of `.compose`, `.connect`, `.connectObservable` (x2), `.useExistingEffect`, `.mapConfig` into nested `c1`/`c2`, `.renameInputId`, `.addOutputId`, `.extendSetup`, `.mapInput`, `.mapOutput`, a hand-written `new SignalsFactory(...)` (paging), exported `AuswertungSignalsFactory`/`AuswertungSignals` types, `CombinedEffectResult`, `EffectError`, `EffectSuccess`, `addEventSource` on effect errors |
| `features/auswertung/auswertung.signals.ts` | `.build(config)` of the custom factory |
| `features/auswertung/auswertung.component.ts` + `.html` | constructor-injected `Store`, `getBehavior` with the async pipe, unawaited `dispatch` in handlers, one awaited |
| `features/kostenstelle/kostenstelle-edit.signals.ts` | `getValidatedInputWithResultSignalsFactory` built with `withResultTrigger: true`, `.connectId`, `.extendSetup` + `addEventSource`, form state with 3 reducers |
| `features/kostenstelle/kostenstelle.effects.ts` | effect setup file: `getEffectId`, `Effect` typed variables and factory-produced effects, `previousInput`/`previousResult` effect params, `addEffect` on factory effect ids, `getEffect` + awaited `dispatch` |
| `features/kostenstelle/kostenstelle-edit.component.ts` + `.html` | standalone component, `inject(Store)`, `ValidatedInputWithResult` rendered in the template, awaited `dispatch` of `resultTrigger` |
| `features/berichte/berichte.module.ts` | lazy route, `RxSignalsStoreModule.withChildStore(setup)` |
| `features/berichte/berichte.signals.ts` | `getModelSignalsFactory().build` used directly, child-only state, `addDerivedState` combining child and parent behaviors, `getEffect` of a root effect from the child |
| `features/berichte/berichte.component.ts` + `.html` | child `Store` reading child and root state, `BehaviorId<T>` parameter |
| `selftest/probe.ts` | `BehaviorId<T>`/`EventId<T>` helper params, `getBehavior`, `getEventStream` |
| `selftest/selftest.service.ts` | the scripted run. `dispatch` on root and child store, `getParentStore` |

| Spec | Covers |
|---|---|
| `features/auswertung/auswertung-signals.factory.spec.ts` | `getLifecycleHandle`, `LifecycleHandle.reset()`/`.end()`, trigger mode, paging |
| `core/app.signals.spec.ts` | reducers, derived header, typed event source, `completeAllSignals` |
| `features/kostenstelle/kostenstelle-edit.component.spec.ts` | TestBed with `{ provide: Store, useValue: new Store() }`, save via click |
| `features/berichte/berichte.signals.spec.ts` | `createChildStore`, parent state and effects seen from the child |
