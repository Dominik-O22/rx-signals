#!/usr/bin/env node
// Moves an Angular app from @rx-signals/store 3.0.0-rc23 + @rx-signals/angular-provider 3.0.0-rc4
// to the v4 packages. Read MIGRATION.md next to this file first.
//
//   node migrate-rx-signals.mjs [app-dir] --dry     print every planned edit, change nothing
//   node migrate-rx-signals.mjs [app-dir]           write the edits and package.json
//   node migrate-rx-signals.mjs [app-dir] --check   after `npm install`: list the compile errors left
//
// Options:
//   --version <v>        version of the v4 packages written to package.json (default below)
//   --project <tsconfig> tsconfig to read, repeatable. Default: tsconfig.app.json and
//                        tsconfig.spec.json when they exist, else tsconfig.json.
//
// How it works. Zero dependencies: TypeScript is loaded from the app's own node_modules. The script
// builds one ts.Program per tsconfig while the app still has rc23 installed. Each rule looks at the
// syntax tree (and, where marked "typed", asks the type checker whether a method really belongs to
// rc23) and records small text edits. All decisions use the original rc23 program. The edits of a
// file are then applied back to front, so earlier offsets stay valid. Two edits that overlap are a
// bug in a rule, and the script stops instead of guessing.
//
// Idempotent: every rule matches only rc23 names or rc23 declarations, which the first run removed.
// A second run prints "nothing to change".
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------------------------
// Every v4 name this script emits. When the v4 packages rename something, edit it here only.
// ---------------------------------------------------------------------------------------------
const V4 = {
  storePackage: '@rx-signals-next/store',
  storeTestingEntry: '@rx-signals-next/store/testing',
  angularPackage: '@rx-signals-next/angular',
  defaultVersion: '4.0.0-dev.0',

  // R2: add2TypedEventSource(a, b, source, only) -> addTypedEventSource([a, b], source, { onlyWhileSubscribed: only })
  addTypedEventSource: 'addTypedEventSource',
  onlyWhileSubscribedOption: 'onlyWhileSubscribed',
  // R3, R4: a `false` keep flag becomes a chained removal
  removeInputId: 'removeInputId',
  removeEffectId: 'removeEffectId',
  // R5: a.compose(b) -> a.nestConfig('c1').compose(b.nestConfig('c2'))
  nestConfig: 'nestConfig',
  composeSlots: ['c1', 'c2'],
  // R6: isStateId(id) -> id.kind === 'state'
  idKindProperty: 'kind',
  idKinds: { isStateId: 'state', isDerivedId: 'derived', isEventId: 'event' },
  // R8: store.isSubscribed(id) -> isSubscribed(store, id), imported from the testing entry
  testingFunctions: [
    'isSubscribed',
    'getIsSubscribedObservable',
    'getNumberOfBehaviorSources',
    'getNumberOfEventSources',
  ],
  // R9: store.getIdName(id) and id.description -> id.name
  idNameProperty: 'name',
  // R10: type names
  typeRenames: {
    AddSignalId: 'AddId',
    AddEffectId: 'AddId',
    AddOrReplaceId: 'ReplaceId',
    RenameEffectId: 'RenameId',
    ModuleSetupWithStore: 'StoreSetup',
  },
  configurationType: 'object', // Configuration -> object
  signalIdType: 'SignalId', // ToSignalId<X> -> SignalId<ToSignalIdValueType<X>>
  signalIdValueType: 'ToSignalIdValueType',
  // R11: RxSignalsStoreModule in `imports` -> provider function in `providers`
  provideRootStore: 'provideRootStore',
  provideChildStore: 'provideChildStore',
};

const RC23 = {
  storePackage: '@rx-signals/store',
  angularPackage: '@rx-signals/angular-provider',
  // Declarations of rc23's Store and SignalsFactory live under this path (npm or pnpm layout).
  storeDeclarations: /[\\/]@rx-signals[\\/]store[\\/]/,
};

const PACKAGES = {
  [RC23.storePackage]: V4.storePackage,
  [RC23.angularPackage]: V4.angularPackage,
};

// rc23 exports v4 does not have. A rule rewrites most uses; an import specifier is dropped once no
// use is left, and every use a rule could not rewrite is reported for a hand edit.
const REMOVED_EXPORTS = new Set([
  'NO_VALUE',
  'isStateId',
  'isDerivedId',
  'isEventId',
  'isBehaviorId',
  'Configuration',
  'ToSignalId',
  'RxSignalsStoreModule',
  'MergedConfiguration',
  'BindMapper',
  'BuildMapper',
  'ComposedFactory',
  'AssertNonExistingKey',
  'EffectSignalsBuild',
]);

// ---------------------------------------------------------------------------------------------
// Per-file context and edit helpers
// ---------------------------------------------------------------------------------------------

/**
 * One file being migrated.
 *   edits:   { start, end, text, rule, seq }. A zero-length edit is an insertion.
 *   matches: one line per rewritten site, for --dry and the summary.
 *   manual:  sites a human must edit.
 *   imports: rc23 import declarations and the local names they bind.
 *   addedImports: module -> names that rewritten code now needs.
 */
function createFileContext(ts, checker, sf, appDir) {
  return {
    ts,
    checker,
    sf,
    file: relative(appDir, sf.fileName),
    edits: [],
    matches: [],
    manual: [],
    imports: readImports(ts, sf),
    addedImports: new Map(),
  };
}

const ruleNumber = rule => Number(rule.slice(1));

function replace(ctx, rule, start, end, text) {
  ctx.edits.push({ start, end, text, rule, seq: ctx.edits.length });
}

function insert(ctx, rule, pos, text) {
  replace(ctx, rule, pos, pos, text);
}

