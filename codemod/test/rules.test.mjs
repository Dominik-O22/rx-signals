// One block per rule: rc23 input, expected v4 output. Every migrateSource call also runs the
// codemod a second time and fails if that run changes anything.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { migrateFiles, migrateSource } from './app.mjs';

describe('R1 module paths', () => {
  test('rewrites import, export, import type and dynamic import paths', () => {
    const input = `import { Store } from '@rx-signals/store';
import { RxSignalsStoreModule as M } from "@rx-signals/angular-provider";
export { getEventId } from '@rx-signals/store';
export type S = import('@rx-signals/store').Store;
export const lazy = () => import('@rx-signals/store');
export const store = new Store();
export const m = M;
`;
    assert.equal(
      migrateSource(input),
      `import { Store } from '@rx-signals-next/store';
import { RxSignalsStoreModule as M } from "@rx-signals-next/angular";
export { getEventId } from '@rx-signals-next/store';
export type S = import('@rx-signals-next/store').Store;
export const lazy = () => import('@rx-signals-next/store');
export const store = new Store();
// TODO(rx-signals-v4) R1: RxSignalsStoreModule is not exported by v4. MIGRATION.md, Removed exports.
export const m = M;
`,
    );
  });

  test('reports a deep import instead of guessing', () => {
    const { result } = migrateFiles({
      'src/a.ts': `import { x } from '@rx-signals/store/dist/esm/store-utils';\n`,
    });
    assert.deepEqual(
      result.manual.map(m => `${m.rule} ${m.file}:${m.line}`),
      ['R1 src/a.ts:1'],
    );
  });
});

describe('R2 typed event sources', () => {
  test('wraps the ids in an array and turns the event id flag into an option', () => {
    const input = `import { getEventId, Store } from '@rx-signals/store';
declare const store: Store;
declare const source: any;
const a = getEventId<number>();
const b = getEventId<string>();
const c = getEventId<boolean>();
store.add2TypedEventSource(a, b, source);
store.add2TypedEventSource(a, b, source, null);
store.add3TypedEventSource(
  a,
  b,
  c,
  source,
  a,
);
`;
    assert.equal(
      migrateSource(input),
      `import { getEventId, Store } from '@rx-signals-next/store';
declare const store: Store;
declare const source: any;
const a = getEventId<number>();
const b = getEventId<string>();
const c = getEventId<boolean>();
// TODO(rx-signals-v4) verify B3: typed source events no longer wait one extra macrotask. MIGRATION.md, B3.
store.addTypedEventSource([a, b], source);
// TODO(rx-signals-v4) verify B3: typed source events no longer wait one extra macrotask. MIGRATION.md, B3.
store.addTypedEventSource([a, b], source);
// TODO(rx-signals-v4) verify B3: typed source events no longer wait one extra macrotask. MIGRATION.md, B3.
store.addTypedEventSource(
  [a, b, c],
  source,
  { onlyWhileSubscribed: a },
);
`,
    );
  });
});

describe('R3 connect keep flag', () => {
  const header = `import { SignalsFactory } from '@rx-signals/store';
declare const f: SignalsFactory<{ a: any; b: any }, { x: any }>;
`;
  const v4Header = header.replace('@rx-signals/store', '@rx-signals-next/store');

  test('drops true, turns false into removeInputId', () => {
    const input = `${header}export const kept = f.connect('x', 'a', true);
export const dropped = f.connectId(Symbol() as any, 'b', false);
export const observed = f.connectObservable(() => null as any, 'a', false);
`;
    assert.equal(
      migrateSource(input),
      `${v4Header}export const kept = f.connect('x', 'a');
export const dropped = f.connectId(Symbol() as any, 'b').removeInputId('b');
export const observed = f.connectObservable(() => null as any, 'a').removeInputId('a');
`,
    );
  });

  test('does not fire on a connect that is not rc23 SignalsFactory.connect', () => {
    const input = `class Wiring {
  connect(a: string, b: string, keep: boolean) {
    return this;
  }
}
new Wiring().connect('x', 'a', false);
`;
    assert.equal(migrateSource(input), input);
  });

  test('reports a keep flag that is not a literal', () => {
    const { output, result } = migrateFiles({
      'src/a.ts': `${header}declare const keep: boolean;\nf.connect('x', 'a', keep);\n`,
    });
    assert.equal(
      output['src/a.ts'],
      `${v4Header}declare const keep: boolean;\n${'// TODO(rx-signals-v4) R3: keep flag is not a literal. MIGRATION.md, R3.'}\nf.connect('x', 'a', keep);\n`,
    );
    assert.deepEqual(
      result.manual.map(m => `${m.rule} ${m.file}:${m.line}`),
      ['R3 src/a.ts:4'],
    );
  });
});

