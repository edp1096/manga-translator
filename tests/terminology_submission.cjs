const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const stored={server:'http://127.0.0.1:8793',token:'test-token'},handlers=[],requests=[];
let switchTargetOnRead=false;
const context={URL,TextEncoder,crypto:require('node:crypto').webcrypto,structuredClone,AbortSignal,FormData,Blob,setTimeout,clearTimeout,console};
context.chrome={storage:{local:{get:async keys=>{if(keys==='nameWorks'&&switchTargetOnRead){stored.target='English';switchTargetOnRead=false;}return structuredClone(keys===null?stored:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in stored).map(key=>[key,stored[key]])));},set:async value=>Object.assign(stored,structuredClone(value))}},runtime:{onMessage:{addListener:listener=>handlers.push(listener)},onMessageExternal:{addListener(){}},id:'test'}};
context.fetch=async(url,options)=>{if(String(url).startsWith('data:'))return fetch(url);assert.equal(url,stored.server+'/api/jobs');assert(options.body instanceof FormData);const form=options.body;assert.equal(form.get('image').type,'image/png');requests.push({target:form.get('target'),dictionary:form.has('dictionary')?JSON.parse(form.get('dictionary')):null});return new Response(JSON.stringify({id:'job-'+requests.length}),{status:200});};
vm.createContext(context);context.importScripts=(...files)=>{for(const name of files)if(name!=='panel_scope.js')vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension',name),'utf8'),context);};vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),context);
const url='https://reader.test/work-chapter-1.html',data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=';
const send=()=>new Promise(resolve=>handlers[0]({type:'submit',data},{tab:{id:1,url}},resolve));
const legacy={id:'legacy',title:'Known work',revision:'one',scopes:['https://reader.test/work'],entries:[{source:'佐々木チロル',translation:'사사키 티롤'}]};
async function submit(target,expected){stored.target=target;const response=await send();assert.equal(response.ok,true,response.error);const request=requests.at(-1);assert.equal(request.target,target);assert.equal(request.dictionary?.id||null,expected);if(expected)assert.equal(request.dictionary.target,target);return request;}
(async()=>{
 for(const language of ['Korean','English','Chinese','Japanese'])await submit(language,null);
 stored.nameWorks=[{...legacy,scopes:['https://reader.test/other']}];await submit('Korean',null);
 stored.nameWorks=[legacy];const migrated=await submit('Korean','legacy');assert.equal(migrated.dictionary.entries[0].translation,'사사키 티롤');await submit('English',null);
 const english={...legacy,version:2,id:'english',target:'English',entries:[{kind:'term',source:'戦乙女',translation:'Valkyrie',reading:'ヴァルキュリア',matchReading:true}]};stored.nameWorks=[legacy,english];await submit('English','english');await submit('Korean','legacy');await submit('Chinese',null);
 stored.nameWorks=[{...legacy,version:2,entries:[]}];await submit('Korean',null);
 stored.nameWorks=[{...legacy,version:2,entries:[{kind:'honorific',source:'ちゃん',translation:'짱'}]}];await submit('Korean',null);
 stored.nameWorks=[legacy,english];stored.target='Korean';switchTargetOnRead=true;assert.equal((await send()).ok,true);assert.equal(stored.target,'English');assert.equal(requests.at(-1).target,'Korean');assert.equal(requests.at(-1).dictionary.id,'legacy');
 console.log('PASS submission without a dictionary in all4targets, unrelated/missing-language/empty/honorific-only dictionaries, legacy matching dictionary and target-switch race ('+requests.length+' requests)');
})().catch(error=>{console.error(error);process.exitCode=1;});
