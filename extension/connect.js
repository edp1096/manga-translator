const status=document.getElementById('status'),button=document.getElementById('connect');let pending;
(async()=>{pending=(await chrome.storage.session.get('pendingServerConnection')).pendingServerConnection;if(!pending||pending.nonce!==new URL(location.href).searchParams.get('request')||Date.now()-pending.created>120000)throw Error('연결 요청이 만료됐습니다. 관리 페이지에서 다시 연결하세요.');document.getElementById('address').textContent=pending.origin;button.disabled=false;})().catch(e=>status.textContent=e.message);
button.onclick=async()=>{button.disabled=true;try{
 const current=(await chrome.storage.session.get('pendingServerConnection')).pendingServerConnection;if(current?.nonce!==pending?.nonce||Date.now()-pending.created>120000)throw Error('연결 요청이 만료됐습니다.');
 const response=await fetch(pending.origin+'/api/extension/pair',{method:'POST',headers:{'Content-Type':'application/json','X-Manga-Extension':chrome.runtime.id},body:JSON.stringify({code:pending.code}),signal:AbortSignal.timeout(10000)}),data=await response.json();if(!response.ok)throw Error(data.error||'연결하지 못했습니다.');
 const api=new URL(MangaServers.origin(data.server)),management=new URL(pending.origin);
 if(MangaServers.origin(data.managementServer)!==pending.origin||api.hostname!==management.hostname||api.protocol!==management.protocol||typeof data.token!=='string'||data.token.length<32)throw Error('서버 연결 정보가 올바르지 않습니다.');
 await chrome.storage.local.set({server:api.origin,managementServer:pending.origin,token:data.token});await chrome.storage.session.remove('pendingServerConnection');status.textContent='연결했습니다. 관리 페이지로 돌아갑니다.';
 const tab=await chrome.tabs.getCurrent();setTimeout(()=>chrome.tabs.remove(tab.id),700);
 }catch(e){status.textContent=e.message;button.disabled=false}};
document.getElementById('cancel').onclick=async()=>{const current=(await chrome.storage.session.get('pendingServerConnection')).pendingServerConnection;if(current?.nonce===pending?.nonce)await chrome.storage.session.remove('pendingServerConnection');const tab=await chrome.tabs.getCurrent();chrome.tabs.remove(tab.id)};
