(() => {
  if(globalThis.MangaPagePanel)return;
  let host,root,tabId,side='right',width=390;
  const isOpen=()=>!!host?.isConnected;
  function position(){
    width=Math.max(260,Math.min(width,innerWidth-32));
    host.style.setProperty('width',width+'px','important');
    host.style.setProperty('left',side==='left'?'0':'auto','important');
    host.style.setProperty('right',side==='right'?'0':'auto','important');
    root.querySelector('.page-resize').style[side==='right'?'left':'right']='0';
    root.querySelector('.page-resize').style[side==='right'?'right':'left']='auto';
  }
  function close(){
    host?.remove();
    chrome.runtime.sendMessage({type:'page-panel-closed'}).catch(()=>{});
  }
  function mount(options){
    tabId=options.tabId;
    if(host){
      if(options.toggle&&isOpen())host.remove();else document.documentElement.append(host);
      return {open:isOpen(),initialize:false};
    }
    const parsed=new DOMParser().parseFromString(options.html,'text/html');
    host=document.createElement('div');
    host.dataset.mangaTranslatorPanel='page';
    host.setAttribute('role','complementary');host.setAttribute('aria-label','Manga Translator');
    host.style.cssText='all:initial!important;position:fixed!important;top:0!important;bottom:0!important;height:100dvh!important;max-width:calc(100vw - 16px)!important;z-index:2147483645!important;display:block!important;visibility:visible!important;opacity:1!important;color:#19232f!important;font:15px/1.6 system-ui,sans-serif!important;color-scheme:light!important;';
    root=host.attachShadow({mode:'closed'});
    const style=document.createElement('style');
    style.textContent=options.css+'\n'+[...parsed.querySelectorAll('style')].map(node=>node.textContent).join('\n')+`
      :host{color:#19232f;font:15px/1.6 system-ui,sans-serif;color-scheme:light}
      .page-titlebar{height:42px;display:flex;align-items:center;gap:6px;padding:3px 10px;background:#eef2f5;border-bottom:1px solid #ccd5dc;box-shadow:-3px 0 10px #0002}
      .page-titlebar strong{flex:1;font-size:14px}.page-titlebar button{padding:2px 10px;font-size:18px}
      main{height:calc(100dvh - 42px);width:100%;max-width:none;box-shadow:-3px 0 10px #0002}
      #list-scroll{overscroll-behavior:contain}.page-resize{position:absolute;top:42px;bottom:0;width:6px;cursor:ew-resize;touch-action:none}
      .page-resize:focus-visible{background:#125c69}
    `;
    const titlebar=document.createElement('header');titlebar.className='page-titlebar';
    const title=document.createElement('strong');title.textContent='Manga Translator';
    const move=document.createElement('button');move.textContent='↔';move.title='패널 위치 변경';move.setAttribute('aria-label',move.title);
    move.onclick=()=>{side=side==='right'?'left':'right';position();};
    const dismiss=document.createElement('button');dismiss.textContent='×';dismiss.title='패널 닫기';dismiss.setAttribute('aria-label',dismiss.title);dismiss.onclick=close;
    titlebar.append(title,move,dismiss);
    const grip=document.createElement('div');grip.className='page-resize';grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-label','패널 너비 조절');grip.setAttribute('aria-orientation','vertical');
    grip.onpointerdown=event=>{grip.focus();grip.setPointerCapture(event.pointerId);event.preventDefault();};
    grip.onpointermove=event=>{if(grip.hasPointerCapture(event.pointerId)){width=side==='right'?innerWidth-event.clientX:event.clientX;position();}};
    grip.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();width+=(event.key==='ArrowLeft'?1:-1)*(side==='right'?20:-20);position();};
    root.append(style,titlebar,parsed.querySelector('main'),grip);
    for(const name of ['pointerdown','pointerup','click','dblclick','keydown','keyup','wheel'])host.addEventListener(name,event=>event.stopPropagation());
    addEventListener('resize',position);
    position();document.documentElement.append(host);
    return {open:true,initialize:true};
  }
  globalThis.MangaPagePanel={mount,isOpen,get root(){return root;},get tabId(){return tabId;}};
})();
