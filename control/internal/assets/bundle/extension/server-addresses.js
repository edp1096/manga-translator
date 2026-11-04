// Only explicitly configured management origins can issue commands to this extension.
(()=>{
 function origin(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw Error('서버 주소는 http(s)://호스트:포트 형식으로 입력하세요.');return u.origin;}
 function management(s){if(s.managementServer)return origin(s.managementServer);const u=new URL(origin(s.server));u.port='8794';return u.origin;}
 function sameOrigin(left,right){const a=new URL(left),b=new URL(right);if(a.origin===b.origin)return true;return a.protocol===b.protocol&&a.port===b.port&&['127.0.0.1','localhost'].includes(a.hostname)&&['127.0.0.1','localhost'].includes(b.hostname);}
 function allowed(page,s){return sameOrigin(page,management(s));}
 globalThis.MangaServers={origin,management,allowed,sameOrigin};
})();
