const assert=require('node:assert/strict'),m=require('../extension/editor-recognition.js');
const r={id:7,box:[1,2,31,42],bbox:[2,3,30,40],text:'old',translation:'기존',fontChoice:'stone',fontSize:40,manualRestoration:{asset:'preserve'},ocrTruncated:true},s=m.snapshot(r,12),response={text:'new',translation:'새 번역',bbox:[1,0,40,50],preview:'data:image/png;base64,AA=='};
const before=structuredClone(r),out=m.accept(r,s,response,12);assert.deepEqual(r,before);assert.equal(out.fontChoice,'stone');assert.deepEqual(out.manualRestoration,r.manualRestoration);assert.deepEqual(out.bbox,r.bbox);assert.equal(out.text,'new');assert(!out.ocrTruncated);
for(const changed of [{...r,box:[0,0,20,20]},{...r,text:'edited'},{...r,translation:'edited'},{...r,id:8}])assert.throws(()=>m.accept(changed,s,response,12));
assert.throws(()=>m.accept(r,s,response,13));assert.throws(()=>m.validate({...response,translation:''}));
const manual={...r,manual:true};assert.deepEqual(m.accept(manual,m.snapshot(manual,0),response,0).bbox,response.bbox);
console.log('PASS preview immutability, stale rejection, style/mask preservation, new region bounds');
