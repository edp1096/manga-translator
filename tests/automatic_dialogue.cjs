const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../extension/content.js'), 'utf8');
const scope = {entries: [], lightweightDisplay: false, pageCache: [], pageIdentity: () => 'chapter'};
vm.runInNewContext(source.slice(source.indexOf('function suspectDialogue('), source.indexOf('async function restoreEntryNow(')), scope);
const line = (id, text, translation, type = 'text') => ({id, text, translation, type});
const first = line(1, 'どんな技を教えるか悩んだ', '이 손을 보고 떠올랐다!');
const second = line(2, 'この手を見てひらめいた', '이 손을 보고 떠올랐다.');
const entry = {job: 'job', result: {target: 'Korean', regions: [first, second, line(3,'今日はいい天気','오늘 날씨가 좋네.')]}};
scope.entries.push(entry);
const ids = regions => [...scope.suspectDialogue({regions})].sort();
assert.deepEqual(ids([first, second]), [1, 2]);
assert.deepEqual(ids([first, {...second, text: first.text + '！'}]), []);
assert.deepEqual(ids([first, {...second, type: 'effect'}]), []);
assert.deepEqual(ids([line(1, 'はい', '네'), line(2, 'ええ', '네')]), []);
assert.deepEqual(ids([line(1, '鍛え抜いた身体は全ての防御を貫通する', '보아라!'), line(2, '見よ', '보아라.')]), [1, 2]);
(async () => {
 const calls = [];
 scope.rpc = async message => {
  calls.push(message.type);
  if (message.type === 'contextReview') {
   assert.deepEqual([...message.duplicateIds].sort(), [1, 2]);
   assert.deepEqual([...message.result.regions].map(row=>row.id), [1, 2]);
   return [{id: 3, apply: true, translation: '다른 표현'}, {id: 1, apply: true, translation: '무슨 기술을 가르칠지 고민했다.'}];
  }
  assert.equal(message.type, 'contextApply');
  assert.deepEqual([...message.changes].map(row=>row.id), [1]);
  return {applied: 1, result: {...entry.result, regions: [{...first, translation: message.changes[0].translation}, second]}};
 };
 scope.lightweightDisplay = true;
 await scope.repairDialogue(entry);
 assert.deepEqual(calls, []);
 scope.lightweightDisplay = false;
 for(const row of [first,second])row.duplicateReview={source:row.text,translation:row.translation};
 await scope.repairDialogue(entry);
 assert.deepEqual(calls, []);
 for(const row of [first,second])delete row.duplicateReview;
 await scope.repairDialogue(entry);
 await scope.repairDialogue(entry);
 assert.deepEqual(calls, ['contextReview', 'contextApply']);
 assert.equal(entry.result.regions[1], second);
})().catch(error => {console.error(error); process.exitCode = 1;});
