export function updateLabel(update, result, version) {
 const status=update?.status;
 if(status==='error')return /요청 한도|rate limit/i.test(update.error||'')?'GitHub 요청 한도 초과':/HTTP 403/.test(update.error||'')?'업데이트 확인 차단 · HTTP 403':'업데이트 실패';
 if(status==='checking')return '새 버전 확인 중';
 if(status==='available')return '새 버전 '+update.version;
 if(status==='downloading')return '다운로드·검증 중';
 if(status==='restarting')return '적용·재시작 중';
 if(result?.status==='complete'&&result.version===version)return 'v'+version+' 업데이트 완료';
 if(status==='latest')return '최신 버전 · '+version;
 return '현재 버전 '+(version||'…');
}
