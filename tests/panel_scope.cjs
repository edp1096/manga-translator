const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const event=()=>({listeners:[],addListener(f){this.listeners.push(f)},async emit(...args){await Promise.all(this.listeners.map(f=>f(...args)))}});
(async()=>{
 const tabs=[{id:11,windowId:1,active:true,url:'https://example.com/a'},{id:12,windowId:1,active:false,url:'https://example.com/b'}],options=new Map(),calls=[],saved={};
 const chrome={action:{onClicked:event()},tabs:{onActivated:event(),onUpdated:event(),onRemoved:event(),query:async()=>tabs,get:async id=>tabs.find(t=>t.id===id)},storage:{session:{get:async()=>saved,set:async v=>Object.assign(saved,v)}},sidePanel:{onClosed:event(),setPanelBehavior:async v=>calls.push(['behavior',v]),setOptions:async v=>{options.set(v.tabId??'default',v);calls.push(['options',v])},open:async v=>calls.push(['open',v])}};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../extension/panel_scope.js'),'utf8'),{chrome,console});await new Promise(r=>setImmediate(r));
 assert.equal(options.get('default').enabled,false);assert.equal(options.get(11).enabled,false);assert.equal(options.get(12).enabled,false);
 await chrome.action.onClicked.emit(tabs[0]);assert.equal(options.get(11).enabled,true);assert.equal(options.get(11).path,'panel.html?tab=11');assert.equal(calls.filter(c=>c[0]==='open').length,1);
 tabs[0].active=false;tabs[1].active=true;await chrome.tabs.onActivated.emit({tabId:12,windowId:1});assert.equal(options.get(11).enabled,true);assert.equal(options.get(12).enabled,false);
 tabs[0].active=true;tabs[1].active=false;await chrome.tabs.onActivated.emit({tabId:11,windowId:1});assert.equal(options.get(11).enabled,true);assert.equal(calls.filter(c=>c[0]==='open').length,1,'switching tabs opened a panel');
 await chrome.action.onClicked.emit(tabs[1]);assert.equal(options.get(12).enabled,true);
 await chrome.sidePanel.onClosed.emit({tabId:12});assert.equal(options.get(12).enabled,true,'inactive hidden event discarded open state');
 // A delayed tab-hide notification can arrive after this tab is active again.
 await chrome.sidePanel.onClosed.emit({tabId:11});assert.equal(options.get(11).enabled,true,'delayed tab-hide notification disabled the returned tab');
 await chrome.tabs.onActivated.emit({tabId:11,windowId:1});assert.equal(options.get(11).enabled,true,'tab activation discarded panel availability');
 assert.equal(JSON.stringify(saved.panelTabs),'[11,12]');
 await chrome.tabs.onUpdated.emit(12,{url:'chrome://settings'},{...tabs[1],url:'chrome://settings'});assert.equal(options.get(12).enabled,false);
 await chrome.action.onClicked.emit({...tabs[0],url:'http://127.0.0.1:8794/'});assert.equal(calls.filter(c=>c[0]==='open').length,2,'control page opened panel');
 console.log('PASS: explicit tab-only open; delayed hide events preserve tab availability; Chrome owns panel visibility; restricted pages disabled');
})().catch(e=>{console.error(e);process.exit(1)});
