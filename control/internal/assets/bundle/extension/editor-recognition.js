/* Manual OCR results remain a preview until explicitly accepted. */
(function(root){
 const snapshot=(r,rotation)=>({id:r.id,box:[...r.box],rotation,text:r.text,translation:r.translation});
 function validate(r){if(!r||typeof r.text!=='string'||!r.text.trim()||typeof r.translation!=='string'||!r.translation.trim()||!Array.isArray(r.bbox)||r.bbox.length!==4||!r.bbox.every(Number.isFinite)||r.bbox[2]<=r.bbox[0]||r.bbox[3]<=r.bbox[1]||!/^data:image\/png;base64,/.test(r.preview||''))throw Error('유효한 인식·번역 결과를 받지 못했습니다.');}
 function accept(region,before,response,rotation){
  validate(response);
  if(JSON.stringify(snapshot(region,rotation))!==JSON.stringify(before))throw Error('인식 후 글상자나 대사가 변경되었습니다. 다시 인식하세요.');
  const r={...region,text:response.text,translation:response.translation,layoutOverride:true,displayOverride:true,manualRecognition:{box:[...before.box],rotation:before.rotation,bbox:[...response.bbox]}};
  if(region.manual)r.bbox=[...response.bbox];
  for(const key of ['ocrTruncated','truncated','punctuationMismatch','punctuationFragments','textVerification','automaticForced'])delete r[key];
  return r;
 }
 root.MangaRecognition={snapshot,validate,accept};
 if(typeof module!=='undefined')module.exports=root.MangaRecognition;
})(globalThis);
