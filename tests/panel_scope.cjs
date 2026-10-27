const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const event=()=>({listeners:[],addListener(handler){this.listeners.push(handler);},async emit(...args){await Promise.all(this.listeners.map(handler=>handler(...args)));}});
async function setup(saved){
 const tabs=[{id:11,url:'https://example.com/a'},{id:12,url:'https://example.com/b'},{id:13,url:'http://127.0.0.1:8794/'}],opened=new Set(),errors=[];
 const chrome={action:{onClicked:event()},tabs:{onUpdated:event(),onRemoved:event(),query:async()=>tabs},storage:{session:{get:async()=>saved,set:async value=>Object.assign(saved,value)}},runtime:{getURL:file=>'chrome-extension://test/'+file},scripting:{executeScript:async request=>{
  if(request.files)return [];
  assert.equal(request.target.frameIds[0],0);
  const options=request.args[0];
  if(options.toggle&&opened.has(options.tabId))opened.delete(options.tabId);else opened.add(options.tabId);
  return [{result:{open:opened.has(options.tabId),initialize:false}}];
 }}};
 const context=vm.createContext({chrome,console:{error:(...args)=>errors.push(args)},fetch:async()=>({ok:true,text:async()=>'<main></main>'})});
 const source=fs.readFileSync(path.resolve(__dirname,'../extension/panel_scope.js'),'utf8').replace('  ready.then(async()=>{','  globalThis.__testReady=ready.then(async()=>{');
 vm.runInContext(source,context);await context.__testReady;assert.deepEqual(errors,[]);
 return {chrome,opened,saved,tabs,context};
}
(async()=>{
 const legacyChrome=await setup({panelTabs:[11,12],panelWindows:{1:11}});
 assert.equal(legacyChrome.opened.size,0,'native availability must not be migrated as open state');
 const legacyEdge=await setup({edgePanelTabs:[11,13,99,'12']});
 assert.deepEqual([...legacyEdge.opened],[11]);assert.equal(JSON.stringify(legacyEdge.saved.pagePanelTabs),'[11]');
 const explicitClosed=await setup({pagePanelTabs:[],edgePanelTabs:[11]});
 assert.equal(explicitClosed.opened.size,0,'empty common state must override legacy Edge state');
 const malformed=await setup({edgePanelTabs:{11:true}});assert.equal(malformed.opened.size,0);
 await legacyChrome.chrome.action.onClicked.emit(legacyChrome.tabs[0]);
 assert.deepEqual([...legacyChrome.opened],[11]);
 await legacyChrome.context.MangaPagePanels.closed({tab:{id:11},frameId:1});
 assert.equal(JSON.stringify(legacyChrome.saved.pagePanelTabs),'[11]','child frame changed the top-level panel state');
 legacyChrome.opened.delete(11);
 await legacyChrome.context.MangaPagePanels.closed({tab:{id:11},frameId:0});
 await legacyChrome.chrome.tabs.onUpdated.emit(11,{status:'complete'},legacyChrome.tabs[0]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(legacyChrome.opened.size,0,'document reload reopened a manually closed panel');
 await legacyChrome.chrome.action.onClicked.emit(legacyChrome.tabs[2]);assert.equal(legacyChrome.opened.size,0);
 console.log('PASS: shared panel without UA/native sidePanel; Edge migration; native availability not treated as open; manual close and restricted pages preserved');
})().catch(error=>{console.error(error);process.exit(1);});
