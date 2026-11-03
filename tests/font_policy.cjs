const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/fonts.js'),'utf8'),c);const f=c.MangaFonts;
const row=(role,translation='고마워!')=>({fontStyle:{role,version:1},translation});
for(const role of ['dialogue','friendly','reflective','unknown'])assert.equal(f.choice(row(role),'Korean'),'dialogue');
assert.equal(f.choice(row('narration'),'Korean'),'narration');assert.equal(f.choice(row('shout','멈춰!'),'Korean'),'shout');
assert.equal(f.choice(row('shout','아주 긴 설명을 계속하는 대사에는 과도한 강조 글꼴을 사용하지 않습니다.'),'Korean'),'dialogue');
assert.equal(f.choice(row('dialogue','멈춰!!!'),'Korean'),'dialogue');assert.equal(f.choice({...row('shout'),type:'effect'},'Korean'),'dialogue');
for(const id of Object.keys(f.catalog)){
 const r={...row('dialogue'),fontChoice:id};assert.equal(f.choice(r,'Korean'),id);assert.equal(f.choice(r,'English'),id);assert.equal(f.choice(r,'Korean',true),'default');assert.equal(r.fontChoice,id);
}
assert.equal(f.choice(row('narration'),'English'),'default');assert.equal(f.choice({...row('narration'),fontChoice:'default'},'Korean'),'default');
assert.equal(f.choice({...row('impact','콰앙!'),type:'effect'},'Korean'),'impact');
assert.equal(f.choice(row('impact','콰앙!'),'Korean'),'dialogue');
assert.equal(f.choice({...row('impact','콰앙!'),type:'effect',textVerification:{role:'DIALOGUE'}},'Korean'),'dialogue');
assert.equal(f.choice({...row('impact','쾅'.repeat(25)),type:'effect'},'Korean'),'dialogue');
console.log('PASS restrained automatic policy, legacy results, short emphasis, manual overrides and lightweight preservation');

assert.equal(f.choice({fontChoice:'friendly'},'Korean'),'dialogue');assert.equal(f.choice({fontChoice:'friendly'},'English'),'dialogue');assert.equal(f.catalog.reflective,'날개');assert.equal(f.catalog.shout,'여행');assert.equal(Object.hasOwn(f.catalog,'friendly'),false);
