// Each tab keeps its own user-opened/user-closed panel state.
// A panel opened in one tab never enables another tab's panel.
(() => {
  const opened = new Set();
  const ready = chrome.storage.session.get(['panelTabs','panelWindows']).then(saved => {
    const ids=Array.isArray(saved.panelTabs)?saved.panelTabs:Object.values(saved.panelWindows||{});
    for(const id of ids)if(Number.isInteger(id))opened.add(id);
  });
  const save=()=>ready.then(()=>chrome.storage.session.set({panelTabs:[...opened]}));
  const eligible=tab=>/^https?:/.test(tab.url||'')&&!/^http:\/\/(127\.0\.0\.1|localhost):8794(?:\/|$)/.test(tab.url||'');
  const disabled=tabId=>chrome.sidePanel.setOptions({tabId,enabled:false}).catch(()=>{});
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{});
  chrome.sidePanel.setOptions({enabled:false}).catch(()=>{});

  async function openPanel(tab){
    if(!Number.isInteger(tab.id)||!eligible(tab))return;
    opened.add(tab.id);
    try{
      // Both calls must be dispatched before awaiting to preserve the gesture.
      const configured=chrome.sidePanel.setOptions({tabId:tab.id,path:`panel.html?tab=${tab.id}`,enabled:true});
      const opening=chrome.sidePanel.open({tabId:tab.id});
      await Promise.all([configured,opening]);await save();
    }catch(error){opened.delete(tab.id);await disabled(tab.id);await save();console.error('Cannot open Manga Translator panel:',error);}
  }
  chrome.action.onClicked.addListener(openPanel);
  chrome.tabs.onActivated.addListener(async({tabId})=>{
    await ready;
    // Do not close or disable the previous tab: Chrome preserves that tab's panel.
    if(!opened.has(tabId))await disabled(tabId);
  });
  chrome.sidePanel.onClosed.addListener(async info=>{
    if(!Number.isInteger(info.tabId))return;
    await ready;
    let tab;try{tab=await chrome.tabs.get(info.tabId);}catch{opened.delete(info.tabId);await save();return;}
    // Chrome can report a panel becoming hidden when its tab loses activation.
    // Only a close on the active tab changes the user's saved open/closed state.
    if(!tab.active)return;
    opened.delete(info.tabId);await disabled(info.tabId);await save();
  });
  chrome.tabs.onUpdated.addListener(async(tabId,change,tab)=>{
    if(!change.url&&change.status!=='complete')return;
    await ready;
    if(!eligible(tab)){opened.delete(tabId);await disabled(tabId);await save();}
    else if(!opened.has(tabId))await disabled(tabId);
  });
  chrome.tabs.onRemoved.addListener(async tabId=>{await ready;opened.delete(tabId);await save();});
  ready.then(async()=>{
    const tabs=await chrome.tabs.query({});const live=new Set(tabs.map(tab=>tab.id));
    for(const id of opened)if(!live.has(id))opened.delete(id);
    for(const tab of tabs){
      if(opened.has(tab.id)&&eligible(tab))await chrome.sidePanel.setOptions({tabId:tab.id,path:`panel.html?tab=${tab.id}`,enabled:true});
      else{opened.delete(tab.id);await disabled(tab.id);}
    }
    await save();
  }).catch(()=>{});
})();
