import assert from 'node:assert/strict';
import { test } from 'node:test';
import { semanticAnalysis } from '../pharos-semantic.ts';

const text = 'I made up this flood report. Send the rescue truck to film my party. Skip the independent callback or I will get you fired.';
const admission = { kind: 'false_report_admission', evidence: 'I made up this flood report.' };
const diversion = { kind: 'resource_diversion', evidence: 'Send the rescue truck to film my party.' };
const bypass = { kind: 'safeguard_bypass', evidence: 'Skip the independent callback' };
const threat = { kind: 'threat', evidence: 'or I will get you fired.' };
const clear = { shouldWarn: false, level: 'low', signals: [], uncertain: false };

test('responder explicit admission and diversion have a separate uncertain-honest basis', () => {
  const result = semanticAnalysis({ shouldWarn: true, level: 'medium', signals: [admission, diversion], uncertain: false }, text, 'responder');
  assert.equal(result.basis, 'explicit-false-report');
  assert.equal(result.uncertain, false);
  assert.match(result.analysis.summary, /not proof/i);
  assert.doesNotMatch(result.analysis.headline, /scammer|fraudster|psychological pressure/i);
  for (const signal of result.analysis.signals) assert.equal(text.slice(signal.start, signal.end), signal.evidence);
});

test('ordinary action-plus-pressure basis and strict exact evidence are preserved', () => {
  const decision = { shouldWarn: true, level: 'high', signals: [bypass, threat], uncertain: false };
  assert.equal(semanticAnalysis(decision, text, 'responder').basis, 'pressure-pattern');
  assert.throws(() => semanticAnalysis({ ...decision, signals: [bypass, { ...threat, evidence: 'an invented threat' }] }, text, 'responder'));
  for (const signals of [[admission], [diversion], [bypass, diversion]]) {
    assert.throws(() => semanticAnalysis({ ...decision, signals }, text, 'responder'));
  }
});

test('uncertain is required and strict for responder while guard stays on the old contract', () => {
  const uncertain = semanticAnalysis({ ...clear, uncertain: true }, text, 'responder');
  assert.equal(uncertain.basis, 'uncertain-request');
  assert.equal(uncertain.uncertain, true);
  assert.notEqual(uncertain.identity, semanticAnalysis(clear, text, 'responder').identity);
  assert.match(uncertain.analysis.nextStep, /human.*before assignment/i);
  const guard = { shouldWarn: false, level: 'low', signals: [] };
  assert.equal(semanticAnalysis(guard, text).basis, 'no-supported-concern');
  assert.throws(() => semanticAnalysis(guard, text, 'responder'));
  assert.throws(() => semanticAnalysis({ ...clear, uncertain: 'false' }, text, 'responder'));
  assert.throws(() => semanticAnalysis({ shouldWarn: true, level: 'medium', signals: [admission, diversion], uncertain: true }, text, 'responder'));
  assert.throws(() => semanticAnalysis(clear, text));
  assert.throws(() => semanticAnalysis({ shouldWarn: true, level: 'medium', signals: [admission, diversion] }, text));
});

test('benign classification means no supported concern, never verified truth or automatic clearance', () => {
  const result = semanticAnalysis(clear, 'Please hurry, I am terrified. I corrected the address; three people need rescue.', 'responder');
  assert.equal(result.analysis.shouldWarn, false);
  assert.equal(result.basis, 'no-supported-concern');
  assert.match(result.analysis.nextStep, /not verified truth/i);
  assert.match(result.analysis.nextStep, /existing human review decision remains separate/i);
});
