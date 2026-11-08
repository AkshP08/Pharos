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

test('an explicitly worsening situation replaces an earlier safe report', () => {
  const result = facts(caller('We are safe and need drinking water.'), caller('Now water is rising inside our house. We cannot get out.'));
  assert.equal(result.immediateDanger, 'yes');
  assert.match(result.immediateEvidence, /water is rising inside|cannot get out/i);
  assert.ok(result.needs.includes('supplies'));
  assert.equal(facts(caller('We are safe.'), caller('We are trapped now.')).immediateDanger, 'yes');
});

test('a changing outdoor river or uncertain report does not invent current indoor danger', () => {
  const outdoors = facts(caller('We are safe.'), caller('The river water is rising outside.'));
  assert.equal(outdoors.immediateDanger, 'no');
  assert.equal(outdoors.immediateEvidence, null);
  const uncertain = facts(caller('We are safe.'), caller('I am not sure if water is now rising inside our house.'));
  assert.equal(uncertain.immediateDanger, 'unknown');
  assert.equal(uncertain.immediateEvidence, null);
});

test('agent or quoted scam wording cannot make an earlier safe situation worse', () => {
  const prompted = facts(caller('We are safe.'), agent('Water might be rising inside; are you trapped now?'), caller('We are still safe.'));
  assert.equal(prompted.immediateDanger, 'no');
  const quoted = facts(caller('We are safe.'), caller('Someone called me and said water is rising inside unless I pay. Is this a scam?'));
  assert.equal(quoted.immediateDanger, 'no');
  assert.equal(quoted.immediateEvidence, null);
});

test('calling back about a situation does not make an exact people count approximate', () => {
  const result = facts(caller('I am calling back about the same situation. We are near Riverbend footbridge, Zone 3. Water is now rising inside and we cannot get out. There are three of us.'));
  assert.equal(result.peopleCount, 3);
  assert.equal(result.immediateDanger, 'yes');
  assert.equal(facts(caller('We are calling back about supplies. There are about three of us.')).peopleCount, null);
});

test('new own-home water levels and household stairs replace an earlier safe report', () => {
  const reports = [
    'Water is coming up our stairs now.',
    'The floodwater has risen above the first floor of our house.',
    'Water is now up to our second floor.',
    'Water is now waist deep inside our house.',
    'Our ground floor is now underwater.',
  ];
  for (const text of reports) {
    const result = facts(caller('We are safe and need drinking water.'), caller(text));
    assert.equal(result.immediateDanger, 'yes', text);
    assert.ok(text.includes(result.immediateEvidence), 'Evidence must remain an actual caller quotation');
    assert.deepEqual(result.needs, ['supplies'], 'A later danger report must preserve a previously requested supply need');
    assert.ok(!facts(caller(text)).needs.includes('supplies'), 'Floodwater alone is not a drinking-water request');
  }
});

test('negated, hypothetical, uncertain and outdoor flood reports do not invent current indoor danger', () => {
  for (const text of [
    'Water has not reached the first floor of our house.',
    'Water is not coming up our stairs.',
    'If water is up to our second floor, what should we do?',
    'The river water is higher outside.',
  ]) {
    const result = facts(caller('We are safe.'), caller(text));
    assert.equal(result.immediateDanger, 'no', text);
    assert.equal(result.immediateEvidence, null);
  }
  const uncertain = facts(caller('We are safe.'), caller('I am not sure whether water has reached our first floor.'));
  assert.equal(uncertain.immediateDanger, 'unknown');
  assert.equal(uncertain.immediateEvidence, null);
});

test('reported scam speech does not supply physical safety, zone, count or medical facts', () => {
  const result = facts(caller('The caller said, "We are trapped in Zone 1. We need oxygen. There are five people." But we are safe near Riverbend footbridge, Zone 3. There are three of us and we need drinking water.'));
  assert.equal(result.immediateDanger, 'no');
  assert.equal(result.immediateEvidence, null);
  assert.match(result.locationText, /Riverbend footbridge, Zone 3/);
  assert.equal(result.peopleCount, 3);
  assert.deepEqual(result.needs, ['supplies']);
});

test('a separate real household danger is preserved after reported contact speech', () => {
  const flooding = facts(caller('The caller said we were trapped unless we paid. But water is now rising inside our house.'));
  assert.equal(flooding.immediateDanger, 'yes');
  assert.match(flooding.immediateEvidence, /water is now rising inside/i);
  const breathing = facts(caller('The scammer said, "I cannot breathe." My father can’t breathe.'));
  assert.equal(breathing.immediateDanger, 'yes');
  assert.equal(breathing.immediateEvidence, 'can’t breathe');
  assert.equal(facts(caller("The scammer said 'I can't breathe.' I am safe.")).immediateDanger, 'no');
});

