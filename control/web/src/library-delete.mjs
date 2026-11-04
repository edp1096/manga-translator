// Keep the deleted IDs even when a batch only partly succeeds, so extension
// caches can be pruned without touching unrelated jobs.
export async function deleteLibraryJobs(ids,prune,send=fetch){
 const unique=[...new Set(ids)],deleted=[];let error='',cacheError='';
 for(let i=0;i<unique.length;i+=500){
  const batch=unique.slice(i,i+500);
  try{
   const response=await send('/api/jobs/delete',{method:'POST',headers:{'Content-Type':'application/json','X-Manga-Control':'1'},body:JSON.stringify({ids:batch}),signal:AbortSignal.timeout(120000)});
   const value=await response.json();
   deleted.push(...(Array.isArray(value.deleted)?value.deleted.filter(id=>batch.includes(id)):[]));
   if(!response.ok){error=value.error||'삭제 실패';break;}
   if(batch.some(id=>!deleted.includes(id))){error='일부 작업의 삭제를 확인하지 못했습니다. 목록을 새로고침하세요.';break;}
  }catch(e){error=e.message;break;}
 }
 const removed=[...new Set(deleted)];
 if(removed.length)try{await prune({type:'control-cache-prune',ids:removed});}catch{cacheError='확장 캐시 정리에 실패했습니다. 작업 데이터에서 확장 캐시를 정리하세요.';}
 return {deleted:removed,error,cacheError};
}
