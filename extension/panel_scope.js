// The extension remembers which tabs may show a panel; Chrome keeps each tab's
// actual open/closed state. Enabling a panel is not the same as opening it.
// A panel opened in one tab never enables another tab's panel.
(() => {
  const enabledTabs = new Set();
  const ready = chrome.storage.session.get(['panelTabs','panelWindows']).then(saved => {
    const ids=Array.isArray(saved.panelTabs)?saved.panelTabs:Object.values(saved.panelWindows||{});
    for(const id of ids)if(Number.isInteger(id))enabledTabs.add(id);
  });
  const save=()=>ready.then(()=>chrome.storage.session.set({panelTabs:[...enabledTabs]}));
  const eligible=tab=>/^https?:/.test(tab.url||'')&&!/^http:\/\/(127\.0\.0\.1|localhost):8794(?:\/|$)/.test(tab.url||'');
  const disabled=tabId=>chrome.sidePanel.setOptions({tabId,enabled:false}).catch(()=>{});
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{});
  chrome.sidePanel.setOptions({enabled:false}).catch(()=>{});

  async function openPanel(tab){
    if(!Number.isInteger(tab.id)||!eligible(tab))return;
    enabledTabs.add(tab.id);
    try{
      // Both calls must be dispatched before awaiting to preserve the gesture.
      const configured=chrome.sidePanel.setOptions({tabId:tab.id,path:`panel.html?tab=${tab.id}`,enabled:true});
      const opening=chrome.sidePanel.open({tabId:tab.id});
      await Promise.all([configured,opening]);await save();
    }catch(error){enabledTabs.delete(tab.id);await disabled(tab.id);await save();console.error('Cannot open Manga Translator panel:',error);}
  }
  chrome.action.onClicked.addListener(openPanel);
  chrome.tabs.onActivated.addListener(async({tabId})=>{
    await ready;
    // Do not close or disable the previous tab: Chrome preserves that tab's panel.
    if(!enabledTabs.has(tabId))await disabled(tabId);
  });
  // Do not disable a tab in onClosed: delayed notifications have no close
  // reason, and checking tabs.get().active races with switching back to the
  // original tab. A close notification must not revoke panel availability.
  // Keeping its options enabled lets Chrome restore the panel on return while
  // still remembering a completed user close. Only the toolbar opens a panel.
  chrome.tabs.onUpdated.addListener(async(tabId,change,tab)=>{
    if(!change.url&&change.status!=='complete')return;
    await ready;
    if(!eligible(tab)){enabledTabs.delete(tabId);await disabled(tabId);await save();}
    else if(!enabledTabs.has(tabId))await disabled(tabId);
  });
  chrome.tabs.onRemoved.addListener(async tabId=>{await ready;enabledTabs.delete(tabId);await save();});
  ready.then(async()=>{
    const tabs=await chrome.tabs.query({});const live=new Set(tabs.map(tab=>tab.id));
    for(const id of enabledTabs)if(!live.has(id))enabledTabs.delete(id);
    for(const tab of tabs){
      if(enabledTabs.has(tab.id)&&eligible(tab))await chrome.sidePanel.setOptions({tabId:tab.id,path:`panel.html?tab=${tab.id}`,enabled:true});
      else{enabledTabs.delete(tab.id);await disabled(tab.id);}
    }
    await save();
  }).catch(()=>{});
})();