const lineOf = (ctx, node) => ctx.sf.getLineAndCharacterOfPosition(node.getStart(ctx.sf)).line + 1;

function match(ctx, rule, node, note) {
  ctx.matches.push({ rule, file: ctx.file, line: lineOf(ctx, node), note });
}

function manual(ctx, rule, node, note) {
  ctx.manual.push({ rule, file: ctx.file, line: lineOf(ctx, node), note });
}

function addImport(ctx, module, name) {
  if (!ctx.addedImports.has(module)) ctx.addedImports.set(module, new Set());
  ctx.addedImports.get(module).add(name);
}

const text = (ctx, node) => node.getText(ctx.sf);

/** Widens [start, end) to whole lines when nothing else is on them, so a deleted statement leaves no blank line. */
function wholeLines(source, start, end) {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const newline = source.indexOf('\n', end);
  const lineEnd = newline === -1 ? source.length : newline + 1;
  const blank = s => /^[ \t]*$/.test(s);
  const before = source.slice(lineStart, start);
  const after = source.slice(end, newline === -1 ? source.length : newline);
  return blank(before) && blank(after.replace(/\r$/, '')) ? [lineStart, lineEnd] : [start, end];
}

function indentAt(source, pos) {
  const lineStart = source.lastIndexOf('\n', pos - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart))[0];
}

/** `x`, `this.x`, `a.b.c`: safe to repeat in the rewritten text because evaluating it has no effect. */
function isSimpleReference(ts, node) {
  if (ts.isIdentifier(node) || node.kind === ts.SyntaxKind.ThisKeyword) return true;
  return (
    ts.isPropertyAccessExpression(node) &&
    !node.questionDotToken &&
    isSimpleReference(ts, node.expression)
  );
}

/** The rc23 import an identifier refers to, by local name: { module, imported } or undefined. */
const rc23Binding = (ctx, identifier) =>
  ctx.ts.isIdentifier(identifier) ? ctx.imports.bindings.get(identifier.text) : undefined;

/** Typed check: `nameNode` (a method name) resolves to a member of rc23's class `className`. */
function isRc23Member(ctx, nameNode, className) {
  const declaration = ctx.checker.getSymbolAtLocation(nameNode)?.declarations?.[0];
  if (!declaration || !RC23.storeDeclarations.test(declaration.getSourceFile().fileName))
    return false;
  const owner = declaration.parent;
  return ctx.ts.isClassLike(owner) && owner.name?.text === className;
}

/** `receiver.method(...)` with a plain dot. Returns the method name node or undefined. */
function methodCall(ts, node, names) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return undefined;
  if (node.expression.questionDotToken) return undefined;
  const name = node.expression.name;
  return names.includes(name.text) ? name : undefined;
}

function readImports(ts, sf) {
  const declarations = [];
  const bindings = new Map();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const module = statement.moduleSpecifier.text;
    if (!(module in PACKAGES)) continue;
    declarations.push(statement);
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      bindings.set(element.name.text, {
        module,
        imported: (element.propertyName ?? element.name).text,
      });
    }
  }
  return { declarations, bindings };
}

// ---------------------------------------------------------------------------------------------
// Rules. Each `visit` sees every node of every app file once, in source order.
// ---------------------------------------------------------------------------------------------

/** R1 (part 1): module paths outside import declarations. Import declarations are R1 part 2, see finishImports. */
const R1 = {
  id: 'R1',
  title: 'module paths',
  visit(node, ctx) {
    const { ts } = ctx;
    let literal;
    if (ts.isExportDeclaration(node)) literal = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      literal = node.argument.literal;
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      literal = node.arguments[0];
    else if (ts.isImportDeclaration(node)) literal = node.moduleSpecifier;
    if (!literal || !ts.isStringLiteral(literal) || !literal.text.startsWith('@rx-signals/'))
      return;

    const target = PACKAGES[literal.text];
    if (!target) return manual(ctx, 'R1', literal, `deep import: use '${V4.storePackage}'`);
    if (ts.isImportDeclaration(node)) return; // finishImports owns these
    replace(ctx, 'R1', literal.getStart(ctx.sf), literal.getEnd(), quoted(ctx, literal, target));
    match(ctx, 'R1', literal, `'${literal.text}' -> '${target}'`);
  },
};

const quoted = (ctx, literal, value) => {
  const quote = text(ctx, literal)[0];
  return `${quote}${value}${quote}`;
};

/** R2: store.addNTypedEventSource(id1..idN, source, only?) -> store.addTypedEventSource([id1..idN], source, { onlyWhileSubscribed: only }?) */
const R2 = {
  id: 'R2',
  title: 'typed event sources',
  visit(node, ctx) {
    const methods = [2, 3, 4, 5, 6].map(n => `add${n}TypedEventSource`);
    const name = methodCall(ctx.ts, node, methods);
    if (!name || !isRc23Member(ctx, name, 'Store')) return;
    const n = Number(name.text[3]);
    const args = node.arguments;
    if (args.length < n + 1) return manual(ctx, 'R2', node, 'too few arguments');

    replace(ctx, 'R2', name.getStart(ctx.sf), name.getEnd(), V4.addTypedEventSource);
    const ids = args.slice(0, n).map(id => text(ctx, id));
    replace(ctx, 'R2', args[0].getStart(ctx.sf), args[n - 1].getEnd(), `[${ids.join(', ')}]`);
    const only = args[n + 1];
    if (only && only.kind === ctx.ts.SyntaxKind.NullKeyword) {
      replace(ctx, 'R2', args[n].getEnd(), only.getEnd(), ''); // null was the default
    } else if (only) {
      insert(ctx, 'R2', only.getStart(ctx.sf), `{ ${V4.onlyWhileSubscribedOption}: `);
      insert(ctx, 'R2', only.getEnd(), ' }');
    }
    match(ctx, 'R2', node, `${name.text}(...) -> ${V4.addTypedEventSource}([...], ...)`);
  },
};

