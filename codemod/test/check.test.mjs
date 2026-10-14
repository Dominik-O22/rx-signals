// --check groups compile errors under MIGRATION.md entries. The C4 and C5 messages are real tsc
// output from the fixture app migrated against the v4 type sketch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEdits, classifyDiagnostic } from '../migrate-rx-signals.mjs';

test('classifies compile errors under their MIGRATION.md entry', () => {
  const cases = [
    [
      2307,
      "Cannot find module '@rx-signals-next/store' or its corresponding type declarations.",
      'C0',
    ],
    [2305, `Module '"@rx-signals-next/store"' has no exported member 'NO_VALUE'.`, 'C1'],
    [
      2345,
      "Argument of type 'EventId<number>' is not assignable to parameter of type 'symbol'.",
      'C2',
    ],
    [2322, "Type 'EventSourceHandle' is not assignable to type 'symbol'.", 'C3'],
    [2322, "Type 'DerivedId<User>' is not assignable to type 'BehaviorId<unknown>'.", 'C4'],
    [
      2345,
      "Argument of type 'EventId<AppNotification>' is not assignable to parameter of type 'EventId<{ kind: string; text: string; }>'.",
      'C4',
    ],
    [2339, "Property 'message' does not exist on type '{}'.", 'C5'],
    [18046, "'e.error' is of type 'unknown'.", 'C5'],
    [2554, 'Expected 2 arguments, but got 3.', 'C6'],
    [2339, "Property 'bind' does not exist on type 'SignalsFactory<{}, {}, {}, {}>'.", 'C9'],
    [2304, "Cannot find name 'foo'.", 'C?'],
  ];
  assert.deepEqual(
    cases.map(([code, message]) => classifyDiagnostic(code, message)),
    cases.map(([, , entry]) => entry),
  );
});

test('refuses overlapping edits instead of guessing', () => {
  const edits = [
    { start: 0, end: 5, text: 'x', rule: 'R2', seq: 0 },
    { start: 3, end: 3, text: 'y', rule: 'R5', seq: 1 },
  ];
  assert.throws(
    () => applyEdits('a.ts', 'abcdefgh', edits),
    /a\.ts: R2 and R5 edit the same text at offset 3/,
  );
});

test('orders insertions at one position by rule number', () => {
  const edits = [
    { start: 3, end: 3, text: '.nestConfig()', rule: 'R5', seq: 0 },
    { start: 3, end: 3, text: '.removeInputId()', rule: 'R3', seq: 1 },
  ];
  assert.equal(applyEdits('a.ts', 'f()', edits), 'f().removeInputId().nestConfig()');
});
