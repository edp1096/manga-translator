(() => {
if(globalThis.MangaNames)return;
const text=(value,limit=180)=>{if(typeof value!=='string')throw Error('이름은 문자열로 입력하세요.');const trimmed=value.trim();if(new TextEncoder().encode(trimmed).length>limit||/[\r\n\t]/.test(trimmed))throw Error('이름 입력이 너무 길거나 줄바꿈이 들어 있습니다.');return trimmed;};
const languages={Korean:'한국어',English:'영어',Chinese:'중국어',Japanese:'일본어'};
const kinds={person:'인물',place:'장소',organization:'단체',term:'용어',honorific:'호칭'};
const defaultHonorifics=target=>target==='Korean'?[{source:'ちゃん',translation:'짱'},{source:'さん',translation:'씨'},{source:'くん',translation:'군'},{source:'君',translation:'군'},{source:'様',translation:'님'},{source:'さま',translation:'님'}]:[];
function entries(input){
 const output=(input.entries||[]).map(entry=>({...entry,kind:entry.kind||'person'}));
 for(const rule of input.honorifics||(input.version===2?[]:defaultHonorifics(input.target||'Korean')))output.push({...rule,id:rule.id||'honorific:'+rule.source,kind:'honorific'});
 return output;
}
function identity(value){
 const url=new URL(value);if(!['http:','https:'].includes(url.protocol))throw Error('만화의 웹 주소를 입력하세요.');url.hash='';
 const old=url.hostname==='urasunday.com'&&url.pathname.match(/^\/title\/(\d+)(?:\/\d+)?\/?$/),one=url.hostname==='manga-one.com'&&url.pathname.match(/^\/manga\/(\d+)(?:\/chapter\/\d+)?\/?$/);
 if(old||one)return 'https://manga-one.com/manga/'+(old||one)[1];
 const comicWalker=url.pathname.match(/^(\/detail\/[^/]+)/),tonari=url.pathname.match(/^\/episode\/[^/]+/),mangaz=url.pathname.match(/^(\/virgo\/view\/\d+)/);
 if(comicWalker)return url.origin+comicWalker[1];
 if(mangaz)return url.origin+mangaz[1];
 const chapter=url.pathname.match(/^(.*?)(?:[-_/](?:chapter|chap|ch|episode|ep)[-_/]?(?:\d+(?:[.-]\d+)*|undefined|null|nan))(?:\.html?)?\/?$/i);
 if(chapter&&chapter[1])return url.origin+chapter[1];
 if(tonari)return url.origin+url.pathname;
 return url.href;
}
function validate(input){
 if(!input||typeof input!=='object'||new TextEncoder().encode(JSON.stringify(input)).length>262144)throw Error('사전 형식이 잘못되었거나 크기가 너무 큽니다.');
 const work={version:2,id:text(input.id||crypto.randomUUID()),title:text(input.title||'',200),target:input.target||'Korean',revision:text(input.revision||crypto.randomUUID()),scopes:[...new Set((input.scopes||[]).map(value=>identity(value)))],entries:[]};
 if(!work.title)throw Error('작품 이름을 입력하세요.');
 if(!Object.hasOwn(languages,work.target))throw Error('지원하지 않는 번역 언어입니다.');
 if(!Array.isArray(input.entries)||entries(input).length>500||work.scopes.length>100)throw Error('명칭은 500개, 연결 주소는 100개까지 저장할 수 있습니다.');
 const mappings=new Map(),register=(source,translation)=>{if(!source||!translation)throw Error('원문과 번역명을 함께 입력하세요.');if(mappings.has(source)&&mappings.get(source)!==translation)throw Error('같은 원문 이름에 서로 다른 번역명이 있습니다: '+source);mappings.set(source,translation);};
 for(const original of entries(input)){
  const entry={id:text(original.id||crypto.randomUUID()),kind:original.kind,aliases:[]};
  if(!Object.hasOwn(kinds,entry.kind))throw Error('명칭 종류가 올바르지 않습니다.');
  for(const key of ['source','translation','givenSource','givenTranslation','familySource','familyTranslation','reading'])entry[key]=text(original[key]||'');
  if(entry.kind==='honorific'){
   if(!entry.source)throw Error('호칭 원문을 입력하세요.');
   entry.sourcePosition=original.sourcePosition||'suffix';entry.position=original.position||'suffix';
   if(!['prefix','suffix'].includes(entry.sourcePosition)||!['prefix','suffix'].includes(entry.position))throw Error('호칭 위치가 올바르지 않습니다.');
   entry.sourceGap=!!original.sourceGap;entry.gap=!!original.gap||/^\s|\s$/.test(original.translation||'');
   const signature='honorific:'+entry.sourcePosition+':'+entry.sourceGap+':'+entry.source;
   if(mappings.has(signature))throw Error('같은 호칭이 중복 등록되었습니다: '+entry.source);mappings.set(signature,entry.translation);
   work.entries.push(entry);continue;
  }
  register(entry.source,entry.translation);
  entry.matchReading=!!original.matchReading;
  if(entry.matchReading){if(!entry.reading)throw Error('읽기 매칭을 사용하려면 확인한 읽기를 입력하세요.');register(entry.reading,entry.translation);}
  if(entry.kind!=='person')for(const key of ['givenSource','givenTranslation','familySource','familyTranslation'])entry[key]='';
  for(const [sourceKey,translationKey]of [['givenSource','givenTranslation'],['familySource','familyTranslation']]){if(!!entry[sourceKey]!==!!entry[translationKey])throw Error('성·이름의 원문과 번역명을 함께 입력하세요.');if(entry[sourceKey]){if(!entry.source.includes(entry[sourceKey]))throw Error('원문 풀네임 안에 해당 성·이름이 없습니다.');register(entry[sourceKey],entry[translationKey]);}}
  for(const alias of original.aliases||[]){if(entry.aliases.length>=20)throw Error('별칭은 인물당 20개까지 저장할 수 있습니다.');const source=text(alias.source),translation=text(alias.translation);register(source,translation);entry.aliases.push({source,translation});}
  work.entries.push(entry);
 }
 return work;
}
const forURL=(works,url,target='Korean')=>{let scope;try{scope=identity(url);}catch{return undefined;}return (works||[]).find(work=>(work.target||'Korean')===target&&(work.scopes||[]).includes(scope));};
function dictionary(work){if(!work)return null;const saved=validate(work);const {id,title,target,revision}=saved;return {id,title,target,revision,entries:saved.entries.filter(entry=>entry.kind!=='honorific'),honorifics:saved.entries.filter(entry=>entry.kind==='honorific')};}
function undo(result,workId){const copy=structuredClone(result);let changed=0;for(const region of copy.regions||[]){const edit=region.nameEdit;if(edit&&(!workId||edit.work===workId)&&region.translation===edit.after){region.translation=edit.before;delete region.nameEdit;changed++;}}if(changed){delete copy.nameDictionary;delete copy.nameWarnings;}return{result:copy,changed};}
globalThis.MangaNames={identity,validate,forURL,dictionary,undo,entries,languages,kinds,defaultHonorifics};
})();