/**
 * R3 and R4: the `keep` flag of SignalsFactory.connect / connectId / connectObservable /
 * useExistingEffect. `true` is dropped. `false` is dropped and the removal it implied is chained.
 */
function keepFlagRule(id, methods, removal, nameArgIndex) {
  return {
    id,
    title: `${methods[0]} keep flag`,
    visit(node, ctx) {
      const name = methodCall(ctx.ts, node, methods);
      if (!name || node.arguments.length !== 3 || !isRc23Member(ctx, name, 'SignalsFactory'))
        return;
      const [, second, flag] = node.arguments;
      const { TrueKeyword, FalseKeyword } = ctx.ts.SyntaxKind;
      if (flag.kind !== TrueKeyword && flag.kind !== FalseKeyword) {
        return manual(ctx, id, flag, `keep flag is not a literal: see ${id} in MIGRATION.md`);
      }
      replace(ctx, id, second.getEnd(), flag.getEnd(), ''); // `, true` or `, false`
      const chained = `.${removal}(${text(ctx, node.arguments[nameArgIndex])})`;
      if (flag.kind === FalseKeyword) insert(ctx, id, node.getEnd(), chained);
      const note = flag.kind === FalseKeyword ? `-> ${chained}` : 'dropped';
      match(ctx, id, flag, `${name.text}(..., ${text(ctx, flag)}) ${note}`);
    },
  };
}

const R3 = keepFlagRule('R3', ['connect', 'connectId', 'connectObservable'], V4.removeInputId, 1);
const R4 = keepFlagRule('R4', ['useExistingEffect'], V4.removeEffectId, 0);

/**
 * R5: rc23 typed the config of `a.compose(b)` as `{ c1: configA, c2: configB }` when both configs
 * have at least one key, and as `configA & configB` otherwise. v4 always shares one flat config
 * and nests only on request, so the nesting rc23 did implicitly becomes explicit. The decision
 * uses rc23's types of `a` and `b`, so inner composes are decided before the outer ones see them.
 */
const R5 = {
  id: 'R5',
  title: 'compose config nesting',
  visit(node, ctx) {
    const name = methodCall(ctx.ts, node, ['compose']);
    if (!name || node.arguments.length !== 1 || !isRc23Member(ctx, name, 'SignalsFactory')) return;
    const receiver = node.expression.expression;
    const argument = node.arguments[0];
    const left = configKeys(ctx, receiver);
    const right = configKeys(ctx, argument);
    if (left === undefined || right === undefined) {
      return manual(ctx, 'R5', node, 'generic config: see R5 in MIGRATION.md');
    }
    if (left === 0 || right === 0) return; // flat in rc23, flat in v4
    const [c1, c2] = V4.composeSlots.map(slot => `.${V4.nestConfig}('${slot}')`);
    insert(ctx, 'R5', receiver.getEnd(), c1);
    insert(ctx, 'R5', argument.getEnd(), c2);
    match(ctx, 'R5', name, `a.compose(b) -> a${c1}.compose(b${c2})`);
  },
};

/** Number of keys of the CONFIG type argument of an rc23 SignalsFactory expression; undefined when generic. */
function configKeys(ctx, expression) {
  const { ts, checker } = ctx;
  const type = checker.getTypeAtLocation(expression);
  if (!((type.objectFlags ?? 0) & ts.ObjectFlags.Reference)) return undefined;
  const config = checker.getTypeArguments(type)[2];
  if (!config || config.flags & ts.TypeFlags.Instantiable) return undefined;
  return checker.getPropertiesOfType(config).length;
}

/** R6: isStateId(id) -> id.kind === 'state' (and derived, event). isBehaviorId(id) -> (id.kind === 'state' || id.kind === 'derived'). */
const R6 = {
  id: 'R6',
  title: 'id kind checks',
  visit(node, ctx) {
    const { ts } = ctx;
    if (!ts.isCallExpression(node)) return;
    const binding = rc23Binding(ctx, node.expression);
    const fn = binding?.module === RC23.storePackage ? binding.imported : undefined;
    if (fn !== 'isBehaviorId' && !(fn in V4.idKinds)) return;
    const [id] = node.arguments;
    if (node.arguments.length !== 1 || !isSimpleReference(ts, id)) {
      return manual(ctx, 'R6', node, 'computed argument: see R6 in MIGRATION.md');
    }
    const kind = `${text(ctx, id)}.${V4.idKindProperty}`;
    const check =
      fn === 'isBehaviorId'
        ? `(${kind} === 'state' || ${kind} === 'derived')`
        : parenthesizeIfNeeded(ts, node, `${kind} === '${V4.idKinds[fn]}'`);
    replace(ctx, 'R6', node.getStart(ctx.sf), node.getEnd(), check);
    match(ctx, 'R6', node, `${text(ctx, node)} -> ${check}`);
  },
};

/** `a === b` can replace a call without parentheses only where nothing binds tighter than `===`. */
function parenthesizeIfNeeded(ts, node, expression) {
  const parent = node.parent;
  const safe =
    ts.isParenthesizedExpression(parent) ||
    ts.isExpressionStatement(parent) ||
    ts.isIfStatement(parent) ||
    ts.isWhileStatement(parent) ||
    ts.isReturnStatement(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    ts.isArrowFunction(parent) ||
    ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression !== node) ||
    (ts.isConditionalExpression(parent) && parent.condition === node) ||
    (ts.isBinaryExpression(parent) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.CommaToken,
      ].includes(parent.operatorToken.kind));
  return safe ? expression : `(${expression})`;
}

