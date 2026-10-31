const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage();await page.addScriptTag({path:path.resolve(process.env.MANGA_RENDERER||path.join(__dirname,'../extension/render.js'))});
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/nested-connected-bubble.json'),'utf8'));
 const report=await page.evaluate(f=>{const checks=[],check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);},before=JSON.stringify(f),shown=MangaRender.presentation(f.result,'white',f.geometry),[title,paragraph,condition]=shown.regions;
 check('three phrases visible',shown.regions.every(r=>r.mode==='white'&&MangaRender.direct(r)));
 check('paragraph keeps complete Korean word',MangaRender.textLayout(paragraph).lines.includes('소악당에게'));
 check('condition keeps word after leading dash',MangaRender.textLayout(condition).lines.includes('하지만,'));
 check('no forced word splits',shown.regions.every(r=>MangaRender.textLayout(r).breaks===0));
 check('readable fonts',shown.regions.every(r=>MangaRender.textLayout(r).fontSize>=18));
 check('root title retains rightmost slot',paragraph.box[2]<=title.box[0]&&condition.box[2]<=title.box[0]);
 check('paragraph precedes condition',paragraph.box[3]<=condition.box[1]);
 check('within balloon mask',shown.regions.every(r=>MangaRender.coverage(r.whiteBackground,shown,r.box)>=.98));
 check('source unchanged',JSON.stringify(f)===before);
 const edited=structuredClone(f);edited.result.regions[1].layoutOverride=true;edited.result.regions[1].fontSize=11;
 const manual=MangaRender.presentation(edited.result,'white',edited.geometry).regions[1];
 check('manual box retained',JSON.stringify(manual.box)===JSON.stringify(edited.result.regions[1].box));check('manual font retained',manual.fontSize===11);
 for(const dash of ['――','—','--']){const layout=MangaRender.textLayout({box:[0,0,96,160],fontSize:32,translation:dash+'하지만, 단 하나.'});check('word after dash '+dash,layout&&layout.lines.includes('하지만,')&&layout.breaks===0);}
 const text='가나다라마바사아자차카타파하',narrow=MangaRender.textLayout({box:[0,0,35,180],fontSize:24,translation:text});
 check('unfittable word can still wrap without lost glyphs',narrow&&narrow.lines.join('')===text);
 const caption=MangaRender.textLayout(f.narrowCaption);check('narrow caption keeps readable font',caption&&caption.fontSize>=17);
 return {checks,fonts:shown.regions.map(r=>r.fontSize)};
 },fixture);assert(report.checks.length===16);console.log(JSON.stringify({...report,browser:browser.version()}));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
