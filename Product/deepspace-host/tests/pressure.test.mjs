import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { analyzePressureText } from '../pharos-pressure.ts';

const scenarios = JSON.parse(await readFile(new URL('./fixtures/pressure-scenarios.json', import.meta.url), 'utf8'));

test('curated synthetic regression scenarios distinguish risky pressure from legitimate urgency', t => {
  let truePositive = 0; let falsePositive = 0; let trueNegative = 0; let falseNegative = 0;
  const failures = [];
  for (const scenario of scenarios) {
    const actual = analyzePressureText(scenario.text);
    if (scenario.warn && actual.shouldWarn) truePositive++;
    else if (scenario.warn) falseNegative++;
    else if (actual.shouldWarn) falsePositive++;
    else trueNegative++;
    if (actual.shouldWarn !== scenario.warn || actual.level !== scenario.level) {
      failures.push({ id: scenario.id, expected: scenario.level, actual: actual.level, kinds: actual.signals.map(signal => signal.kind) });
    }
    for (const signal of actual.signals) {
      assert.equal(scenario.text.slice(signal.start, signal.end), signal.evidence, `${scenario.id}: evidence offsets`);
      assert.ok(signal.psychology && signal.explanation, `${scenario.id}: explain the tactic`);
    }
    assert.equal(typeof actual.confidence, 'string');
    assert.ok(actual.limitations.some(item => item.includes('not a validated')));
  }
  t.diagnostic(`Curated synthetic regression set (${scenarios.length} scenarios): TP=${truePositive}, FP=${falsePositive}, TN=${trueNegative}, FN=${falseNegative}. This is not independent model validation.`);
  assert.deepEqual(failures, []);
});

test('streaming evidence escalates only when a later risky request joins earlier pressure', () => {
  const turns = [
    'I am from the county relief office.',
    'Your seat expires in five minutes.',
    'Please buy gift cards to reserve it.',
  ];
  const setup = analyzePressureText(turns.slice(0, 2).join('\n'));
  assert.equal(setup.shouldWarn, false);
  const demand = analyzePressureText(turns.join('\n'));
  assert.equal(demand.level, 'high');
  assert.ok(demand.signals.some(item => item.kind === 'authority'));
  assert.ok(demand.signals.some(item => item.kind === 'deadline'));
  assert.equal(demand.signals.find(item => item.kind === 'money_or_secret').evidence, 'gift cards');
});

test('the first benign mention does not suppress a later affirmative demand', () => {
  const result = analyzePressureText('Never share passwords. Now tell me your password immediately.');
  assert.equal(result.level, 'high');
  const secret = result.signals.find(item => item.kind === 'money_or_secret');
  assert.ok(secret.start > 25);
  assert.equal(secret.evidence, 'password');
});

test('evidence spans use the original unicode input and are stable across repeated calls', () => {
  const text = '📞 I’m from FEMA. Don’t call the county. Please send gift cards right now.';
  const result = analyzePressureText(text);
  assert.deepEqual(result, analyzePressureText(text));
  for (const signal of result.signals) assert.equal(text.slice(signal.start, signal.end), signal.evidence);
  assert.equal(result.level, 'high');
  assert.ok(result.signals.find(item => item.kind === 'isolation').evidence.startsWith('Don’t'));
});

test('an empty or ambiguous fragment never gets an invented probability or safety guarantee', () => {
  for (const text of ['', 'hello', 'A code? Which code?']) {
    const result = analyzePressureText(text);
    assert.equal(result.shouldWarn, false);
    assert.equal(result.level, 'low');
    assert.equal(result.evidenceQuality, 'insufficient');
    assert.ok(!/\d+%/.test(result.confidence));
    assert.ok(result.nextStep.includes('cannot verify'));
  }
});