/** R7: store.addDerivedState(id, source, NO_VALUE) -> store.addDerivedState(id, source). */
const R7 = {
  id: 'R7',
  title: 'NO_VALUE argument',
  visit(node, ctx) {
    const name = methodCall(ctx.ts, node, ['addDerivedState']);
    if (!name || node.arguments.length !== 3) return;
    const [, source, initial] = node.arguments;
    const binding = rc23Binding(ctx, initial);
    if (binding?.imported !== 'NO_VALUE' || !isRc23Member(ctx, name, 'Store')) return;
    replace(ctx, 'R7', source.getEnd(), initial.getEnd(), '');
    match(ctx, 'R7', initial, 'NO_VALUE argument dropped');
  },
};

/** R8: store.isSubscribed(id) -> isSubscribed(store, id), same for the three source counters. */
const R8 = {
  id: 'R8',
  title: 'debug methods to the testing entry',
  visit(node, ctx) {
    const name = methodCall(ctx.ts, node, V4.testingFunctions);
    if (!name || !isRc23Member(ctx, name, 'Store')) return;
    const receiver = node.expression.expression;
    const separator = node.arguments.length > 0 ? ', ' : '';
    insert(ctx, 'R8', node.getStart(ctx.sf), `${name.text}(`);
    replace(ctx, 'R8', receiver.getEnd(), node.arguments.pos, separator); // `.isSubscribed(` -> `, `
    addImport(ctx, V4.storeTestingEntry, name.text);
    match(ctx, 'R8', node, `${name.text}(${text(ctx, receiver)}, ...)`);
  },
};

/** R9: setIdName statements go (ids carry their name), getIdName(id) and id.description become id.name. */
const R9 = {
  id: 'R9',
  title: 'id names',
  visit(node, ctx) {
    const { ts, sf } = ctx;
    const name = methodCall(ts, node, ['setIdName', 'getIdName']);
    if (name?.text === 'setIdName' && isRc23Member(ctx, name, 'Store')) {
      const statement = node.parent;
      if (!ts.isExpressionStatement(statement)) return manual(ctx, 'R9', node, 'delete it');
      const [start, end] = wholeLines(sf.text, statement.getStart(sf), statement.getEnd());
      replace(ctx, 'R9', start, end, '');
      return match(ctx, 'R9', node, 'setIdName(...) deleted');
    }
    if (name?.text === 'getIdName' && isRc23Member(ctx, name, 'Store')) {
      const [id] = node.arguments;
      if (!isSimpleReference(ts, id)) return manual(ctx, 'R9', node, 'computed argument');
      const read = `${text(ctx, id)}.${V4.idNameProperty}`;
      replace(ctx, 'R9', node.getStart(sf), node.getEnd(), read);
      return match(ctx, 'R9', node, `getIdName(...) -> ${read}`);
    }
    // id.description, where `id` has an rc23 id type (a symbol with an rc23 brand)
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'description' &&
      isRc23IdType(ctx, node.expression)
    ) {
      replace(ctx, 'R9', node.name.getStart(ctx.sf), node.name.getEnd(), V4.idNameProperty);
      match(ctx, 'R9', node, `${text(ctx, node)} -> .${V4.idNameProperty}`);
    }
  },
};

const RC23_ID_BRANDS = ['_rootStateType', '_derivedStateType', '_eventType', '_inputType'];

function isRc23IdType(ctx, expression) {
  const type = ctx.checker.getTypeAtLocation(expression);
  const members = type.isUnion() ? type.types : [type];
  return members.every(member => RC23_ID_BRANDS.some(brand => member.getProperty(brand)));
}

/**
 * R10: type names. AddSignalId -> AddId and the other renames in V4.typeRenames,
 * Configuration -> object, ToSignalId<X> -> SignalId<ToSignalIdValueType<X>>.
 * The import specifiers are renamed in finishImports.
 */
const R10 = {
  id: 'R10',
  title: 'type renames',
  visit(node, ctx) {
    const { ts } = ctx;
    if (!ts.isTypeReferenceNode(node)) return;
    const binding = rc23Binding(ctx, node.typeName);
    if (!binding) return;
    const { imported } = binding;
    const local = node.typeName;
    const aliased = local.text !== imported; // `import { AddSignalId as X }`: only the specifier changes
    if (V4.typeRenames[imported] && !aliased) {
      replace(ctx, 'R10', local.getStart(ctx.sf), local.getEnd(), V4.typeRenames[imported]);
      match(ctx, 'R10', node, `${imported} -> ${V4.typeRenames[imported]}`);
    } else if (imported === 'Configuration') {
      replace(ctx, 'R10', node.getStart(ctx.sf), node.getEnd(), V4.configurationType);
      match(ctx, 'R10', node, `Configuration -> ${V4.configurationType}`);
    } else if (imported === 'ToSignalId' && node.typeArguments?.length === 1) {
      const [argument] = node.typeArguments;
      replace(ctx, 'R10', local.getStart(ctx.sf), local.getEnd(), V4.signalIdType);
      insert(ctx, 'R10', argument.getStart(ctx.sf), `${V4.signalIdValueType}<`);
      insert(ctx, 'R10', argument.getEnd(), '>');
      addImport(ctx, V4.storePackage, V4.signalIdType);
      addImport(ctx, V4.storePackage, V4.signalIdValueType);
      match(ctx, 'R10', node, `ToSignalId<X> -> ${V4.signalIdType}<${V4.signalIdValueType}<X>>`);
    }
  },
};

