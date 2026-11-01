const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const event={addListener(){}};
let message='Manga LaMa model is missing';
const context=vm.createContext({URL,AbortSignal,setTimeout,clearTimeout,importScripts(){},
 chrome:{runtime:{onMessage:event,onMessageExternal:event},tabs:{onActivated:event,onUpdated:event,query:async()=>[]},sidePanel:{setPanelBehavior(){}},storage:{local:{get:async()=>({token:'test'})}}},
 fetch:async()=>({ok:false,status:500,text:async()=>JSON.stringify({error:message})})});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../extension/background.js'),'utf8'),context);
(async()=>{
 for(const error of ['Manga LaMa model is missing','이미지 복원 모델이 없습니다. Manga LaMa 모델이 포함된 실행 폴더를 사용하세요.']){
  message=error;
  for(const route of ['/api/jobs/test/restoration/manual','/api/jobs/test/restoration'])
   await assert.rejects(vm.runInContext(`api(${JSON.stringify(route)})`,context),e=>e.message.includes('설치 관리')&&!e.message.includes('서버 500'));
 }
 message='Unexpected inference failure';
 await assert.rejects(vm.runInContext("api('/api/jobs/test/restoration/manual')",context),e=>e.message.includes(message));
 console.log('PASS restoration install guidance and unrelated error preservation');
})().catch(e=>{console.error(e);process.exitCode=1});
