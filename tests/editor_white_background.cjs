const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:process.env.MANGA_HEADED!=='1'});
 try{
  for(const scenario of ['normal','missing','peer','offline','automatic','group']){
   const page=await browser.newPage({viewport:{width:1200,height:900}});
   await page.route('https://editor.test/**',route=>{
    const file=new URL(route.request().url()).pathname.slice(1)||'editor.html';
    route.fulfill({body:fs.readFileSync(path.resolve(__dirname,'../extension',file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
   });
   await page.addInitScript(scenario=>{
    const canvas=document.createElement('canvas');canvas.width=400;canvas.height=600;
    const context=canvas.getContext('2d');context.fillStyle='#456';context.fillRect(0,0,400,600);
    context.fillStyle='#789';for(let column=0;column<400;column+=10)context.fillRect(column,0,3,600);
    context.strokeStyle='#fff';context.lineWidth=3;context.strokeRect(48,98,254,164);
    context.fillStyle='#fff';context.font='20px sans-serif';context.fillText('ORIGINAL',115,160);
    const original=canvas.toDataURL(),runs=[];
    for(let row=11;row<25;row++)runs.push(row*40+6,23);
    const geometry={width:400,height:600,bubbles:scenario==='missing'?[]:[{width:40,height:60,runs,bbox:[48,98,302,262],confidence:.96}]};
    const result={width:400,height:600,regions:[
     {id:1,type:'text',bbox:[110,135,250,195],box:[110,135,250,195],mode:'tooltip',color:'#fff',fontSize:24,text:'Original',translation:'Clean translation'},
     {id:2,type:'text',bbox:['peer','group'].includes(scenario)?[80,210,200,240]:[310,300,390,370],box:['peer','group'].includes(scenario)?[80,210,200,240]:[310,300,390,370],mode:'tooltip',fontSize:24,text:'Other',translation:'Other'}
    ]};
    window.fixture={result,original,geometry,scenario,requests:0,available:scenario!=='offline',applied:null};
    const preview=structuredClone(result);
    if(scenario==='automatic')Object.assign(preview.regions[0],{mode:'white',whiteScope:'bubble',whiteBackground:{...geometry.bubbles[0],kind:'bubble'}});
    window.chrome={storage:{local:{get:async()=>({'edit:test':{result:scenario==='group'?MangaRender.presentation(result,'white',geometry):preview,...(['automatic','group'].includes(scenario)?{baseResult:structuredClone(result)}:{}),...(scenario==='group'?{geometry,displayMode:'white'}:{})}})}},runtime:{sendMessage:async message=>{
     if(message.type==='asset')return {ok:true,value:original};
     if(message.type==='bubbles'){fixture.requests++;await new Promise(resolve=>setTimeout(resolve,100));return fixture.available?{ok:true,value:geometry}:{ok:false,error:'서버 409: Translation is running; retry after it finishes'};}
     if(message.type==='apply'){fixture.applied=structuredClone(message.result);return {ok:true,value:true};}
     throw Error(message.type);
    }}};
   },scenario);
   await page.goto('https://editor.test/editor.html?job=test');
   await page.waitForFunction(()=>document.getElementById('status').textContent==='2개 영역');
   if(scenario==='group'){
    assert.equal(await page.locator('#mode').inputValue(),'white');
    await page.locator('#translation').fill('A longer edited translation that must remain visible.');await page.locator('#apply').click();
    const reflow=await page.evaluate(async()=>{const shown=MangaRender.presentation(fixture.applied,'white',fixture.geometry),canvas=document.createElement('canvas');await MangaRender.render(canvas,shown,fixture.original,fixture.original);return canvas.toDataURL();});
    await page.waitForFunction(reflow=>document.getElementById('canvas').toDataURL()===reflow,reflow);
    await page.locator('#translation').fill('');await page.locator('#apply').click();
    assert(await page.evaluate(()=>MangaRender.presentation(fixture.applied,'white',fixture.geometry).regions.every(region=>region.mode==='tooltip')),'Empty peer still erased by shared background');
    await page.waitForFunction(()=>document.getElementById('canvas').toDataURL()===fixture.original);
    await page.locator('#translation').fill('Translated');await page.locator('#delete').click();await page.locator('#apply').click();
    assert.equal(await page.evaluate(()=>fixture.applied.preservedRegions.length),1);
    assert.equal(await page.evaluate(()=>MangaRender.presentation(fixture.applied,'white',fixture.geometry).regions[0].mode),'tooltip');
    await page.waitForFunction(()=>document.getElementById('canvas').toDataURL()===fixture.original);
    await page.close();continue;
   }
   if(scenario==='automatic'){
    assert.equal(await page.locator('#mode').inputValue(),'white');
    await page.locator('#translation').fill('Edited translation');await page.locator('#apply').click();
    assert.equal(await page.evaluate(()=>fixture.applied.regions[0].mode),'tooltip','Text edit baked automatic white into the saved base');
    assert.equal(await page.evaluate(()=>fixture.applied.regions[0].translation),'Edited translation');
    await page.locator('#mode').selectOption('tooltip');await page.locator('#apply').click();
    assert.equal(await page.evaluate(()=>fixture.applied.regions[0].displayOverride),true);
    const mode=await page.evaluate(()=>MangaRender.presentation(fixture.applied,'white',fixture.geometry).regions[0].mode);
    assert.equal(mode,'tooltip','Automatic white overrode an explicit editor selection');
    await page.close();continue;
   }
   const original=await page.locator('#canvas').evaluate(canvas=>canvas.toDataURL());
   await page.locator('#mode').selectOption('white');
   assert.equal(await page.locator('#apply').isDisabled(),true,'Apply was enabled during boundary lookup');
   await page.waitForFunction(()=>!document.getElementById('mode').disabled);
   if(scenario==='normal'){
    assert.equal(await page.locator('#mode').inputValue(),'white');
    const pixels=await page.locator('#canvas').evaluate(canvas=>{
     const context=canvas.getContext('2d'),pixel=(left,top)=>Array.from(context.getImageData(left,top,1,1).data);
     const text=context.getImageData(110,135,140,60).data;let black=0;
     for(let offset=0;offset<text.length;offset+=4)if(text[offset]<80&&text[offset+1]<80&&text[offset+2]<80)black++;
     return {background:pixel(100,120),outside:pixel(20,20),black};
    });
    assert.deepEqual(pixels.background,[255,255,255,255]);assert.deepEqual(pixels.outside,[119,136,153,255]);assert(pixels.black>100,'White text color was not replaced with readable black text');
    await page.locator('#apply').click();
    const applied=await page.evaluate(()=>fixture.applied);assert.equal(applied.regions[0].whiteBackground.kind,'bubble');assert.deepEqual(applied.regions[1],await page.evaluate(()=>fixture.result.regions[1]));
    const roundTrip=await page.evaluate(async()=>{const saved=JSON.parse(JSON.stringify(fixture.applied)),canvas=document.createElement('canvas');await MangaRender.render(canvas,saved,fixture.original,fixture.original);return canvas.toDataURL();});
    assert.equal(roundTrip,await page.locator('#canvas').evaluate(canvas=>canvas.toDataURL()),'Serialized edits lost the background');
    await page.locator('#mode').selectOption('tooltip');
    await page.waitForFunction(original=>document.getElementById('canvas').toDataURL()===original,original);
    await page.locator('#mode').selectOption('white');await page.waitForFunction(()=>!document.getElementById('mode').disabled);
    assert.equal(await page.evaluate(()=>fixture.requests),1,'Reusing a saved boundary ran layout again');
    const empty=await page.evaluate(async()=>{const saved=structuredClone(fixture.applied);saved.regions[0].translation='';const canvas=document.createElement('canvas');await MangaRender.render(canvas,saved,fixture.original,fixture.original);return canvas.toDataURL();});
    assert.equal(empty,original,'An empty translation erased the original text');
    const handle=await page.locator('.box.selected').boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2+220);await page.mouse.up();
    await page.locator('#apply').click();assert.deepEqual(await page.evaluate(()=>fixture.applied.regions[0].box),[110,135,250,195],'Text could be dragged outside its white bubble');
   }else{
    assert.equal(await page.locator('#mode').inputValue(),'tooltip','Unsafe lookup changed the display mode');
    assert.equal(await page.locator('#canvas').evaluate(canvas=>canvas.toDataURL()),original);
    assert.match(await page.locator('#status').textContent(),scenario==='missing'?/경계를 찾지 못/:scenario==='peer'?/다른 글자/:/번역 작업이 끝난 뒤/);
    if(scenario==='offline'){
     await page.evaluate(()=>fixture.available=true);await page.locator('#mode').selectOption('white');await page.waitForFunction(()=>!document.getElementById('mode').disabled);
     assert.equal(await page.locator('#mode').inputValue(),'white');assert.equal(await page.evaluate(()=>fixture.requests),2,'Failed boundary request was cached');
    }
   }
   await page.locator('#white-area').selectOption('box');await page.locator('#mode').selectOption('white');await page.waitForFunction(()=>!document.getElementById('mode').disabled);
   await page.locator('#apply').click();
   assert.equal(await page.evaluate(()=>fixture.applied.regions[0].whiteBackground.kind),'box');
   const data=await page.locator('#canvas').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(108,133,1,1).data));assert.deepEqual(data,[255,255,255,255]);
   const moved=await page.evaluate(async()=>{const edited=structuredClone(fixture.applied);edited.regions[0].box=[110,400,250,460];const canvas=document.createElement('canvas');await MangaRender.render(canvas,edited,fixture.original,fixture.original);const context=canvas.getContext('2d');return {old:Array.from(context.getImageData(108,133,1,1).data),between:Array.from(context.getImageData(120,280,1,1).data),moved:Array.from(context.getImageData(108,398,1,1).data)};});
   assert.deepEqual(moved,{old:[255,255,255,255],between:[119,136,153,255],moved:[255,255,255,255]},'Moving a white text box erased the art between positions');
   await page.close();
  }
  console.log(JSON.stringify({ok:true,browser:browser.version(),cases:6,backgroundAndBlackText:true,outsideUnchanged:true,unselectedPreserved:true,roundTrip:true,reversible:true,emptyTextPreserved:true,missingBoundaryRejected:true,sharedBubbleRejected:true,busyServerRetry:true,boxFallback:true,automaticPreviewEditing:true,explicitOverridePreserved:true,sharedEditingAndDeletion:true}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