/**
 * R11: RxSignalsStoreModule in the `imports` of an @NgModule or TestBed.configureTestingModule
 * moves to `providers`:
 *   RxSignalsStoreModule.withRootStore(a, b) -> provideRootStore(a, b)
 *   RxSignalsStoreModule.withChildStore(a)   -> provideChildStore(a)
 *   RxSignalsStoreModule                     -> provideRootStore()
 * Anywhere else (a standalone @Component, a variable) it is reported for a hand edit.
 */
const R11 = {
  id: 'R11',
  title: 'Angular module to providers',
  visit(node, ctx) {
    const { ts } = ctx;
    if (!ts.isObjectLiteralExpression(node)) return;
    const importsProperty = findProperty(ts, node, 'imports');
    if (!importsProperty || !ts.isArrayLiteralExpression(importsProperty.initializer)) return;
    const elements = importsProperty.initializer.elements;

    const moved = []; // { index, element, provide, call }
    elements.forEach((element, index) => {
      const provider = storeModuleProvider(ctx, element);
      if (provider) moved.push({ index, element, ...provider });
    });
    if (moved.length === 0) return;
    if (!isModuleMetadata(ts, node)) {
      for (const { element } of moved) manual(ctx, 'R11', element, 'not in an @NgModule: see R11');
      return;
    }

    removeElements(
      ctx,
      elements,
      moved.map(m => m.index),
    );
    addProviders(
      ctx,
      node,
      importsProperty,
      moved.map(m => m.call),
    );
    for (const { element, provide } of moved) {
      addImport(ctx, V4.angularPackage, provide);
      match(
        ctx,
        'R11',
        element,
        `imports: [RxSignalsStoreModule...] -> providers: [${provide}(...)]`,
      );
    }
  },
};

function findProperty(ts, objectLiteral, name) {
  return objectLiteral.properties.find(
    p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name,
  );
}

/** For an `imports` element that is RxSignalsStoreModule: { provide, call } of its v4 provider. */
function storeModuleProvider(ctx, element) {
  const isModule = node => rc23Binding(ctx, node)?.imported === 'RxSignalsStoreModule';
  if (isModule(element)) return { provide: V4.provideRootStore, call: `${V4.provideRootStore}()` };
  const name = methodCall(ctx.ts, element, ['withRootStore', 'withChildStore']);
  if (!name || !isModule(element.expression.expression)) return undefined;
  const provide = name.text === 'withRootStore' ? V4.provideRootStore : V4.provideChildStore;
  return { provide, call: `${provide}(${element.arguments.map(a => text(ctx, a)).join(', ')})` };
}

/** `{ imports }` passed to @NgModule(...) or TestBed.configureTestingModule(...). */
function isModuleMetadata(ts, objectLiteral) {
  const call = objectLiteral.parent;
  if (!ts.isCallExpression(call)) return false;
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'NgModule' && ts.isDecorator(call.parent);
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'configureTestingModule';
}

/** Length of the `,` (and whitespace before it) right after `pos`, or 0. */
const commaAfter = (source, pos) => /^\s*,/.exec(source.slice(pos))?.[0].length ?? 0;

/** Deletes elements of an array literal with their commas, one edit per run of neighbours. */
function removeElements(ctx, elements, indices) {
  const runs = [];
  for (const index of indices) {
    const last = runs.at(-1);
    if (last && last.to === index - 1) last.to = index;
    else runs.push({ from: index, to: index });
  }
  for (const { from, to } of runs) {
    const [first, last] = [elements[from], elements[to]];
    const next = elements[to + 1];
    const previous = elements[from - 1];
    // `a, X, b` -> `a, b`; `a, X` -> `a`; `X,` -> ``
    if (next) replace(ctx, 'R11', first.getStart(ctx.sf), next.getStart(ctx.sf), '');
    else if (previous) replace(ctx, 'R11', previous.getEnd(), last.getEnd(), '');
    else
      replace(
        ctx,
        'R11',
        first.getStart(ctx.sf),
        last.getEnd() + commaAfter(ctx.sf.text, last.getEnd()),
        '',
      );
  }
}

/** Appends provider calls to the literal's `providers` array, creating the property after `imports` if missing. */
function addProviders(ctx, objectLiteral, importsProperty, calls) {
  const { ts, sf } = ctx;
  const source = sf.text;
  const list = calls.join(', ');
  const property = findProperty(ts, objectLiteral, 'providers');
  if (property && !ts.isArrayLiteralExpression(property.initializer)) {
    return manual(ctx, 'R11', property, `providers is not an array literal: add ${list}`);
  }
  // No providers yet: add `providers: [...]` after `imports`, on its own line if `imports` has one.
  if (!property) {
    const ownLine = source
      .slice(objectLiteral.getStart(sf), importsProperty.getStart(sf))
      .includes('\n');
    const separator = ownLine ? `\n${indentAt(source, importsProperty.getStart(sf))}` : ' ';
    const comma = commaAfter(source, importsProperty.getEnd());
    const entry = `providers: [${list}]`;
    if (comma) return insert(ctx, 'R11', importsProperty.getEnd() + comma, `${separator}${entry},`);
    return insert(ctx, 'R11', importsProperty.getEnd(), `,${separator}${entry}`);
  }
  // Existing array: append after the last element, one per line if the array is one per line.
  const array = property.initializer;
  const last = array.elements.at(-1);
  if (!last) return replace(ctx, 'R11', array.getStart(sf), array.getEnd(), `[${list}]`);
  const ownLines = source.slice(array.getStart(sf), array.elements[0].getStart(sf)).includes('\n');
  if (!ownLines) return insert(ctx, 'R11', last.getEnd(), `, ${list}`);
  const items = calls.map(call => `\n${indentAt(source, last.getStart(sf))}${call}`).join(',');
  const comma = commaAfter(source, last.getEnd());
  if (comma) return insert(ctx, 'R11', last.getEnd() + comma, `${items},`);
  return insert(ctx, 'R11', last.getEnd(), `,${items}`);
}

