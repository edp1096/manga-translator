const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{fs.mkdirSync('research/page-fonts-2026-11-04',{recursive:true});const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://pagefonts.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1);return route.fulfill({body:fs.readFileSync(path.join(__dirname,'../extension',name)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.woff')?'font/woff':'text/html;charset=utf-8'});});
 await page.addInitScript(()=>{const job='11111111-1111-4111-8111-111111111111';const initial={width:400,height:400,target:'Korean',regions:[0,1,2].map((n)=>({id:n+1,type:'text',mode:'replace',text:'原文',translation:'반가워, 오늘도!',bbox:[20,20+n*120,300,110+n*120],box:[20,20+n*120,300,110+n*120],fontSize:24,...(n===1?{fontChoice:'shower',fontWeight:400}:{})}))};window.chrome={storage:{onChanged:{addListener(){}},local:{get:async()=>({['edit:'+job]:{result:JSON.parse(localStorage.getItem('edited')||'null')||initial}})}},runtime:{sendMessage:async m=>{
 if(m.type==='settings')return {ok:true,value:{fontPolicy:{dialogue:{font:'dialogue',bold:false}}}};
 if(m.type==='font'){const bytes=new Uint8Array(await(await fetch('fonts/'+m.id+'.woff')).arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return {ok:true,value:'data:font/woff;base64,'+btoa(s)};}
 if(m.type==='asset'){const c=document.createElement('canvas');c.width=c.height=400;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,400,400);return {ok:true,value:c.toDataURL()};}
 if(m.type==='apply'){localStorage.setItem('edited',JSON.stringify(m.result));return {ok:true,value:{result:m.result,baseResult:m.result}};}return {ok:false,error:'Unsupported '+m.type};}}};});
 await page.goto('https://pagefonts.test/editor.html?job=11111111-1111-4111-8111-111111111111');await page.waitForFunction(()=>document.querySelector('#status').textContent==='3개 영역');

 const ids=()=>page.evaluate(()=>[...selectedIds]);
 const blank=async(x=380,y=380)=>{const b=await page.locator('#canvas').boundingBox();await page.mouse.click(b.x+x/400*b.width,b.y+y/400*b.height);};
 const drag=async(x1,y1,x2,y2,modifier)=>{if(modifier)await page.keyboard.down(modifier);const b=await page.locator('#canvas').boundingBox();await page.mouse.move(b.x+x1/400*b.width,b.y+y1/400*b.height);await page.mouse.down();await page.mouse.move(b.x+x2/400*b.width,b.y+y2/400*b.height,{steps:5});await page.mouse.up();if(modifier)await page.keyboard.up(modifier);};
 const initial=await page.evaluate(()=>JSON.stringify(result));await blank();assert.deepEqual(await ids(),[]);assert.equal(await page.evaluate(()=>selected),-1);assert.equal(await page.locator('#selection-count').textContent(),'0개 선택');
 for(const id of ['source','translation','font-family','mode','delete','recognize-region','mask-edit','restore-again','select-single'])assert(await page.locator('#'+id).isDisabled(),id+' must be disabled at zero');
 for(const id of ['add','select-all','regions','apply','png','project'])assert.equal(await page.locator('#'+id).isDisabled(),false,id+' must stay usable');
 await page.keyboard.press('Delete');assert.equal(await page.evaluate(()=>JSON.stringify(result)),initial);await page.click('#apply');await page.waitForFunction(()=>document.querySelector('#status').textContent==='원본 페이지에 적용했습니다.');assert.deepEqual(await ids(),[]);
 await page.selectOption('#regions','1');assert.deepEqual(await ids(),[2]);assert.equal(await page.locator('#translation').isDisabled(),false);
 await page.locator('.box[data-region="1"]').click({modifiers:['Control']});assert.deepEqual(await ids(),[]);
 await page.locator('.box[data-region="2"]').click({modifiers:['Shift']});assert.deepEqual(await ids(),[3]);await blank();
 await page.click('#select-all');assert.deepEqual(await ids(),[1,2,3]);assert.equal(await page.locator('#selection-count').textContent(),'3개 선택');assert.equal(await page.locator('#font-family').isDisabled(),false);
 await drag(5,5,320,235);assert.deepEqual(await ids(),[1,2]);await drag(320,235,5,5);assert.deepEqual(await ids(),[1,2]);
 await drag(310,250,5,365,'Control');assert.deepEqual(await ids(),[1,2,3]);
 await drag(330,10,380,80);assert.deepEqual(await ids(),[]);await page.locator('.box[data-region="0"]').click();assert.deepEqual(await ids(),[1]);assert.equal(await page.locator('#translation').isDisabled(),false);
 const beforeCancel=await ids(),b=await page.locator('#canvas').boundingBox();await page.mouse.move(b.x+5/400*b.width,b.y+5/400*b.height);await page.mouse.down();await page.mouse.move(b.x+320/400*b.width,b.y+235/400*b.height);await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await ids(),beforeCancel);assert.equal(await page.locator('.editor-marquee').count(),0);
 await page.evaluate(()=>busy=true);await blank();assert.deepEqual(await ids(),[1]);await page.evaluate(()=>busy=false);
 await page.click('#toggle');await blank();assert.deepEqual(await ids(),[1]);await page.click('#toggle');
 await page.click('#mask-edit');await drag(320,10,380,80);assert.deepEqual(await ids(),[1]);assert(await page.evaluate(()=>encodedManualMask().runs.length>0));await page.click('#mask-cancel');
 // Selection must never modify layout/OCR geometry or translated text.
 assert.equal(await page.evaluate(()=>JSON.stringify(MangaRender.editedBase(result,baseResult))),await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.getItem('edited')))));
 // Nested boxes must remain individually and multiply selectable without geometry edits.
 await page.evaluate(async()=>{result.regions.forEach((r,i)=>{r.box=[[80,80,200,200],[120,120,260,260],[130,130,240,240]][i];r.bbox=[...r.box];r.layoutOverride=true;r.displayOverride=true;});baseResult=structuredClone(result);selectedIds.clear();selected=-1;refreshRegions();await draw();select(-1);});
 const overlapBefore=await page.evaluate(()=>JSON.stringify(result));
 const point=async(x,y,options={})=>{const r=await page.locator('#canvas').boundingBox();await page.mouse.click(r.x+x/400*r.width,r.y+y/400*r.height,options)};
 await point(150,150,{button:'right'});assert(await page.locator('#overlap-picker').isVisible());assert.equal(await page.locator('#overlap-list input').count(),3);assert.deepEqual(await ids(),[],'right click must not select or drag a box');
 await page.locator('#overlap-list input').nth(0).check();await page.locator('#overlap-list input').nth(2).check();assert.deepEqual((await ids()).sort(),[1,3]);await page.locator('#overlap-list input').nth(0).uncheck();assert.deepEqual(await ids(),[1]);await page.locator('#overlap-list input').nth(2).uncheck();assert.deepEqual(await ids(),[]);assert.equal(await page.locator('#translation').isDisabled(),true);
 await page.click('#overlap-all');assert.deepEqual((await ids()).sort(),[1,2,3]);await page.locator('#overlap-list button').nth(1).click();assert.deepEqual(await ids(),[2]);assert(await page.locator('#overlap-picker').isHidden());
 await page.keyboard.down('Alt');await point(150,150);assert.deepEqual(await ids(),[1]);await point(150,150);assert.deepEqual(await ids(),[3]);await point(150,150);assert.deepEqual(await ids(),[2]);await page.keyboard.up('Alt');
 await page.keyboard.down('Control');await page.keyboard.down('Alt');await point(150,150);await point(150,150);await page.keyboard.up('Alt');await page.keyboard.up('Control');assert.deepEqual((await ids()).sort(),[1,2,3]);
 await point(150,150,{button:'right'});await page.keyboard.press('Escape');assert(await page.locator('#overlap-picker').isHidden());
 assert.equal(await page.evaluate(()=>JSON.stringify(result)),overlapBefore,'overlap selection changed source/text/layout');
 await page.click('#editor-panel-side');await point(150,150,{button:'right'});assert.equal(await page.locator('#overlap-list input').count(),3);assert(await page.locator('#overlap-picker').evaluate(e=>{const b=e.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight&&e.contains(document.elementFromPoint(b.left+8,b.top+8))}));await page.keyboard.press('Escape');await page.click('#editor-panel-side');
 await page.evaluate(async()=>{const r={...result.regions[0],id:99,box:[180,180,280,200],bbox:[180,180,280,200],rotation:45,layoutOverride:true,displayOverride:true};result={...result,regions:[r]};baseResult=structuredClone(result);selectedIds.clear();refreshRegions();await draw()});
 const polygonCheck=await page.evaluate(()=>{const b=$('canvas').getBoundingClientRect(),f=(x,y)=>editorPointHits(b.left+x/400*b.width,b.top+y/400*b.height);return {outside:f(265,153),inside:f(230,190)}});assert.deepEqual(polygonCheck.outside,[]);assert.deepEqual(polygonCheck.inside,[0]);
 await drag(260,148,270,158);assert.deepEqual(await ids(),[],'Empty AABB corner of a rotated box must not select');await drag(175,140,280,240);assert.deepEqual(await ids(),[99]);
 await blank();await page.click('#add');assert.equal((await ids()).length,1);assert.equal(await page.locator('#translation').isDisabled(),false);
 assert.deepEqual(errors,[]);console.log('PASS overlap checkbox/single/all/zero selection, Alt cycling/addition, rotated point hits, unchanged data and both panel sides; zero-selection controls/save/reselection, Ctrl-last and Shift-from-zero, polygon marquee both directions, additive drag, empty drag, Escape, busy/original/mask isolation, unchanged data, manual add');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