test('negative breathing statements do not become an emergency while a separate current symptom does', () => {
  assert.equal(facts(caller("My child didn't say he can't breathe. We are safe.")).immediateDanger, 'no');
  const current = facts(caller("We are not trapped, but my child can't breathe."));
  assert.equal(current.immediateDanger, 'yes');
  assert.equal(current.immediateEvidence, "can't breathe");
});

test('spoken addresses keep explicit response zones available for area matching', () => {
  assert.equal(facts(caller('We are at 12 Oak Street in Zone 1.')).locationText, '12 Oak Street, Zone 1');
  assert.equal(facts(caller('Our location is 45 Pine Road, Zone two.')).locationText, '45 Pine Road, Zone two');
});

test('an explicit current relocation replaces old location without requiring a correction phrase', () => {
  assert.equal(facts(caller('We are in Zone 1.'), caller('We have moved to Zone 2.')).locationText, 'Zone 2');
  assert.equal(facts(caller('We are at 12 Oak Street in Zone 1.'), caller('We have moved to 45 Pine Road in Zone 2.')).locationText, '45 Pine Road, Zone 2');
  assert.match(facts(caller('We are in Zone 1.'), caller('We are now near the Northbank library, Zone 2.')).locationText, /Northbank library, Zone 2/);
});

test('hypothetical relocation is ignored and explicitly unknown new location clears stale routing', () => {
  assert.equal(facts(caller('We are in Zone 1.'), caller('If we move to Zone 2, can we find shelter?')).locationText, 'Zone 1');
  assert.equal(facts(caller('We are in Zone 1.'), caller('We are now at an unknown location.')).locationText, '');
  assert.equal(facts(caller('We are in Zone 1.'), caller('We are in Zone 2.')).locationText, '');
});

test('a generic later reference to the same library preserves the specific hosted-demo location', () => {
  const initial = 'We are safe. We need shelter near Northbank Library in zone two. There are three people';
  const initialFacts = facts(caller(initial));
  const updated = facts(caller(initial), caller('We have no injuries. We can wait safely at the library.'));
  assert.equal(updated.locationText, initialFacts.locationText);
  assert.match(updated.locationText, /Northbank Library in zone two/);
  assert.equal(updated.immediateDanger, 'no');
  assert.equal(updated.peopleCount, 3);
  assert.deepEqual(updated.needs, ['shelter']);
});

test('explicit moves to another library or a different named library replace the old location', () => {
  const initial = caller('We are near Northbank Library in Zone 2.');
  const another = facts(initial, caller('We have moved to another library.'));
  assert.equal(another.locationText, 'another library');
  assert.ok(!another.locationText.includes('Northbank'));
  const named = facts(initial, caller('We are now at Riverbend Library in Zone 3.'));
  assert.match(named.locationText, /Riverbend Library in Zone 3/);
  assert.ok(!named.locationText.includes('Northbank'));
});

test('a prompted answer or explicit correction can replace a detailed place with a generic place', () => {
  const initial = caller('We are near Northbank Library in Zone 2.');
  assert.equal(facts(initial, agent('Where are you now?'), caller('At the library.')).locationText, 'At the library.');
  assert.equal(facts(initial, caller('Correction: we are at the library.')).locationText, 'at the library');
});

test('a relative library reference does not conceal a subsequent conflicting independent zone', () => {
  const result = facts(caller('We are near Northbank Library in Zone 2.'), caller('We can wait at the library.'), caller('We are in Zone 3.'));
  assert.equal(result.locationText, '');
  const differentPlace = facts(caller('We are near Northbank Library in Zone 2.'), caller('We are near Riverbend Footbridge in Zone 3.'));
  assert.equal(differentPlace.locationText, '', 'Independent conflicting locations still require clarification');
});

test('a prompted location keeps only the place rather than unrelated changing report sentences', () => {
 const result=facts(agent('Where are you now?'),caller('We are near Northbank library zone two. There are three of us. We are safe for now, but need shelter.'));
 assert.equal(result.locationText,'near Northbank library zone two');
 assert.equal(result.peopleCount,3);
});

test('location acknowledgements and thanks cannot erase a known place',()=>{
 const r=facts(agent("What's happening, and where are you now?"),caller('We are near Northbank Library South entrance. Zone two.'),caller('There are three of us. We are safe for now, but we need shelter.'),agent('Thank you. I have your location and that three people need shelter. This request is for human review.'),caller('Thanks.'));
 assert.match(r.locationText,/Northbank Library South entrance/);assert.match(r.locationText,/Zone two/);assert.equal(r.peopleCount,3);
});