const RULES = [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11];

const RULE_TITLES = Object.fromEntries([
  ...RULES.map(r => [r.id, r.title]),
  ['R12', 'package.json dependencies'],
]);

// ---------------------------------------------------------------------------------------------
// R1 (part 2): import declarations. Runs after the rules, because it needs to know which
// specifiers the rules made unused (dropped) or newly needed (added).
// ---------------------------------------------------------------------------------------------
function finishImports(ctx) {
  const { ts, sf } = ctx;
  const leftovers = removedExportLeftovers(ctx);

  for (const declaration of ctx.imports.declarations) {
    const literal = declaration.moduleSpecifier;
    const module = PACKAGES[literal.text];
    match(ctx, 'R1', literal, `'${literal.text}' -> '${module}'`);
    const movePath = () =>
      replace(ctx, 'R1', literal.getStart(sf), literal.getEnd(), quoted(ctx, literal, module));

    const named = declaration.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) {
      movePath();
      continue;
    }
    const specifiers = [];
    for (const element of named.elements) {
      const imported = (element.propertyName ?? element.name).text;
      const local = element.name.text;
      if (REMOVED_EXPORTS.has(imported) && !leftovers.has(local)) continue;
      const renamed = V4.typeRenames[imported] ?? imported;
      specifiers.push({
        typeOnly: element.isTypeOnly,
        imported: renamed,
        local: element.propertyName ? local : renamed,
      });
    }
    for (const name of ctx.addedImports.get(module) ?? [])
      specifiers.push({ typeOnly: false, imported: name, local: name });
    ctx.addedImports.delete(module); // added once, to the first declaration of the module
    const unique = [...new Map(specifiers.map(s => [s.local, s])).values()];

    if (unique.length === 0 && !declaration.importClause.name) {
      const [start, end] = wholeLines(sf.text, declaration.getStart(sf), declaration.getEnd());
      replace(ctx, 'R1', start, end, ''); // nothing left to import
      continue;
    }
    movePath();
    const before = named.elements.map(e => e.getText(sf)).join(',');
    const after = unique.map(formatSpecifier).join(',');
    if (before !== after) {
      replace(
        ctx,
        'R1',
        named.getStart(sf),
        named.getEnd(),
        formatNamedImports(ctx, declaration, named, unique),
      );
    }
  }

  // Modules the file did not import from yet (the testing entry, usually): one new declaration
  // each, on the line after the last import.
  const lastImport = sf.statements.filter(s => ts.isImportDeclaration(s)).at(-1);
  if (ctx.addedImports.size === 0) return;
  const quote = ctx.imports.declarations[0]
    ? text(ctx, ctx.imports.declarations[0].moduleSpecifier)[0]
    : "'";
  const lines = [...ctx.addedImports].map(
    ([module, names]) =>
      `import { ${[...names].sort().join(', ')} } from ${quote}${module}${quote};\n`,
  );
  const [, pos] = lastImport
    ? wholeLines(sf.text, lastImport.getStart(sf), lastImport.getEnd())
    : [0, 0];
  const needsNewline = pos > 0 && sf.text[pos - 1] !== '\n';
  insert(ctx, 'R1', pos, `${needsNewline ? '\n' : ''}${lines.join('')}`);
}

const formatSpecifier = s =>
  `${s.typeOnly ? 'type ' : ''}${s.imported === s.local ? s.local : `${s.imported} as ${s.local}`}`;

/** Re-prints `{ ... }` in the style of the original: one line, or one specifier per line. Keeps an alphabetical list alphabetical. */
function formatNamedImports(ctx, declaration, named, specifiers) {
  const original = named.elements.map(e => e.name.text);
  const byName = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());
  const wasSorted = original.every((name, i) => i === 0 || byName(original[i - 1], name) <= 0);
  const ordered = wasSorted ? [...specifiers].sort((a, b) => byName(a.local, b.local)) : specifiers;
  const items = ordered.map(formatSpecifier);
  if (!named.getText(ctx.sf).includes('\n')) return `{ ${items.join(', ')} }`;
  const indent = indentAt(ctx.sf.text, named.elements[0].getStart(ctx.sf));
  const closing = indentAt(ctx.sf.text, declaration.getStart(ctx.sf));
  const trailing = named.elements.hasTrailingComma ? ',' : '';
  return `{\n${items.map(i => indent + i).join(',\n')}${trailing}\n${closing}}`;
}

/**
 * Local names of REMOVED_EXPORTS that are still used somewhere no edit covers. Their specifier stays
 * (the compiler will point at each use), and each use is reported for a hand edit.
 */