describe('R4 useExistingEffect keep flag', () => {
  test('drops true, turns false into removeEffectId', () => {
    const input = `import { EffectId, SignalsFactory } from '@rx-signals/store';
declare const f: SignalsFactory<{}, {}, {}, { load: EffectId<number, string> }>;
declare const id: EffectId<number, string>;
export const kept = f.useExistingEffect('load', () => id, true);
export const dropped = f.useExistingEffect('load', () => id, false);
`;
    assert.equal(
      migrateSource(input),
      `import { EffectId, SignalsFactory } from '@rx-signals-next/store';
declare const f: SignalsFactory<{}, {}, {}, { load: EffectId<number, string> }>;
declare const id: EffectId<number, string>;
export const kept = f.useExistingEffect('load', () => id);
export const dropped = f.useExistingEffect('load', () => id).removeEffectId('load');
`,
    );
  });
});

describe('R5 compose config nesting', () => {
  const header = `import { SignalsFactory } from '@rx-signals/store';
declare const withA: SignalsFactory<{}, {}, { a: number }>;
declare const withB: SignalsFactory<{}, {}, { b?: string }>;
declare const withC: SignalsFactory<{}, {}, { c: boolean }>;
declare const noConfig: SignalsFactory<{}, {}, {}>;
`;
  const v4Header = header.replace('@rx-signals/store', '@rx-signals-next/store');

  test('nests where rc23 nested, innermost compose first', () => {
    const input = `${header}export const two = withA.compose(withB);
export const three = withA.compose(withB).compose(withC);
`;
    assert.equal(
      migrateSource(input),
      `${v4Header}export const two = withA.nestConfig('c1').compose(withB.nestConfig('c2'));
export const three = withA.nestConfig('c1').compose(withB.nestConfig('c2')).nestConfig('c1').compose(withC.nestConfig('c2'));
`,
    );
  });

  test('leaves compose alone when one side has no config, as rc23 kept it flat', () => {
    const input = `${header}export const flat = withA.compose(noConfig);
export const flatToo = noConfig.compose(withB).compose(withC);
`;
    const output = migrateSource(input);
    assert.equal(
      output,
      `${v4Header}export const flat = withA.compose(noConfig);
export const flatToo = noConfig.compose(withB).nestConfig('c1').compose(withC.nestConfig('c2'));
`,
    );
  });

  test('a removal from R3 lands before the nesting from R5 on the same factory', () => {
    const input = `import { SignalsFactory } from '@rx-signals/store';
declare const f: SignalsFactory<{ a: any }, { x: any }, { a: number }>;
declare const g: SignalsFactory<{}, {}, { b: number }>;
export const h = f.connect('x', 'a', false).compose(g);
`;
    assert.equal(
      migrateSource(input),
      `import { SignalsFactory } from '@rx-signals-next/store';
declare const f: SignalsFactory<{ a: any }, { x: any }, { a: number }>;
declare const g: SignalsFactory<{}, {}, { b: number }>;
export const h = f.connect('x', 'a').removeInputId('a').nestConfig('c1').compose(g.nestConfig('c2'));
`,
    );
  });
});

