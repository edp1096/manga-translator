const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/fonts.js'),'utf8'),c);const f=c.MangaFonts;
const row=(role,translation='고마워!')=>({fontStyle:{role,version:1},translation});
for(const role of ['dialogue','friendly','reflective','unknown'])assert.equal(f.choice(row(role),'Korean'),'dialogue');
assert.equal(f.choice(row('narration'),'Korean'),'reflective');assert.equal(f.choice(row('shout','멈춰!'),'Korean'),'shout');
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

// Page defaults are inherited independently; explicit region choices still win.
const pageResult={target:'Korean',fontDefaults:{font:'serif',weight:700},regions:[row('dialogue'),{...row('dialogue'),fontChoice:'stone',fontWeight:400}]};
const pageBefore=JSON.stringify(pageResult),pageRows=f.decorate(pageResult).regions;
assert.equal(pageRows[0]._fontId,'serif');assert.equal(f.weight(pageRows[0]),700);assert.equal(pageRows[1]._fontId,'stone');assert.equal(f.weight(pageRows[1]),400);assert.equal(JSON.stringify(pageResult),pageBefore);
assert(f.decorate(pageResult,true).regions.every(r=>r._fontId==='default'&&f.weight(r)===400));
const invalid=f.decorate({...pageResult,fontDefaults:{font:'invalid',weight:999}}).regions;assert.equal(invalid[0]._fontId,'dialogue');assert.equal(f.weight(invalid[0]),400);
console.log('PASS page defaults precedence, independent weights, invalid defaults, lightweight and nonmutation');
