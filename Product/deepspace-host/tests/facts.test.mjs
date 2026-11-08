import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveCallFacts } from '../pharos-facts.ts';

const caller = text => ({role:'caller',text,at:'2026-11-08T04:00:00Z'});
const agent = text => ({role:'agent',text,at:'2026-11-08T04:00:00Z'});

function facts(...turns) { return deriveCallFacts(turns); }

test('only caller speech supplies hazard and need evidence', () => {
  const result = facts(agent('Are you trapped or unable to breathe? Do you need oxygen or drinking water?'),caller('I am not sure.'),agent('What address or landmark should we use?'),caller('I do not know.'));
  assert.equal(result.immediateDanger,'unknown');
  assert.equal(result.immediateEvidence,null);
  assert.equal(result.locationText,'');
  assert.deepEqual(result.needs,[]);
});

test('a consent yes is not mistaken for an answer to immediate danger', () => {
  const result = facts(agent('Do you consent to saving the transcript?'),caller('Yes.'),agent('Where are you?'),caller('Zone 2.'));
  assert.equal(result.immediateDanger,'unknown');
  assert.equal(result.locationText,'Zone 2.');
});

test('negative hazard/medical wording does not become positive evidence', () => {
  const result = facts(agent('Are you in immediate danger right now?'),caller('No. We are not trapped, and there is no water inside. We do not need oxygen. We need drinking water.'));
  assert.equal(result.immediateDanger,'no');
  assert.equal(result.immediateEvidence,null);
  assert.deepEqual(result.needs,['supplies']);
});

test('negating one hazard does not establish overall safety', () => {
  const result = facts(caller('I am not trapped. There is no water inside.'));
  assert.equal(result.immediateDanger,'unknown');
  assert.deepEqual(result.needs,[]);
});

test('curly apostrophes and explicit inability to breathe remain caller evidence', () => {
  const result = facts(caller('My father can’t breathe. We need medical supplies.'));
  assert.equal(result.immediateDanger,'yes');
  assert.equal(result.immediateEvidence,"can’t breathe");
  assert.deepEqual(result.needs,['medical']);
});

test('water inside and floodwater do not imply a drinking-water supply request', () => {
  const result = facts(caller('Water is rising inside our house. We cannot get out.'));
  assert.equal(result.immediateDanger,'yes');
  assert.ok(!result.needs.includes('supplies'));
  const supply = facts(caller('We need water and food.'));
  assert.deepEqual(supply.needs,['supplies']);
  assert.equal(supply.immediateDanger,'unknown');
  assert.equal(facts(caller('River water is rising outside.')).immediateDanger,'unknown');
});

test('latest explicit corrections replace zone, safety, and people count', () => {
  const result = facts(agent('Are you in immediate danger?'),caller('Yes. We are trapped.'),agent('Where are you?'),caller('Riverbend, Zone 3.'),caller('There are four of us.'),caller('Actually Zone 2, not Zone 3.'),caller('Correction: there are five of us.'),caller('Actually we are safe now and no longer trapped.'));
  assert.equal(result.locationText,'Zone 2');
  assert.equal(result.immediateDanger,'no');
  assert.equal(result.immediateEvidence,null);
  assert.equal(result.peopleCount,5);
});

test('safety recheck uses its newest explicit answer', () => {
  const result = facts(agent('Are you in immediate danger?'),caller('Yes.'),agent('Are you in immediate danger right now?'),caller('No, we are safe inside now.'));
  assert.equal(result.immediateDanger,'no');
  const safePrompt = facts(agent('Are you safe right now?'),caller('No.'));
  assert.equal(safePrompt.immediateDanger,'yes');
});

test('unexplained contradictory safety statements remain unknown', () => {
  const separate = facts(caller('We are trapped.'),caller('We are safe.'));
  assert.equal(separate.immediateDanger,'unknown');
  assert.equal(separate.immediateEvidence,null);
  const mixed = facts(agent('Are you in immediate danger?'),caller('No, but water is rising inside the house.'));
  assert.equal(mixed.immediateDanger,'unknown');
  const uncertain = facts(agent('Are you in immediate danger?'),caller('I am not sure if we are trapped.'));
  assert.equal(uncertain.immediateDanger,'unknown');
});

test('unexplained conflicting zones remain unassigned until clarified', () => {
  const result = facts(caller('We are in Zone 1.'),caller('We are in Zone 2.'));
  assert.equal(result.locationText,'');
  assert.equal(facts(caller('We are in Zone one.'),caller('Zone 1.')).locationText,'Zone 1');
});

test('word people counts, group totals, and count prompts are supported', () => {
  assert.equal(facts(caller('There are four of us.')).peopleCount,4);
  assert.equal(facts(caller('A family of five needs a ride.')).peopleCount,5);
  assert.equal(facts(agent('How many people need help?'),caller('Six.')).peopleCount,6);
  assert.equal(facts(caller('Two adults and three children need shelter.')).peopleCount,5);
  assert.equal(facts(caller('One person uses oxygen.')).peopleCount,null);
});

test('uncertain counts and conflicting totals remain unknown', () => {
  assert.equal(facts(caller('About four of us.')).peopleCount,null);
  assert.equal(facts(caller('Five or six people need help.')).peopleCount,null);
  assert.equal(facts(caller('There are four of us.'),caller('There are five of us.')).peopleCount,null);
});

test('explicit need denial/correction removes an earlier medical need', () => {
  const result = facts(caller('We need oxygen and medication.'),caller('Actually we do not need oxygen or medication. We need shelter.'));
  assert.deepEqual(result.needs,['shelter']);
  const noSupply = facts(caller('We do not need water or food.'));
  assert.deepEqual(noSupply.needs,[]);
});

test('an unrelated correction does not discard other facts in the same turn', () => {
  const result = facts(caller('We are trapped near the Riverbend footbridge, Zone 3. There are four of us and we need oxygen. Actually there are five of us.'));
  assert.equal(result.immediateDanger,'yes');
  assert.ok(result.locationText.includes('Zone 3'));
  assert.equal(result.peopleCount,5);
  assert.ok(result.needs.includes('medical'));
});

test('unknown location can retain a usable landmark without inventing coordinates', () => {
  const result = facts(agent('Where are you?'),caller('I do not know the street, but we are by the blue water tower.'));
  assert.match(result.locationText,/blue water tower/i);
  assert.equal(result.immediateDanger,'unknown');
  assert.deepEqual(result.needs,[]);
});

test('a quoted scam threat is not physical danger evidence', () => {
  const result = facts(caller('Someone called me and said I would be trapped unless I paid. Is this a scam?'));
  assert.equal(result.immediateDanger,'unknown');
  assert.equal(result.immediateEvidence,null);
});


test('no safe way out is a rescue need, while denying that need is not', () => {
  assert.ok(facts(caller('There is no safe way out.')).needs.includes('evacuation'));
  assert.deepEqual(facts(caller('We do not need a safe way out.')), {locationText:'',immediateDanger:'unknown',peopleCount:null,needs:[],immediateEvidence:null});
});
