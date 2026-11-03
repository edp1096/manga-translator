// Run with FONT_PLAYWRIGHT pointing to an installed playwright-core directory.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.FONT_PLAYWRIGHT||'playwright-core');
const root=path.resolve(__dirname,'..'),evidence=process.env.FONT_EVIDENCE||path.resolve(root,'../browser-evidence');
(async()=>{
 fs.mkdirSync(evidence,{recursive:true});
 const options=process.platform==='win32'?{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}:{executablePath:'/home/swshin/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome'};
 const browser=await chromium.launch({...options,headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1000,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Strict page CSP: binary font loading must work without allowing a remote font URL.
 await page.route('http://font-test.local/**',route=>route.fulfill({contentType:'text/html',body:'<meta http-equiv="Content-Security-Policy" content="font-src \'none\'; script-src \'none\'"><canvas id="preview"></canvas>'}));
 await page.goto('http://font-test.local/');
 for(const file of ['polygon.js','fonts.js','render.js'])await page.evaluate(fs.readFileSync(path.join(root,'extension',file),'utf8'));
 const files=Object.fromEntries(['dialogue','reflective','narration','shout','impact'].map(id=>[id,fs.readFileSync(path.join(root,'extension/fonts',id+'.woff')).toString('base64')]));
 const report=await page.evaluate(async files=>{
  let requests=0;MangaFonts.setLoader(async id=>{requests++;return 'data:font/woff;base64,'+files[id];});
  const roles=Object.keys(files),texts=['내일 다시 만나자.','그때 솔직하게 말했더라면…','그날 이후, 마을은 다시 평화를 되찾았다.','당장 멈춰!!','콰앙!'];
  const result={width:800,height:900,target:'Korean',regions:roles.map((role,i)=>({id:i,manual:true,box:[30,20+i*145,770,145+i*145],bbox:[30,20+i*145,770,145+i*145],fontSize:36,text:texts[i],translation:texts[i],mode:'replace',fontChoice:role,fontStyle:{version:1,role}}))};
  const white=document.createElement('canvas');white.width=result.width;white.height=result.height;white.getContext('2d').fillStyle='white';white.getContext('2d').fillRect(0,0,800,900);const source=white.toDataURL();
  const light=MangaFonts.decorate(result,true);await MangaFonts.ensure(light);if(requests!==0)throw Error('Light mode loaded fonts');
  const preview=document.querySelector('canvas'),snapshot=async data=>{await MangaRender.render(preview,data,source,source);return preview.toDataURL();};
  const baseline=await snapshot(light);await MangaFonts.ensure(result);const shown=MangaRender.presentation(result,'auto',undefined,'tooltip',undefined,false);const styled=await snapshot(shown);
  const layouts=shown.regions.map(r=>{const layout=MangaRender.textLayout(r);if(!layout)throw Error('Unfitted region '+r.id);return {role:r.fontStyle.role,font:MangaFonts.css(layout.fontSize,r),layout};});
  if(styled===baseline)throw Error('Custom fonts not painted');
  const back=await snapshot(MangaFonts.decorate(result,true));if(back!==baseline)throw Error('Light mode changed legacy pixels');
  if(await snapshot(shown)!==styled)throw Error('Mode round trip not stable');
  const weightSample={...shown,regions:[{...shown.regions[0],fontWeight:400}]};
  const regular=await snapshot(weightSample);weightSample.regions[0].fontWeight=700;
  const bold=await snapshot(weightSample);if(regular===bold)throw Error('Bold did not change pixels');
  const weightSaved=MangaRender.editedBase(weightSample,result);
  if(weightSaved.regions[0].fontWeight!==700||await snapshot(JSON.parse(JSON.stringify(weightSample)))!==bold)throw Error('Weight persistence failed');
  const cachedWeight=MangaRender.textLayout(weightSample.regions[0]);weightSample.regions[0].fontWeight=400;
  if(MangaRender.textLayout(weightSample.regions[0])===cachedWeight)throw Error('Weight metrics cache stale');
  if(MangaFonts.weight({fontStyle:{role:'shout'},translation:'멈춰!'})!==700||MangaFonts.weight({fontStyle:{role:'dialogue'},translation:'안녕!!'})!==400||MangaFonts.weight({fontStyle:{role:'shout'},translation:'멈춰!',fontWeight:400})!==400)throw Error('Automatic/manual weight policy failed');
  const lightWeight=MangaFonts.decorate(weightSample,true);const lightRegular=await snapshot(lightWeight);lightWeight.regions[0].fontWeight=700;
  if(await snapshot(lightWeight)!==lightRegular)throw Error('Light mode applied weight override');
  const single=shown.regions[0],old=MangaRender.textLayout(single);single.fontChoice='shout';const manual=MangaFonts.decorate(shown);const changed=await snapshot(manual);if(changed===styled)throw Error('Manual font did not change pixels');
  const saved=MangaRender.editedBase(manual,result);if(saved.regions[0].fontChoice!=='shout')throw Error('Manual choice lost');
  const reloaded=JSON.parse(JSON.stringify(saved));await MangaFonts.ensure(reloaded);if(await snapshot(reloaded)!==changed)throw Error('Saved font pixels changed');
  if(MangaFonts.choice(single,'English',false)!=='shout')throw Error('Manual choice ignored');if(MangaFonts.choice({...result.regions[1],fontChoice:undefined},'English')!=='default')throw Error('Non-Korean automatically styled');
  // Same region identity, changed family: cached metrics must change.
  const cacheRegion={...single,translation:'다시 만날 수 있을까?',box:[0,0,180,100],fontSize:35,_fontId:'dialogue'};const a=MangaRender.textLayout(cacheRegion);cacheRegion._fontId='shout';const b=MangaRender.textLayout(cacheRegion);if(a===b)throw Error('Stale layout cache');
  shown.regions[0].fontChoice='dialogue';await snapshot(shown);return {requests,loaded:document.fonts.size,layouts,roundTrip:true,manualSaveReload:true,lightweightPixelParity:true,cspBinaryFonts:true};
 },files);
 assert.equal(report.loaded,5);assert.equal(report.requests,5);assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(evidence,'font-styles.png'),fullPage:true});fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
 // Failed font download must preserve display with original fallback.
 const failure=await browser.newPage();for(const f of ['fonts.js','render.js'])await failure.evaluate(fs.readFileSync(path.join(root,'extension',f),'utf8'));
 assert.equal(await failure.evaluate(async()=>{MangaFonts.setLoader(()=>Promise.reject(Error('offline')));await MangaFonts.ensure({target:'Korean',regions:[{}]});return MangaFonts.css(24,{_fontId:'dialogue'});}), '600 24px "Noto Sans CJK KR", "Malgun Gothic", sans-serif');
 console.log('PASS browser fonts: five actual WOFFs, strict CSP, measured layout, manual persistence, light-mode pixel parity, cache invalidation, download failure fallback');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