describe('R6 id kind checks', () => {
  test('replaces the four checks with kind comparisons, parenthesized where needed', () => {
    const input = `import { getStateId, isBehaviorId, isDerivedId, isEventId, isStateId, SignalId } from '@rx-signals/store';
declare const id: SignalId<number>;
declare const holder: { id: SignalId<number> };
export const a = isStateId(id);
export const b = !isEventId(holder.id);
export const c = isDerivedId(id) && isBehaviorId(id);
export const d = getStateId<number>();
`;
    assert.equal(
      migrateSource(input),
      `import { getStateId, SignalId } from '@rx-signals-next/store';
declare const id: SignalId<number>;
declare const holder: { id: SignalId<number> };
export const a = id.kind === 'state';
export const b = !(holder.id.kind === 'event');
export const c = id.kind === 'derived' && (id.kind === 'state' || id.kind === 'derived');
export const d = getStateId<number>();
`,
    );
  });

  test('does not fire on a local function with the same name', () => {
    const input = `const isStateId = (x: unknown) => typeof x === 'symbol';
export const a = isStateId(Symbol());
`;
    assert.equal(migrateSource(input), input);
  });

  test('keeps the import and reports a call it cannot rewrite', () => {
    const { output, result } = migrateFiles({
      'src/a.ts': `import { isStateId, SignalId } from '@rx-signals/store';
declare const ids: SignalId<number>[];
export const a = isStateId(ids[0]);
`,
    });
    assert.equal(
      output['src/a.ts'],
      `import { isStateId, SignalId } from '@rx-signals-next/store';
declare const ids: SignalId<number>[];
// TODO(rx-signals-v4) R6: computed argument. MIGRATION.md, R6.
// TODO(rx-signals-v4) R1: isStateId is not exported by v4. MIGRATION.md, Removed exports.
export const a = isStateId(ids[0]);
`,
    );
    assert.deepEqual(
      result.manual.map(m => `${m.rule} ${m.file}:${m.line}`),
      ['R6 src/a.ts:3', 'R1 src/a.ts:3'],
    );
  });
});

describe('R7 NO_VALUE argument', () => {
  test('drops NO_VALUE as the initial value of addDerivedState and its import', () => {
    const input = `import { DerivedId, NO_VALUE, Store } from '@rx-signals/store';
declare const store: Store;
declare const id: DerivedId<number>;
declare const source: any;
store.addDerivedState(id, source, NO_VALUE);
store.addDerivedState(id, source, 1);
`;
    assert.equal(
      migrateSource(input),
      `import { DerivedId, Store } from '@rx-signals-next/store';
declare const store: Store;
declare const id: DerivedId<number>;
declare const source: any;
store.addDerivedState(id, source);
store.addDerivedState(id, source, 1);
`,
    );
  });
});

describe('R8 debug methods', () => {
  test('turns store methods into testing functions with the store first', () => {
    const input = `import { getEventId, Store } from '@rx-signals/store';
const store = new Store();
const id = getEventId<number>();
export const a = store.isSubscribed(id);
export const b = store.getNumberOfEventSources(id);
`;
    assert.equal(
      migrateSource(input),
      `import { getEventId, Store } from '@rx-signals-next/store';
import { getNumberOfEventSources, isSubscribed } from '@rx-signals-next/store/testing';
const store = new Store();
const id = getEventId<number>();
export const a = isSubscribed(store, id);
export const b = getNumberOfEventSources(store, id);
`,
    );
  });

  test('adds the import in a file that imports nothing else from rx-signals', () => {
    const { output } = migrateFiles({
      'src/store.ts': `import { Store } from '@rx-signals/store';\nexport const store = new Store();\n`,
      'src/a.spec.ts': `import { store } from './store';\nexport const hot = store.isSubscribed(Symbol() as any);\n`,
    });
    assert.equal(
      output['src/a.spec.ts'],
      `import { store } from './store';\nimport { isSubscribed } from '@rx-signals-next/store/testing';\nexport const hot = isSubscribed(store, Symbol() as any);\n`,
    );
  });
});