function removedExportLeftovers(ctx) {
  const { ts, sf } = ctx;
  const leftovers = new Set();
  const covered = node =>
    ctx.edits.some(e => e.end > e.start && e.start <= node.getStart(sf) && node.getEnd() <= e.end);
  const visit = node => {
    if (ts.isImportDeclaration(node)) return;
    if (
      ts.isIdentifier(node) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      const binding = ctx.imports.bindings.get(node.text);
      if (binding && REMOVED_EXPORTS.has(binding.imported) && !covered(node)) {
        leftovers.add(node.text);
        manual(
          ctx,
          'R1',
          node,
          `${binding.imported} is not exported by v4: see "Removed exports" in MIGRATION.md`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return leftovers;
}

// ---------------------------------------------------------------------------------------------
// Applying edits
// ---------------------------------------------------------------------------------------------

/**
 * Applies edits back to front. At one position, insertions come before a replacement that starts
 * there, and lower rule numbers come first, so `.connect(a, b).removeInputId(b)` (R3) precedes
 * `.nestConfig('c1')` (R5). Throws on overlapping edits: two rules touched the same text.
 */
export function applyEdits(file, source, edits) {
  const ordered = [...edits].sort(
    (a, b) =>
      a.start - b.start ||
      (a.end > a.start) - (b.end > b.start) ||
      ruleNumber(a.rule) - ruleNumber(b.rule) ||
      a.seq - b.seq,
  );
  let reached = { end: 0, rule: '' }; // the edit that reaches furthest so far
  for (const edit of ordered) {
    if (edit.start < reached.end) {
      throw new Error(
        `${file}: ${reached.rule} and ${edit.rule} edit the same text at offset ${edit.start}. Report this; the file is unchanged.`,
      );
    }
    if (edit.end >= reached.end) reached = edit;
  }
  let output = source;
  for (const edit of ordered.reverse())
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}

// ---------------------------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------------------------

function loadTypeScript(appDir) {
  const require = createRequire(join(appDir, 'package.json'));
  try {
    return require('typescript');
  } catch {
    throw new Error(`no typescript in ${appDir}/node_modules. Run npm ci in the app first.`);
  }
}

function defaultProjects(appDir) {
  const split = ['tsconfig.app.json', 'tsconfig.spec.json'].filter(f =>
    existsSync(join(appDir, f)),
  );
  return split.length > 0 ? split : ['tsconfig.json'];
}

function createPrograms(ts, appDir, projects) {
  return projects.map(project => {
    const configPath = resolve(appDir, project);
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      dirname(configPath),
      undefined,
      configPath,
    );
    return ts.createProgram({
      rootNames: parsed.fileNames,
      options: { ...parsed.options, noEmit: true },
    });
  });
}

/** App source files of every program, each once, paired with the checker of the first program that has it. */
function appSourceFiles(programs, appDir) {
  const seen = new Map();
  for (const program of programs) {
    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile || !isAppFile(appDir, sf.fileName) || seen.has(sf.fileName))
        continue;
      seen.set(sf.fileName, { sf, checker: program.getTypeChecker() });
    }
  }
  return [...seen.values()];
}

const isAppFile = (appDir, fileName) =>
  !relative(appDir, fileName).startsWith('..') && !/[\\/]node_modules[\\/]/.test(fileName);

// ---------------------------------------------------------------------------------------------
// R12: package.json
// ---------------------------------------------------------------------------------------------

/** Swaps each rc23 dependency for its v4 package at `version`, in place. Returns the new text or undefined. */
function migratePackageJson(source, version) {
  const pkg = JSON.parse(source);
  let changed = false;
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[section];
    if (!deps || !Object.keys(deps).some(name => name in PACKAGES)) continue;
    pkg[section] = Object.fromEntries(
      Object.entries(deps).map(([name, range]) =>
        name in PACKAGES ? [PACKAGES[name], version] : [name, range],
      ),
    );
    changed = true;
  }
  if (!changed) return undefined;
  const indent = /^[ \t]+/m.exec(source)?.[0] ?? '  ';
  return `${JSON.stringify(pkg, null, indent)}${source.endsWith('\n') ? '\n' : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Migrate
// ---------------------------------------------------------------------------------------------

/**
 * Plans (and unless `dry`, writes) the migration of the app in `appDir`.
 * Returns { files: [{ file, path, after }], matches, manual, packageJson: { before, after } | undefined }.
 */
export function migrate({
  appDir,
  projects = defaultProjects(appDir),
  version = V4.defaultVersion,
  dry = false,
}) {
  const packagePath = join(appDir, 'package.json');
  const packageSource = readFileSync(packagePath, 'utf8');
  // The typed rules read rc23's declarations. Without them they would silently match nothing.
  const rc23Installed = existsSync(join(appDir, 'node_modules', RC23.storePackage, 'package.json'));
  if (packageSource.includes(`"${RC23.storePackage}"`) && !rc23Installed) {
    throw new Error(`${RC23.storePackage} is not installed. Run npm ci in the app first.`);
  }

  const ts = loadTypeScript(appDir);
  const programs = createPrograms(ts, appDir, projects);
  const files = [];
  const matches = [];
  const manualSites = [];

  for (const { sf, checker } of appSourceFiles(programs, appDir)) {
    const ctx = createFileContext(ts, checker, sf, appDir);
    const visit = node => {
      for (const rule of RULES) rule.visit(node, ctx);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (ctx.imports.declarations.length > 0 || ctx.addedImports.size > 0) finishImports(ctx);
    matches.push(...ctx.matches);
    manualSites.push(...ctx.manual);
    if (ctx.edits.length === 0) continue;
    const after = applyEdits(ctx.file, sf.text, ctx.edits);
    if (after !== sf.text) files.push({ file: ctx.file, path: sf.fileName, after });
  }

  const packageAfter = migratePackageJson(packageSource, version);
  const packageJson =
    packageAfter === undefined ? undefined : { before: packageSource, after: packageAfter };

  if (!dry) {
    for (const f of files) writeFileSync(f.path, f.after);
    if (packageJson) writeFileSync(packagePath, packageJson.after);
  }
  return { files, matches, manual: manualSites, packageJson };
}

function printMigration(result, { dry }) {
  const byRule = new Map();
  for (const m of result.matches) byRule.set(m.rule, [...(byRule.get(m.rule) ?? []), m]);
  const verb = dry ? 'would change' : 'changed';

  if (dry) {
    for (const [rule, list] of [...byRule].sort((a, b) => ruleNumber(a[0]) - ruleNumber(b[0]))) {
      console.log(`\n${rule} ${RULE_TITLES[rule]}`);
      const sorted = [...list].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
      for (const m of sorted) console.log(`  ${m.file}:${m.line}  ${m.note}`);
    }
    if (result.packageJson)
      console.log(
        `\nR12 ${RULE_TITLES.R12}\n  package.json  ${Object.keys(PACKAGES).join(', ')} -> ${Object.values(PACKAGES).join(', ')}`,
      );
  }

  console.log(
    `\nSummary: ${result.files.length} files ${verb}${result.packageJson ? ', plus package.json' : ''}.`,
  );
  for (const [rule, list] of [...byRule].sort((a, b) => ruleNumber(a[0]) - ruleNumber(b[0]))) {
    const fileCount = new Set(list.map(m => m.file)).size;
    console.log(
      `  ${rule.padEnd(4)} ${RULE_TITLES[rule].padEnd(36)} ${String(list.length).padStart(4)} sites in ${fileCount} files`,
    );
  }
  if (result.packageJson) console.log(`  R12  ${RULE_TITLES.R12}`);

  if (result.manual.length > 0) {
    console.log(
      `\nHand edits (${result.manual.length} sites in ${new Set(result.manual.map(m => m.file)).size} files):`,
    );
    for (const m of result.manual) console.log(`  ${m.file}:${m.line}  [${m.rule}] ${m.note}`);
  }
  if (result.files.length === 0 && !result.packageJson) console.log('Nothing to change.');
  else if (!dry) console.log('\nNext: npm install, then run this script again with --check.');
}

// ---------------------------------------------------------------------------------------------
// --check: compile errors left after the migration, grouped under their MIGRATION.md entry.
// The ids (C1, C2, ...) are the headings in MIGRATION.md. First matching entry wins.
// ---------------------------------------------------------------------------------------------
const ID_TYPE = /(?:State|Derived|Event|Effect|Behavior|Signal)Id</;
const ASSIGNABILITY = [2322, 2345, 2769]; // not assignable to type / parameter, no overload matches

/** { id, title, test(code, message) }. Order matters: C2 and C3 are narrower than C4. */
const CHECKS = [
  ['C0', 'v4 packages not installed', (c, m) => c === 2307 && m.includes('@rx-signals-next/')],
  ['C1', 'removed export', (c, m) => (c === 2305 || c === 2724) && m.includes('@rx-signals')],
  ['C2', 'id used as a symbol', (_c, m) => m.includes("'symbol'") && ID_TYPE.test(m)],
  ['C3', 'event source handle is not a symbol', (_c, m) => m.includes("'EventSourceHandle'")],
  [
    'C4',
    'id value types must match exactly',
    (c, m) => ASSIGNABILITY.includes(c) && ID_TYPE.test(m),
  ],
  // `error.message` gives 18046; `error?.message` narrows unknown to {} first and gives 2339.
  [
    'C5',
    'effect error is unknown',
    (c, m) => c === 18046 || (c === 2339 && /type '(unknown|\{\})'/.test(m)),
  ],
  [
    'C6',
    'keep flag that is not a literal',
    (c, m) => c === 2554 && m.includes('Expected 2 arguments, but got 3'),
  ],
  [
    'C7',
    'compose config shape',
    (c, m) => [2353, 2741, 2322].includes(c) && /'c[12]'|\bc[12]\b/.test(m),
  ],
  ['C8', 'function-valued state', (_c, m) => m.includes("parameter of type '() =>")],
  ['C9', 'removed method', (c, m) => c === 2339 && /on type '(Store|SignalsFactory<)/.test(m)],
].map(([id, title, test]) => ({ id, title, test }));

export const classifyDiagnostic = (code, message) =>
  CHECKS.find(c => c.test(code, message))?.id ?? 'C?';

export function check({ appDir, projects = defaultProjects(appDir) }) {
  const ts = loadTypeScript(appDir);
  const seen = new Set();
  const errors = [];
  for (const program of createPrograms(ts, appDir, projects)) {
    for (const d of ts.getPreEmitDiagnostics(program)) {
      const isError = d.category === ts.DiagnosticCategory.Error;
      if (!isError || !d.file || !isAppFile(appDir, d.file.fileName)) continue;
      const file = relative(appDir, d.file.fileName);
      const line = d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1;
      const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      const key = `${file}:${d.start}:${d.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push({
        file,
        line,
        code: d.code,
        message,
        entry: classifyDiagnostic(d.code, message),
      });
    }
  }
  return errors;
}

