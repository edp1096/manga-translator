(() => {
  const openedTabs=new Set(),pending=new Map();
  const ready=chrome.storage.session.get(['pagePanelTabs','edgePanelTabs']).then(saved=>{
    const tabIds=Array.isArray(saved.pagePanelTabs)?saved.pagePanelTabs:Array.isArray(saved.edgePanelTabs)?saved.edgePanelTabs:[];
    for(const tabId of tabIds)if(Number.isInteger(tabId))openedTabs.add(tabId);
  });
  const eligible=tab=>/^https?:/.test(tab.url||'')&&!/^http:\/\/(127\.0\.0\.1|localhost):8794(?:\/|$)/.test(tab.url||'');
  let writes=Promise.resolve(),assets;
  const save=()=>writes=writes.catch(()=>{}).then(()=>chrome.storage.session.set({pagePanelTabs:[...openedTabs]}));
  function queue(tabId,operation){
    const task=(pending.get(tabId)||ready).catch(()=>{}).then(operation);
    pending.set(tabId,task);
    task.finally(()=>{if(pending.get(tabId)===task)pending.delete(tabId);}).catch(()=>{});
    return task;
  }
  async function mount(tab,toggle=false){
    if(!eligible(tab))return;
    assets ||= Promise.all(['panel.html','ui.css'].map(file=>fetch(chrome.runtime.getURL(file)).then(response=>{
      if(!response.ok)throw Error('패널 파일을 읽을 수 없습니다.');return response.text();
    }))).catch(error=>{assets=undefined;throw error;});
    const [html,css]=await assets;
    const target={tabId:tab.id,frameIds:[0]};
    await chrome.scripting.executeScript({target,files:['panel_embed.js']});
    const [result]=await chrome.scripting.executeScript({target,func:options=>MangaPagePanel.mount(options),args:[{tabId:tab.id,html,css,toggle}]});
    if(result.result.initialize)await chrome.scripting.executeScript({target,files:['zip.js','panel.js']});
    if(result.result.open)openedTabs.add(tab.id);else openedTabs.delete(tab.id);
    await save();
  }
  const report=error=>console.error('Cannot open Manga Translator page panel:',error);
  globalThis.MangaPagePanels={closed:sender=>queue(sender.tab?.id,async()=>{
    if(sender.frameId!==0||!Number.isInteger(sender.tab?.id))return;
    openedTabs.delete(sender.tab.id);await save();
  })};
  chrome.action.onClicked.addListener(tab=>{
    if(!Number.isInteger(tab.id)||!eligible(tab))return;
    return queue(tab.id,()=>mount(tab,true)).catch(report);
  });
  chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{
    if(!change.url&&change.status!=='complete')return;
    queue(tabId,async()=>{
      if(!eligible(tab)){openedTabs.delete(tabId);await save();}
      else if(change.status==='complete'&&openedTabs.has(tabId))await mount(tab);
    }).catch(report);
  });
  chrome.tabs.onRemoved.addListener(tabId=>queue(tabId,async()=>{openedTabs.delete(tabId);await save();}).catch(report));
  ready.then(async()=>{
    const tabs=await chrome.tabs.query({}),live=new Set(tabs.map(tab=>tab.id));
    for(const tabId of openedTabs)if(!live.has(tabId))openedTabs.delete(tabId);
    await Promise.all(tabs.map(tab=>queue(tab.id,async()=>{
      if(!eligible(tab))openedTabs.delete(tab.id);
      else if(openedTabs.has(tab.id))await mount(tab);
    }).catch(report)));
    await save();
  }).catch(report);
})();