describe('R9 id names', () => {
  test('deletes setIdName statements, reads names from the id', () => {
    const input = `import { getStateId, Store } from '@rx-signals/store';
const store = new Store();
const id = getStateId<number>();
store.setIdName(id, 'counter');
export const a = store.getIdName(id);
export const b = id.description;
export const c = Symbol('plain').description;
`;
    assert.equal(
      migrateSource(input),
      `import { getStateId, Store } from '@rx-signals-next/store';
const store = new Store();
const id = getStateId<number>();
export const a = id.name;
export const b = id.name;
export const c = Symbol('plain').description;
`,
    );
  });
});

describe('R10 type renames', () => {
  test('renames types in the import and at each use', () => {
    const input = `import { AddEffectId, AddSignalId, Configuration, ToSignalId, EventId } from '@rx-signals/store';
import { ModuleSetupWithStore } from '@rx-signals/angular-provider';
export type A = AddSignalId<{}, 'a', EventId<number>>;
export type B = AddEffectId<{}, 'b', EventId<number>>;
export type C<T extends Configuration> = T;
export type D = ToSignalId<EventId<number>>;
export const setup: ModuleSetupWithStore = () => undefined;
`;
    assert.equal(
      migrateSource(input),
      `import { AddId, EventId, SignalId, ToSignalIdValueType } from '@rx-signals-next/store';
import { StoreSetup } from '@rx-signals-next/angular';
export type A = AddId<{}, 'a', EventId<number>>;
export type B = AddId<{}, 'b', EventId<number>>;
export type C<T extends object> = T;
export type D = SignalId<ToSignalIdValueType<EventId<number>>>;
export const setup: StoreSetup = () => undefined;
`,
    );
  });

  test('keeps a local alias and renames only what it imports', () => {
    const input = `import { AddSignalId as Add } from '@rx-signals/store';
export type A = Add<{}, 'a', number>;
`;
    assert.equal(
      migrateSource(input),
      `import { AddId as Add } from '@rx-signals-next/store';
export type A = Add<{}, 'a', number>;
`,
    );
  });
});

describe('R11 Angular module to providers', () => {
  test('moves withRootStore from NgModule imports to a new providers array', () => {
    const input = `import { RxSignalsStoreModule } from '@rx-signals/angular-provider';
declare const NgModule: (m: object) => ClassDecorator;
declare const BrowserModule: unknown;
declare const setupA: any, setupB: any;

@NgModule({
  imports: [
    BrowserModule,
    RxSignalsStoreModule.withRootStore(
      setupA,
      setupB,
    ),
  ],
})
export class AppModule {}
`;
    assert.equal(
      migrateSource(input),
      `import { provideRootStore } from '@rx-signals-next/angular';
declare const NgModule: (m: object) => ClassDecorator;
declare const BrowserModule: unknown;
declare const setupA: any, setupB: any;

@NgModule({
  imports: [
    BrowserModule,
  ],
  providers: [provideRootStore(setupA, setupB)],
})
export class AppModule {}
`,
    );
  });

  test('appends withChildStore and the bare module to existing providers', () => {
    const input = `import { RxSignalsStoreModule } from '@rx-signals/angular-provider';
declare const NgModule: (m: object) => ClassDecorator;
declare const TestBed: { configureTestingModule(m: object): void };
declare const setup: any, other: any;

@NgModule({ imports: [RxSignalsStoreModule.withChildStore(setup), other], providers: [other] })
export class FeatureModule {}

TestBed.configureTestingModule({
  imports: [RxSignalsStoreModule],
  providers: [
    other,
  ],
});
`;
    assert.equal(
      migrateSource(input),
      `import { provideChildStore, provideRootStore } from '@rx-signals-next/angular';
declare const NgModule: (m: object) => ClassDecorator;
declare const TestBed: { configureTestingModule(m: object): void };
declare const setup: any, other: any;

// TODO(rx-signals-v4) verify B8: the child store now lives and ends with this injector. MIGRATION.md, B8.
@NgModule({ imports: [other], providers: [other, provideChildStore(setup)] })
export class FeatureModule {}

TestBed.configureTestingModule({
  imports: [],
  providers: [
    other,
    provideRootStore(),
  ],
});
`,
    );
  });

  test('reports a standalone component instead of moving it', () => {
    const input = `import { RxSignalsStoreModule } from '@rx-signals/angular-provider';
declare const Component: (m: object) => ClassDecorator;
@Component({ imports: [RxSignalsStoreModule] })
export class Widget {}
`;
    const { output, result } = migrateFiles({ 'src/a.ts': input });
    assert.equal(
      output['src/a.ts'],
      input
        .replace('@rx-signals/angular-provider', '@rx-signals-next/angular')
        .replace(
          '@Component',
          '// TODO(rx-signals-v4) R11: not in an @NgModule. MIGRATION.md, R11.\n// TODO(rx-signals-v4) R1: RxSignalsStoreModule is not exported by v4. MIGRATION.md, Removed exports.\n@Component',
        ),
    );
    assert.deepEqual(
      result.manual.map(m => `${m.rule} ${m.file}:${m.line}`),
      ['R11 src/a.ts:3', 'R1 src/a.ts:3'],
    );
  });
});

