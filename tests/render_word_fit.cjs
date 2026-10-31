const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const b=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{const p=await b.newPage();await p.addScriptTag({path:path.resolve(process.env.MANGA_RENDERER||path.join(__dirname,'../extension/render.js'))});const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/word-fit-bubble.json')));const report=await p.evaluate(fixture=>{
 const checks=[],check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);};
 // Actual caption from chapter4 page4; only typography, no phrase matching in product.
 const source={box:[134,871,270,1227],fontSize:43,translation:'철저하게 이용할 수밖에 없지.'},before=JSON.stringify(source);
 const layout=MangaRender.textLayout(source,source.box,43,11);
 check('whole caption words',layout.breaks===0&&layout.lines.includes('철저하게'));check('readable caption',layout.fontSize>=32);check('source unchanged',JSON.stringify(source)===before);
 for(const flag of ['manual','layoutOverride','displayOverride']){const edited={...source,[flag]:true},l=MangaRender.textLayout(edited,edited.box,43,11);check('explicit '+flag+' retains font',l.fontSize===43);}
 for(const flag of ['manual','layoutOverride','displayOverride']){const r={...source};MangaRender.textLayout(r,r.box,43,11);r[flag]=true;check('edit invalidates cached layout '+flag,MangaRender.textLayout(r,r.box,43,11).fontSize===43);delete r[flag];check('automatic layout restored '+flag,MangaRender.textLayout(r,r.box,43,11).lines.includes('철저하게'));}
 const narrow={box:[788,148,843,387],fontSize:32,translation:'고등학교 때, 학교 근처에 격투기 체육관이 있었어.'};check('small caption retains17px',MangaRender.textLayout(narrow).fontSize>=17);
 for(const scale of [.5,1.5,3]){const r={...source,box:source.box.map(x=>x*scale),fontSize:43*scale},l=MangaRender.textLayout(r,r.box,r.fontSize,Math.max(8,Math.round(11*scale)));check('whole words at scale '+scale,l&&l.breaks===0&&l.lines.includes('철저하게'));}
 const shown=MangaRender.presentation(fixture.result,'white',fixture.geometry),bubble=shown.regions[0],words=MangaRender.textLayout(bubble);check('already reduced bubble gains no word splits',words.breaks<=1);check('already reduced bubble keeps readable size',words.fontSize>=30);
 check('serialized placement retains original font budget',MangaRender.textLayout(JSON.parse(JSON.stringify(bubble))).fontSize>=30);const base=MangaRender.editedBase(shown,fixture.result);check('editing resets automatic font budget',!Object.hasOwn(base.regions[0],'automaticFontMaximum'));
 return {checks,font:layout.fontSize,lines:layout.lines};},fixture);assert.equal(report.checks.length,20);console.log(JSON.stringify({...report,browser:b.version()}));}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
