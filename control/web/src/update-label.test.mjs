import assert from 'node:assert/strict';
import {updateLabel} from './update-label.js';
const old={status:'complete',version:'0.4.8',message:'업데이트 완료'};
assert.equal(updateLabel({status:'error',error:'업데이트 서버 응답: HTTP 403'},old,'0.4.8'),'업데이트 확인 차단 · HTTP 403');
assert.equal(updateLabel({status:'error',error:'GitHub 요청 한도 초과 · 잠시 후 다시 확인하세요'},old,'0.4.8'),'GitHub 요청 한도 초과');
assert.equal(updateLabel({status:'available',version:'0.4.9'},old,'0.4.8'),'새 버전 0.4.9');
assert.equal(updateLabel({status:'latest'},old,'0.4.9'),'최신 버전 · 0.4.9');
assert.equal(updateLabel({status:'latest'},old,'0.4.8'),'v0.4.8 업데이트 완료');
console.log('PASS current failure/progress overrides old installation result');