function printCheck(errors) {
  if (errors.length === 0) {
    console.log('No compile errors. Run `ng build` too: templates are only checked there.');
    return;
  }
  const titles = Object.fromEntries([
    ...CHECKS.map(c => [c.id, c.title]),
    ['C?', 'not a known migration error'],
  ]);
  const entries = [...new Set(errors.map(e => e.entry))].sort();
  for (const entry of entries) {
    console.log(`\n${entry} ${titles[entry]} (MIGRATION.md, section ${entry})`);
    for (const e of errors.filter(x => x.entry === entry))
      console.log(`  ${e.file}:${e.line}  TS${e.code} ${e.message}`);
  }
  const files = new Set(errors.map(e => e.file));
  console.log(`\n${errors.length} errors in ${files.size} files.`);
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dry: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      version: { type: 'string', default: V4.defaultVersion },
      project: { type: 'string', multiple: true },
    },
  });
  const appDir = resolve(positionals[0] ?? '.');
  const projects = values.project ?? defaultProjects(appDir);
  if (values.check) {
    const errors = check({ appDir, projects });
    printCheck(errors);
    process.exitCode = errors.length === 0 ? 0 : 1;
    return;
  }
  printMigration(migrate({ appDir, projects, version: values.version, dry: values.dry }), {
    dry: values.dry,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`migrate-rx-signals: ${error.message}`);
    process.exitCode = 2;
  }
}