describe('R12 package.json', () => {
  test('swaps the two dependencies in place, with the given version', () => {
    const { packageJson, second } = migrateFiles(
      { 'src/a.ts': 'export {};\n' },
      { version: '4.1.0' },
    );
    assert.equal(
      packageJson,
      `{
  "name": "app",
  "dependencies": {
    "@angular/core": "19.2.17",
    "@rx-signals-next/angular": "4.1.0",
    "@rx-signals-next/store": "4.1.0",
    "rxjs": "7.8.1"
  }
}
`,
    );
    assert.equal(second.packageJson, undefined);
  });
});

describe('the whole run', () => {
  test('a second run changes nothing', () => {
    const input = `import { NO_VALUE, SignalsFactory, Store, getEventId } from '@rx-signals/store';
import { RxSignalsStoreModule } from '@rx-signals/angular-provider';
declare const NgModule: (m: object) => ClassDecorator;
declare const f: SignalsFactory<{ a: any }, { x: any }, { a: number }>;
declare const store: Store;
store.addDerivedState(Symbol() as any, null as any, NO_VALUE);
export const g = f.connect('x', 'a', false).compose(f);
export const hot = store.isSubscribed(getEventId<number>());
@NgModule({ imports: [RxSignalsStoreModule.withRootStore()] })
export class AppModule {}
`;
    const { result, second } = migrateFiles({ 'src/a.ts': input });
    assert.equal(result.files.length, 1);
    assert.deepEqual(second.files, []);
    assert.deepEqual(second.matches, []);
    assert.equal(second.packageJson, undefined);
  });

  test('--dry plans edits and writes nothing', () => {
    const input = `import { Store } from '@rx-signals/store';\nexport const store = new Store();\n`;
    const { output, result, packageJson } = migrateFiles({ 'src/a.ts': input }, { dry: true });
    assert.equal(output['src/a.ts'], input);
    assert.match(packageJson, /"@rx-signals\/store": "3.0.0-rc23"/);
    assert.deepEqual(
      result.matches.map(m => `${m.rule} ${m.file}:${m.line}`),
      ['R1 src/a.ts:1'],
    );
  });
});

describe('verify markers', () => {
  test('marks trigger configs, whose semantics v4 fixed', () => {
    const input = `import { getEffectSignalsFactory } from '@rx-signals/store';
export const f = getEffectSignalsFactory<number, string>().build({
  withTrigger: true,
});
`;
    assert.equal(
      migrateSource(input),
      `import { getEffectSignalsFactory } from '@rx-signals-next/store';
export const f = getEffectSignalsFactory<number, string>().build({
  // TODO(rx-signals-v4) verify B5: trigger semantics changed, check this effect still runs when expected. MIGRATION.md, B5.
  withTrigger: true,
});
`,
    );
  });

  test('leaves withTrigger: false alone', () => {
    const input = `import { getEffectSignalsFactory } from '@rx-signals/store';
export const f = getEffectSignalsFactory<number, string>().build({ withTrigger: false });
`;
    assert.equal(
      migrateSource(input),
      input.replace('@rx-signals/store', '@rx-signals-next/store'),
    );
  });
});
