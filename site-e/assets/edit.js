(()=>{'use strict';const S=window.SiteD,{$,$$,esc,norm,api,toast,chars,DEFAULT_COLORS,cleanColor,cardImage,uuid}=S;
if(!String(window.FRECA_CONFIG?.gasUrl||'').trim()){
 document.getElementById('app').innerHTML='<main class="auth-screen"><div class="login-panel"><h1>サイトEの初期設定が必要です</h1><p class="note">専用GASの公開URLを設定すると、サイトEと同じ管理機能を使用できます。</p><p class="note"><a href="index.html">公開画面に戻る</a></p></div></main>';
 return;
}
let db=S.base(),token='',mode='cards',memoTab='owned',filter='',q='',editing=null,imgBuffer='',busy=false;
let savedSnapshot=S.base(),saveTail=Promise.resolve(),writeSeq=0,discardThrough=0,pendingWrites=0;
window.addEventListener('beforeunload',e=>{if(pendingWrites){e.preventDefault();e.returnValue='';}});
const authKey='site_e_demo_auth_verifier';
let bulkMode=false,selected=new Set();
function localVerifier(password){return 'demo-'+password;} // Only a UI gate, NEVER a security boundary.
// Original images for local demo are stored as File/Blob in IndexedDB.
// The ownership metadata keeps only a short reference (idb:...), not a compressed JPEG.
const ownedBlobUrls=new Map();
let ownedImageDBPromise;
function openOwnedImageDB(){
 if(!ownedImageDBPromise)ownedImageDBPromise=new Promise((resolve,reject)=>{
  if(!('indexedDB' in window)){reject(Error('このブラウザでは画像の保存機能を利用できません'));return;}
  const request=indexedDB.open('site_e_owned_originals_v1',1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('images'))db.createObjectStore('images');};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(Error('画像保存領域を開けません'));
 });
 return ownedImageDBPromise;
}
async function ownedBlobStore(key,blob){
 const db=await openOwnedImageDB();
 await new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(blob,key);tx.oncomplete=resolve;tx.onerror=()=>reject(Error('画像を保存できません'));});
 ownedBlobUrls.delete(key);
}
async function ownedBlobRead(key){
 const db=await openOwnedImageDB();
 return await new Promise((resolve,reject)=>{const request=db.transaction('images','readonly').objectStore('images').get(key);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(Error('画像を読み込めません'));});
}
async function ownedBlobDelete(key){
 if(!key||!key.startsWith('idb:'))return;
 const real=key.slice(4),db=await openOwnedImageDB();
 await new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').delete(real);tx.oncomplete=resolve;tx.onerror=reject;});
 const url=ownedBlobUrls.get(real);if(url)URL.revokeObjectURL(url);ownedBlobUrls.delete(real);
}
async function ownedImageURL(src){
 if(!src||!src.startsWith('idb:'))return src||'';
 const key=src.slice(4);
 if(ownedBlobUrls.has(key))return ownedBlobUrls.get(key);
 const blob=await ownedBlobRead(key);
 if(!blob)return '';
 const url=URL.createObjectURL(blob);
 ownedBlobUrls.set(key,url);
 return url;
}
function hydrateOwnedImages(root=document){
 $$('img[data-owned-original]',root).forEach(async img=>{
  const key=img.dataset.ownedOriginal;
  try{const url=await ownedImageURL(key);if(img.isConnected&&img.dataset.ownedOriginal===key)img.src=url;}catch(e){console.warn('所持コーデ画像を読み込めません',e);}
 });
}
const adminTabTokenKey='freca_site_e_admin_tab_token';
const adminTabPasswordKey='freca_site_e_admin_tab_password';
let tokenIssuedAt=0,refreshPromise=null;
function clearAdminSession(){
 token='';
 tokenIssuedAt=0;
 sessionStorage.removeItem(adminTabTokenKey);
 sessionStorage.removeItem(adminTabPasswordKey);
}
async function loginForSession(password,includeAdmin=false){
 const result=await api('login',{password,includeAdmin});
 if(!result?.token)throw Error('認証情報を取得できません');
 token=result.token;
 tokenIssuedAt=Date.now();
 sessionStorage.setItem(adminTabTokenKey,token);
 return result;
}
async function refreshAdminToken(force=false){
 if(S.isDemo())return;
 const password=sessionStorage.getItem(adminTabPasswordKey);
 if(!password)return;
 if(!force&&token&&tokenIssuedAt&&Date.now()-tokenIssuedAt<45*60*1000)return;
 if(!refreshPromise){
  refreshPromise=(async()=>{
   try{await loginForSession(password);}
   catch(error){
    clearAdminSession();
    throw Error('管理パスワードの再認証に失敗しました：'+error.message);
   }
  })().finally(()=>{refreshPromise=null;});
 }
 await refreshPromise;
}
async function adminApi(action,payload={}){
 await refreshAdminToken();
 try{return await api(action,payload,token);}
 catch(error){
  // Retry once with a newly issued token if GAS rejected the current one.
  if(!S.isDemo()&&sessionStorage.getItem(adminTabPasswordKey)&&
     /認証|期限|ログイン|token|session|unauthori|expired/i.test(error.message)){
   await refreshAdminToken(true);
   return api(action,payload,token);
  }
  throw error;
 }
}
async function restoreAdminTab(){
 const password=sessionStorage.getItem(adminTabPasswordKey);
 const savedToken=sessionStorage.getItem(adminTabTokenKey);
 if(!password&&!savedToken){loginScreen();return;}
 try{
  let adminData=null;
  if(password&&!S.isDemo()){
   // A reload issues a fresh GAS token from the existing tab-scoped password.
   const result=await loginForSession(password,true);
   sessionStorage.setItem(adminTabPasswordKey,password);
   if(result.admin&&typeof result.admin==='object'&&Array.isArray(result.admin.cards)&&
      Array.isArray(result.admin.owned)&&Array.isArray(result.admin.plans)&&
      result.admin.colors&&typeof result.admin.colors==='object')adminData=result.admin;
  }else{
   token=savedToken||'demo';
   tokenIssuedAt=0;
  }
  if(!adminData)adminData=await adminApi('admin');
  if(!adminData||typeof adminData!=='object'||!Array.isArray(adminData.cards)||
     !Array.isArray(adminData.owned)||!Array.isArray(adminData.plans))throw Error('管理データを取得できません');
  db=S.sanitize(adminData);
  savedSnapshot=S.sanitize(db);
  dashboard();
 }catch(error){
  clearAdminSession();
  loginScreen();
 }
}
function loginScreen(){const demo=S.isDemo();$('#app').innerHTML=`<div class="auth-screen"><div class="login-panel"><h1>フレカ管理ログイン</h1><p class="note">${demo?'ローカル試作モード：最初のログイン時にデモ用パスワードを設定します。公開用の安全な認証ではありません。':'管理パスワードを入力してください。'}</p><form id="login-form"><label class="field">パスワード<span class="password-control"><input type="password" required minlength="4" autocomplete="current-password" id="password"><button id="password-peek" class="password-peek" type="button" aria-label="押している間パスワードを表示" title="押している間パスワードを表示"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></span></label><button class="btn primary" type="submit">${demo?'デモ管理画面を開く':'ログイン'}</button><p class="note" id="login-error"></p></form><p class="note"><a href="index.html">フレカ閲覧ページに戻る</a></p></div></div>`;
const secretInput=$('#password'),peekButton=$('#password-peek');
const revealPassword=visible=>{
  if(!secretInput.isConnected)return;
  secretInput.type=visible?'text':'password';
  peekButton.setAttribute('aria-pressed',String(visible));
};
peekButton.addEventListener('pointerdown',e=>{if(e.button!==0 && e.pointerType==='mouse')return;e.preventDefault();revealPassword(true);});
peekButton.addEventListener('pointerup',()=>revealPassword(false));
peekButton.addEventListener('pointercancel',()=>revealPassword(false));
peekButton.addEventListener('pointerleave',()=>revealPassword(false));
window.addEventListener('pointerup',()=>revealPassword(false),{signal:undefined});
peekButton.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();revealPassword(true);}});
peekButton.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();revealPassword(false);}});
peekButton.addEventListener('blur',()=>revealPassword(false));
window.addEventListener('blur',()=>revealPassword(false));
$('#login-form').onsubmit=async e=>{e.preventDefault();const pwd=$('#password').value;if(busy)return;
 busy=true;
 const submit=$('#login-form button[type="submit"]'),errorLabel=$('#login-error');
 const originalLabel=submit.textContent;
 submit.disabled=true;submit.textContent='ログイン中…';errorLabel.textContent='';
 try{
  let adminData=null;
  if(demo){
   const saved=localStorage.getItem(authKey);
   if(saved&&saved!==localVerifier(pwd))throw Error('パスワードが違います');
   if(!saved)localStorage.setItem(authKey,localVerifier(pwd));
   token='demo';
  }else{
   // New GAS returns both token and admin data in a single response.
   // Old GAS ignores includeAdmin; retain the existing two-request fallback.
   const result=await api('login',{password:pwd,includeAdmin:true});
   if(!result?.token)throw Error('認証情報を取得できません');
   token=result.token;
   if(result.admin && typeof result.admin==='object' && Array.isArray(result.admin.cards) &&
       Array.isArray(result.admin.owned) && Array.isArray(result.admin.plans) &&
       result.admin.colors && typeof result.admin.colors==='object')adminData=result.admin;
  }
  if(!adminData){
   submit.textContent='データを読み込み中…';
   adminData=await api('admin',{},token);
  }
  db=S.sanitize(adminData);savedSnapshot=S.sanitize(db);
  tokenIssuedAt=Date.now();
  sessionStorage.setItem(adminTabPasswordKey,pwd);
  sessionStorage.setItem(adminTabTokenKey,token);
  dashboard();
 }catch(err){clearAdminSession();errorLabel.textContent=err.message;}
 finally{busy=false;if(submit.isConnected){submit.disabled=false;submit.textContent=originalLabel;}}
};
}
function dashboard(){
 S.theme('',db.colors);
 $('#app').innerHTML=`<header class="app-header"><div class="title-bar"><div class="header-inner"><strong class="app-title" id="admin-title">フレカ管理</strong><div class="header-actions"><span class="header-date" id="last-saved" aria-live="off"></span><button type="button" class="btn primary site-d-header-add" id="site-d-header-add">＋ フレカを追加</button><button class="hamburger" id="menu-toggle" type="button" aria-label="メニューを開く" aria-expanded="false"><svg class="hamburger-lines" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="2" y="5" width="20" height="2"/><rect x="2" y="11" width="20" height="2"/><rect x="2" y="17" width="20" height="2"/></svg></button></div></div></div></header><div class="menu-scrim" id="menu-scrim"></div><nav class="hamburger-panel" id="hamburger-panel" aria-label="管理メニュー"><a href="index.html">公開画面へ切替</a><button data-menu-screen="cards">フレカ管理</button><button data-menu-screen="colors">カラー設定</button><button id="logout">ログアウト</button></nav><button class="drawer-close" id="drawer-close" type="button" aria-label="メニューを閉じる" aria-hidden="true">×</button><div class="admin-shell"><div id="admin-content" class="animated-content"></div></div><div id="dialog-host"></div><div class="site-c-bulk-bar hidden" id="site-c-bulk-bar"><span id="site-c-bulk-count">0件選択中</span><button type="button" id="site-c-bulk-exec" class="btn danger">選択したカードを削除</button><button type="button" id="site-c-bulk-cancel" class="btn">キャンセル</button></div>`;
 const menuBtn=$('#menu-toggle'),drawerClose=$('#drawer-close');
 updateLastSaved();
 const positionClose=()=>{const r=menuBtn.getBoundingClientRect();Object.assign(drawerClose.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});};
 const toggle=open=>{
  if(open)positionClose();
  menuBtn.setAttribute('aria-expanded',String(open));
  $('#hamburger-panel').classList.toggle('is-open',open);$('#menu-scrim').classList.toggle('is-open',open);
  drawerClose.classList.toggle('is-open',open);drawerClose.setAttribute('aria-hidden',String(!open));
  if(open)drawerClose.focus({preventScroll:true});else menuBtn.focus({preventScroll:true});
 };
 window.addEventListener('resize',()=>{if($('#hamburger-panel').classList.contains('is-open'))positionClose();});
 $('#menu-toggle').onclick=()=>toggle(!$('#hamburger-panel').classList.contains('is-open'));
 $('#menu-scrim').onclick=()=>toggle(false);
 $('#drawer-close').onclick=()=>toggle(false);
 $$('[data-menu-screen]').forEach(b=>b.onclick=()=>{const screen=b.dataset.menuScreen;mode=screen==='cards'?'cards':'memo';memoTab=screen==='cards'?memoTab:screen;filter='';q='';toggle(false);draw();});
 $('#site-d-header-add').onclick=()=>{if(mode==='cards')openCardForm();};
 $('#site-c-bulk-exec').onclick=removeSelected;
 $('#site-c-bulk-cancel').onclick=()=>{bulkMode=false;selected.clear();draw();};
 $('#logout').onclick=()=>{if(pendingWrites){toast('保存処理が完了してからログアウトしてください');return;}bulkMode=false;selected.clear();clearAdminSession();loginScreen();};
 document.addEventListener('keydown',ev=>{if(ev.key==='Escape')toggle(false);});
 draw();
}
function updateLastSaved(){
 const el=$('#last-saved');if(!el)return;
 if(pendingWrites){el.textContent='保存中…';return;}
 const d=db.lastSavedAt?new Date(db.lastSavedAt):null;
 if(!d||!Number.isFinite(d.getTime())){el.textContent='保存:未記録';el.removeAttribute('title');return;}
 const parts=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d);
 const val=k=>parts.find(p=>p.type===k)?.value||'';
 const full=`${val('year')}/${val('month')}/${val('day')} ${val('hour')}:${val('minute')}`;
 el.textContent=`保存:${val('month')}/${val('day')} ${val('hour')}:${val('minute')}`;
 el.title=`最終保存: ${full}`;
}
// Writes are sent in the order the user made them. The UI is updated before awaiting GAS.
// On failure, cancel pending writes and restore the last confirmed state.
// Site E's GAS has no whole-database save action. Only color settings are local.
async function save(){
 try{
  if(S.isMigrated())await adminApi('saveColors',{colors:db.colors});
  db.colors=S.saveColors(db.colors);
  db.lastSavedAt=new Date().toISOString();
  updateLastSaved();
  return true;
 }catch(error){
  toast('カラー設定を保存できませんでした：'+error.message);
  return false;
 }
}
function filterbar(placeholder){return `<label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 5 5"/></svg><input id="search" type="search" placeholder="${esc(placeholder)}" autocomplete="off" value="${esc(q)}"></label>`;}
function charOptions(){return `<div class="character-filter" id="filter-row" aria-label="キャラクターを絞り込み"><button class="filter-pill filter-all ${!filter?'active':''}" data-filter="" style="${S.characterStyle('すべて',db.colors)}">すべて</button><div class="filter-scroll" tabindex="0" aria-label="左右にスクロールしてキャラクターを選択">${chars.map(c=>`<button class="filter-pill ${filter===c?'active':''}" data-filter="${esc(c)}" style="${S.characterStyle(c,db.colors)}">${esc(c)}</button>`).join('')}</div></div>`;}
function renderCards(){const rows=db.cards.filter(x=>(!filter||x.chara===filter)&&norm(x.code+' '+x.chara).includes(norm(q)));return `<div class="section-head"><h2>フレカ一覧 <small class="note">${rows.length}件</small></h2></div>${filterbar('コーデ名で検索')}${charOptions()}<div class="admin-card-grid">${rows.length?rows.map(x=>`<article class="admin-card ${x.visible===false?'site-c-unlisted':''} ${selected.has(String(x.id))?'site-c-selected':''}"><div class="admin-image" data-view-image="${esc(x.id)}">${cardImage(x.image_url,x.code)}${bulkMode?`<span class="site-c-select-indicator">${selected.has(String(x.id))?'✓':'選択'}</span>`:''} </div><div class="admin-card-body"><div class="admin-title">${esc(x.chara||'キャラ名未設定')}</div><div class="admin-sub">${esc(x.code||'コーデ名未設定')}${x.visible===false?' ・ 非公開':''}</div><div class="row"><button class="tiny-btn" data-edit="cards:${esc(x.id)}">編集</button><button class="tiny-btn" data-visibility="${esc(x.id)}">${x.visible===false?'公開する':'非公開にする'}</button><button class="tiny-btn danger" data-remove="cards:${esc(x.id)}">削除</button></div></div></article>`).join(''):'<div class="placeholder-panel">フレカがありません</div>'}</div>`;}
function ownershipRows(){const rows=[...db.owned.map(x=>({...x,source:'owned'})),...db.plans.filter(x=>x.done).map(x=>({...x,source:'plans'}))];const map=new Map();for(const x of rows){const k=norm(x.code)+'|'+x.chara;if(!map.has(k))map.set(k,x);else if(x.source==='owned')map.set(k,x);}return [...map.values()];}
function renderOwned(){
 const rows=ownershipRows().filter(x=>(!filter||x.chara===filter)&&norm(x.code).includes(norm(q)));
 const map=new Map();for(const x of rows){const key=norm(x.code);if(!map.has(key))map.set(key,{code:x.code,entries:[]});map.get(key).entries.push(x);}
 return `<div class="section-head"><h2>所持コーデ <small class="note">${map.size}コーデ</small></h2><button class="btn primary" data-new="owned-group">追加</button></div>${filterbar('所持コーデ名で検索')}${charOptions()}<div class="owned-grid">${map.size?[...map.values()].map(x=>`<article class="owned-card"><div class="owned-card-layout"><button type="button" class="owned-thumb" data-edit-group="${esc(x.code)}" aria-label="${esc(x.code)}の画像を編集">${db.ownedImages?.[norm(x.code)]?`<img ${db.ownedImages[norm(x.code)].startsWith('idb:')?`data-owned-original="${esc(db.ownedImages[norm(x.code)])}"`:`src="${esc(db.ownedImages[norm(x.code)])}"`} alt="${esc(x.code)}の画像" loading="lazy">`:'<span>画像なし</span>'}</button><div class="owned-info"><strong>${esc(x.code)}</strong><div class="note">作成済：${x.entries.length}人</div><div class="chip-row">${x.entries.sort((a,b)=>chars.indexOf(a.chara)-chars.indexOf(b.chara)).map(e=>`<span class="chip" style="${S.characterStyle(e.chara,db.colors)}">${esc(e.chara)}</span>`).join('')}</div><div class="row" style="margin-top:12px"><button class="tiny-btn" data-edit-group="${esc(x.code)}">編集</button><button class="tiny-btn danger" data-remove-group="${esc(x.code)}">削除</button></div></div></div></article>`).join(''):'<div class="placeholder-panel">所持コーデがありません</div>'}</div>`;}
function renderPlans(){const filteredChars=filter?[filter]:chars;let content='';for(const c of filteredChars){const rows=db.plans.filter(x=>x.chara===c);if(!rows.length)continue;let blocks='';for(let i=0;i<rows.length;i+=4){const slice=rows.slice(i,i+4).filter(x=>norm(x.code+' '+x.chara).includes(norm(q)));if(!slice.length)continue;blocks+=`<div class="plan-set"><div class="plan-set-head"><span>${Math.floor(i/4)+1}セット目</span></div>${slice.map(x=>`<div class="plan-item"><input type="checkbox" data-check="${esc(x.id)}" ${x.done?'checked':''} aria-label="${esc(x.code)}の印刷完了"><div class="plan-content"><div class="name">${esc(x.code)}</div>${x.note?`<div class="plan-note">${esc(x.note)}</div>`:''}</div><div class="plan-actions"><button class="tiny-btn" data-edit="plans:${esc(x.id)}">編集</button><button class="tiny-btn danger" data-remove="plans:${esc(x.id)}">削除</button></div></div>`).join('')}</div>`;}if(blocks)content+=`<div class="plan-heading">${esc(c)}の印刷予定</div>${blocks}`;}
return `<div class="section-head"><h2>印刷予定</h2><button class="btn primary" data-new="plans">追加</button></div>${filterbar('キャラ名かコーデ名を検索')}${charOptions()}${content||'<div class="placeholder-panel">印刷予定がありません</div>'}`;}
function renderColors(){
 const get=c=>S.colorSpec(db.colors[c],DEFAULT_COLORS[c]);
 return `<div class="section-head"><h2>キャラ別カラー設定</h2><button class="btn primary" id="save-colors">カラーを保存</button></div>
 <div class="color-grid">${['すべて',...chars].map(c=>{const t=get(c),color=S.colorInfo(t.first),mixed=S.themeBackground(t);return `<div class="color-card" data-color-name="${esc(c)}">
 <strong>${esc(c)}</strong><div class="color-mode"><label><input type="radio" name="color-mode-${esc(c)}" data-mode-color="${esc(c)}" value="solid" ${t.mode==='solid'?'checked':''}>単色</label><label><input type="radio" name="color-mode-${esc(c)}" data-mode-color="${esc(c)}" value="gradient" ${t.mode==='gradient'?'checked':''}>グラデーション</label></div>
 <div class="color-control"><input type="color" data-picker="${esc(c)}" data-stop="first" value="${esc(t.first)}"><input type="text" data-hex="${esc(c)}" data-stop="first" value="${esc(t.first)}" maxlength="7" aria-label="${esc(c)}のカラー1"></div>
 <div class="color-control second-color ${t.mode==='solid'?'hidden':''}"><input type="color" data-picker="${esc(c)}" data-stop="second" value="${esc(t.second)}"><input type="text" data-hex="${esc(c)}" data-stop="second" value="${esc(t.second)}" maxlength="7" aria-label="${esc(c)}のカラー2"></div>
 <div class="color-sample" style="--sample:${esc(mixed)};--sample-on:${S.colorInfo(t.mode==='gradient'?S.themeMain(t):t.first).on}">サンプル文字 Aa</div></div>`}).join('')}</div>`;
}
// Leave the horizontal filter element mounted during character selection.
// Recreating it resets the user's scroll position even if scrollLeft is later restored.
function setAdminContent(html,preserveFilter){
 const host=$('#admin-content');
 const current=preserveFilter?$('#filter-row',host):null;
 if(!current){host.innerHTML=html;return;}
 const template=document.createElement('template');
 template.innerHTML=html;
 const nextRow=template.content.querySelector('#filter-row');
 const newNodes=[...template.content.childNodes];
 const index=newNodes.indexOf(nextRow);
 if(index<0){host.innerHTML=html;return;}
 // Do not remove the current filter row from the document at any point.
 for(const node of [...host.childNodes])if(node!==current)node.remove();
 current.before(...newNodes.slice(0,index));
 current.after(...newNodes.slice(index+1));
 $$('[data-filter]',current).forEach(button=>{
  button.classList.toggle('active',button.dataset.filter===filter);
  button.style.cssText=S.characterStyle(button.dataset.filter||'すべて',db.colors);
 });
}
function draw(preserveFilter=false){
 if(!token)return;
 S.theme(filter,db.colors);
 $('#admin-title').textContent=mode==='cards'?'フレカ管理':'カラー設定';
 $('#site-d-header-add')?.classList.toggle('hidden',mode!=='cards');
 $$('[data-menu-screen]').forEach(b=>b.classList.toggle('selected',b.dataset.menuScreen===(mode==='cards'?'cards':'colors')));
 setAdminContent(mode==='cards'?renderCards():renderColors(),preserveFilter);
 const bulkBar=$('#site-c-bulk-bar');
 if(bulkBar){
  bulkBar.classList.toggle('hidden',!bulkMode||mode!=='cards');
  $('#site-c-bulk-count').textContent=selected.size+'件選択中';
 }
 const input=$('#search');if(input){
   let composing=false;
   const commit=()=>{const val=input.value;if(q===val)return;q=val;const caret=input.selectionStart??val.length;draw();const fresh=$('#search');if(fresh){fresh.focus({preventScroll:true});try{fresh.setSelectionRange(caret,caret)}catch(_){}}};
   input.addEventListener('compositionstart',()=>{composing=true;});
   input.addEventListener('compositionend',()=>{composing=false;requestAnimationFrame(commit);});
   input.addEventListener('input',e=>{if(composing||e.isComposing)return;commit();});
  }
 $$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;draw(true);});
 $$('[data-new]').forEach(b=>b.onclick=()=>b.dataset.new==='owned-group'?openOwnershipForm():openForm(b.dataset.new));
 $$('[data-edit-group]').forEach(b=>b.onclick=()=>openOwnershipForm(b.dataset.editGroup));
 $$('[data-remove-group]').forEach(b=>b.onclick=()=>removeOwnershipGroup(b.dataset.removeGroup));
 $$('[data-edit]').forEach(b=>b.onclick=()=>{const [type,id]=b.dataset.edit.split(':');openForm(type,id);});
 $$('[data-remove]').forEach(b=>b.onclick=()=>{const [type,id]=b.dataset.remove.split(':');remove(type,id);});
 $$('[data-visibility]').forEach(b=>b.onclick=()=>toggleVisibility(b.dataset.visibility));
 $$('[data-check]').forEach(b=>b.onchange=()=>{
  const x=db.plans.find(x=>x.id===b.dataset.check);if(!x)return;
  x.done=b.checked;
  b.closest('.plan-item')?.classList.add('just-checked');
  save('setPlanDone',{id:x.id,done:x.done});
 });
 $$('[data-view-image]').forEach(b=>b.onclick=()=>{const id=b.dataset.viewImage;if(bulkMode){if(selected.has(String(id)))selected.delete(String(id));else selected.add(String(id));draw();return;}const x=db.cards.find(x=>String(x.id)===String(id));if(x?.image_url)showImage(x.image_url);});
 hydrateOwnedImages($('#admin-content'));
 if(memoTab==='colors'&&mode==='memo')initColors();}
function showImage(url){$('#dialog-host').innerHTML=`<div class="overlay" id="picture-modal"><img src="${esc(url)}" alt="拡大画像"><button class="overlay-close" id="picture-close">×</button></div>`;$('#picture-close').onclick=()=>$('#dialog-host').innerHTML='';$('#picture-modal').onclick=e=>{if(e.target.id==='picture-modal')$('#dialog-host').innerHTML='';};}
function closeForm(){$('#dialog-host').innerHTML='';}
function openOwnershipForm(code=''){
 const existing=ownershipRows().filter(x=>norm(x.code)===norm(code));
 const checked=new Set(existing.map(x=>x.chara));
 let pendingImage=db.ownedImages?.[norm(code)]||'';
 let pendingFile=null,localPreviewURL='';
 const renderButton=c=>`<label class="ownership-option ${checked.has(c)?'chosen':''}" style="${S.characterStyle(c,db.colors)}"><input type="checkbox" value="${esc(c)}" ${checked.has(c)?'checked':''}><span>${esc(c)}</span></label>`;
 $('#dialog-host').innerHTML=`<div class="dialog-shade" id="dialog-shade"><section class="dialog ownership-dialog" role="dialog" aria-modal="true" aria-label="${code?'所持コーデ編集':'所持コーデ登録'}"><button class="dialog-x" id="dialog-close" type="button" aria-label="閉じる">×</button><form id="owned-entry-form"><label class="field">コーデ名<input id="owned-code" maxlength="120" placeholder="コーデ名を入力" required value="${esc(code)}"></label><div class="ownership-image-picker"><div id="owned-image-preview" class="ownership-image-preview"></div><div class="ownership-image-actions"><label class="tiny-btn ownership-file-label">画像を選択<input id="owned-image-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label><button type="button" id="owned-image-remove" class="tiny-btn">画像を削除</button></div></div><div class="ownership-options" role="group" aria-label="刷ったキャラクターを選択">${chars.map(renderButton).join('')}</div><div class="note ownership-count" id="ownership-count">作成済：${checked.size}人</div><div class="dialog-actions"><button class="btn primary" type="submit">保存する</button></div></form></section></div>`;
 const renderImage=async()=>{
  const area=$('#owned-image-preview');if(!area)return;
  const expected=pendingImage;
  const url=pendingFile?localPreviewURL:await ownedImageURL(expected);
  if(!area.isConnected||expected!==pendingImage)return;
  area.innerHTML=url?`<img src="${esc(url)}" alt="登録画像">`:'<span>画像なし</span>';
  $('#owned-image-remove').disabled=!pendingImage;
 };
 renderImage();
 $('#owned-image-file').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
   if(S.isDemo()){
    if(!file.type.startsWith('image/'))throw Error('画像ファイルを選択してください');
    if(file.size>30*1024*1024)throw Error('画像は30MB以下にしてください');
    if(localPreviewURL)URL.revokeObjectURL(localPreviewURL);
    localPreviewURL=URL.createObjectURL(file);
    pendingFile=file;
    pendingImage='idb:'+S.uuid();
   }else{
    pendingImage=await resizeOwnedImage(file);
    pendingFile=null;
   }
   renderImage();
  }catch(err){toast(err.message);}finally{event.target.value='';}
 };
 $('#owned-image-remove').onclick=()=>{pendingImage='';pendingFile=null;renderImage();};
 $('#dialog-close').onclick=closeForm;$('#dialog-shade').onclick=e=>{if(e.target.id==='dialog-shade')closeForm();};
 $$('.ownership-option input').forEach(input=>input.addEventListener('change',()=>{
   input.parentElement.classList.toggle('chosen',input.checked);$('#ownership-count').textContent='作成済：'+$$('.ownership-option input:checked').length+'人';
 }));
 $('#owned-code').focus();
 $('#owned-entry-form').onsubmit=async e=>{
   e.preventDefault();if(busy)return;
   const newCode=$('#owned-code').value.trim();const selected=new Set($$('.ownership-option input:checked').map(x=>x.value));
   if(!newCode||!selected.size){toast('キャラクターを1人以上選択してください');return;}
   const matched=norm(code), nextNorm=norm(newCode);
   // Avoid accidentally replacing another registered outfit with a rename.
   if(code&&nextNorm!==matched&&ownershipRows().some(x=>norm(x.code)===nextNorm)){toast('変更先のコーデ名は既に登録されています');return;}
   const backup=JSON.stringify(db);
   if(code){db.owned=db.owned.filter(x=>norm(x.code)!==matched);for(const plan of db.plans){if(norm(plan.code)===matched){plan.done=selected.has(plan.chara);if(plan.done)plan.code=newCode;}}}
   // For new outfit, an already completed plan already counts towards ownership.
   for(const c of selected){
     const alreadyPlan=db.plans.some(x=>norm(x.code)===nextNorm&&x.chara===c&&x.done);
     if(!alreadyPlan)db.owned.push({id:S.uuid(),code:newCode,chara:c});
   }
   const previousImage=db.ownedImages[matched]||'';
   if(code&&matched!==nextNorm)delete db.ownedImages[matched];
   if(pendingImage)db.ownedImages[nextNorm]=pendingImage;else delete db.ownedImages[nextNorm];
   try{
    if(pendingFile)await ownedBlobStore(pendingImage.slice(4),pendingFile);
    const pendingSave=save();
    closeForm();draw();
    if(previousImage&&previousImage!==pendingImage)pendingSave.then(ok=>{
     if(ok)ownedBlobDelete(previousImage).catch(console.warn);
    });
   }catch(err){db=S.sanitize(JSON.parse(backup));toast('画像の保存に失敗しました: '+err.message);}
 };
}
async function removeOwnershipGroup(code){
 if(!confirm(`「${code}」の所持登録を削除しますか？（このコーデの印刷予定の完了チェックも解除します）`))return;
 const backup=JSON.stringify(db);
 db.owned=db.owned.filter(x=>norm(x.code)!==norm(code));
 db.plans.forEach(x=>{if(norm(x.code)===norm(code))x.done=false;});
 const previousImage=db.ownedImages[norm(code)]||'';
 delete db.ownedImages[norm(code)];
 const pendingSave=save();draw();if(previousImage)pendingSave.then(ok=>{if(ok)ownedBlobDelete(previousImage).catch(console.warn);});
}
function openForm(type,id=''){
 if(type==='cards'){openCardForm(id);return;}
 editing={type,id};const source=db[type],row=source.find(x=>x.id===id),isPlan=type==='plans';
 $('#dialog-host').innerHTML=`<div class="dialog-shade" id="dialog-shade"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="row between dialog-heading"><h2 id="dialog-title">${id?'編集':'追加'}</h2><button class="dialog-x" id="dialog-close" type="button" aria-label="閉じる">×</button></div><form id="entry-form"><label class="field">コーデ名<input id="entry-code" maxlength="120" placeholder="コーデ名" required value="${esc(row?.code||'')}"></label><label class="field">マイキャラ<select id="entry-chara">${chars.map(c=>`<option value="${esc(c)}" ${c===(row?.chara||filter||chars[0])?'selected':''}>${esc(c)}</option>`).join('')}</select></label>${isPlan?`<label class="field">メモ<textarea id="entry-note" maxlength="600" rows="3" placeholder="メモ">${esc(row?.note||'')}</textarea></label>`:''}<div class="dialog-actions"><button class="btn primary" type="submit">保存</button></div></form></section></div>`;
 $('#dialog-close').onclick=closeForm;$('#dialog-shade').onclick=e=>{if(e.target.id==='dialog-shade')closeForm();};$('#entry-code').focus();
 $('#entry-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const code=$('#entry-code').value.trim(),chara=$('#entry-chara').value;if(!code||!chars.includes(chara))return;
 const item={id:row?.id||uuid(),code,chara};if(isPlan){item.note=$('#entry-note').value.trim();item.done=row?.done||false;}
 const backup=JSON.stringify(db);if(row)Object.assign(row,item);else source.push(item);
 save(isPlan?'upsertPlan':'save',isPlan?{plan:item}:{});closeForm();draw();};
}
// The Site E GAS creates a card on upload, then changes its labels via update.
// Never use Site D's whole-database save on Site E.
function openCardForm(id=''){
 if(pendingWrites){toast('保存処理が完了してから操作してください');return;}
 const old=db.cards.find(x=>String(x.id)===String(id));
 const single=Boolean(old);
 let rows=single?[{key:uuid(),id:old.id,code:old.code,chara:old.chara,image:old.image_url}]:[];
 let submitting=false;
 const objectUrls=new Set();
 const closeCard=()=>{
  if(submitting)return;
  for(const url of objectUrls)URL.revokeObjectURL(url);
  objectUrls.clear();
  closeForm();
 };
 const host=$('#dialog-host');
 host.innerHTML='<div class="dialog-shade" id="dialog-shade">'+
  '<section class="dialog card-entry-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">'+
  '<div class="row between dialog-heading"><h2 id="dialog-title">'+(single?'フレカを編集':'フレカを追加')+
  '</h2><button class="dialog-x" id="dialog-close" type="button" aria-label="閉じる">×</button></div>'+
  '<form id="card-form">'+
  (single?(S.isMigrated()?'<p class="note">キャラ名・コーデ名・画像を編集できます。</p><label class="site-c-replace-image">画像を差し替える<input id="site-c-replace-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>':'<p class="note">キャラ名とコーデ名を編集できます。</p>'):
   '<div class="card-upload-zone" id="upload-zone" role="button" tabindex="0">'+
   '<span class="upload-symbol">＋</span><strong>画像を選択</strong>'+
   '<span class="upload-hint">またはここにドロップ</span></div>'+
   '<input type="file" id="card-files" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>')+
  '<div id="upload-entries" class="upload-entries"></div>'+
  '<div class="dialog-actions" id="card-submit-actions">'+
  '<button class="btn primary" type="submit">保存</button></div>'+
  '</form></section></div>';
 function paint(){
  const area=$('#upload-entries');
  area.innerHTML=rows.map((row,i)=>{
   const img=row.image?'<img src="'+esc(row.image)+'" alt="画像プレビュー">':'<span>画像なし</span>';
   return '<div class="upload-entry" data-entry="'+esc(row.key)+'">'+
    '<div class="upload-thumb">'+img+'</div>'+
    '<div class="upload-fields">'+
    '<input type="text" data-code="'+esc(row.key)+'" value="'+esc(row.code)+'" maxlength="120" placeholder="コーデ名" aria-label="'+(i+1)+'件目のコーデ名" required>'+
    '<select data-chara="'+esc(row.key)+'" aria-label="'+(i+1)+'件目のキャラ名">'+
    '<option value="" '+(!row.chara?'selected':'')+' disabled>キャラ名を選択</option>'+
    chars.map(c=>'<option value="'+esc(c)+'" '+(c===row.chara?'selected':'')+'>'+esc(c)+'</option>').join('')+
    '</select></div>'+
    (!single?'<button type="button" class="upload-remove" data-remove-entry="'+esc(row.key)+'" aria-label="画像を一覧から外す">×</button>':'')+
    '</div>';
  }).join('');
  $('#card-submit-actions').classList.toggle('hidden',rows.length===0);
  $$('[data-code]',host).forEach(input=>input.addEventListener('input',()=>{
   const row=rows.find(x=>x.key===input.dataset.code);if(row)row.code=input.value;
  }));
  $$('[data-chara]',host).forEach(input=>input.addEventListener('change',()=>{
   const row=rows.find(x=>x.key===input.dataset.chara);if(row)row.chara=input.value;
  }));
  $$('[data-remove-entry]',host).forEach(button=>button.onclick=()=>{
   const row=rows.find(x=>x.key===button.dataset.removeEntry);
   if(row&&objectUrls.has(row.image)){URL.revokeObjectURL(row.image);objectUrls.delete(row.image);}
   rows=rows.filter(x=>x!==row);
   paint();
  });
 }
 if(single&&S.isMigrated()){
  $('#site-c-replace-file').onchange=event=>{
   const file=event.target.files?.[0];if(!file)return;
   if(!file.type.startsWith('image/')){toast('画像ファイルを選択してください');return;}
   if(file.size>16*1024*1024){toast('画像は16MB以下にしてください');return;}
   if(objectUrls.has(rows[0].image)){URL.revokeObjectURL(rows[0].image);objectUrls.delete(rows[0].image);}
   const preview=URL.createObjectURL(file);objectUrls.add(preview);
   rows[0].image=preview;rows[0].file=file;paint();
  };
 }
 if(!single){
  const zone=$('#upload-zone');
  const addFiles=files=>{
   for(const file of [...files]){
    if(!file.type.startsWith('image/')){toast('画像ファイルを選択してください');continue;}
    const url=URL.createObjectURL(file);
    objectUrls.add(url);
    rows.push({key:uuid(),id:'',code:'',chara:filter||'',image:url,file});
   }
   paint();
   $('#upload-entries [data-code]')?.focus();
  };
  zone.onclick=()=>$('#card-files').click();
  zone.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('#card-files').click();}};
  zone.ondragover=event=>{event.preventDefault();zone.classList.add('dragging');};
  zone.ondragleave=()=>zone.classList.remove('dragging');
  zone.ondrop=event=>{event.preventDefault();zone.classList.remove('dragging');addFiles(event.dataTransfer.files);};
  $('#card-files').onchange=event=>{addFiles(event.target.files);event.target.value='';};
 }
 $('#dialog-close').onclick=closeCard;
 $('#dialog-shade').onclick=event=>{if(event.target.id==='dialog-shade')closeCard();};
 $('#card-form').onsubmit=async event=>{
  event.preventDefault();
  if(submitting||pendingWrites)return;
  const valid=rows.map(x=>({...x,code:String(x.code||'').trim()}));
  if(!valid.length){toast('画像を追加してください');return;}
  if(valid.some(x=>!x.code||!chars.includes(x.chara))){
   toast('コーデ名とキャラ名を指定してください');return;
  }
  submitting=true;pendingWrites++;updateLastSaved();
  const button=$('#card-submit-actions button[type="submit"]');
  button.disabled=true;
  const errorList=[];
  let successes=0;
  try{
   if(single){
    const row=valid[0];
    await adminApi('update',{id:old.id,chara:row.chara,code:row.code});
    old.code=row.code;old.chara=row.chara;
    if(row.file&&S.isMigrated()){
     button.textContent='画像を差し替え中…';
     const dataUrl=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onerror=()=>reject(Error('画像を読み込めません'));
      reader.onload=()=>resolve(String(reader.result||''));reader.readAsDataURL(row.file);
     });
     const image=await adminApi('replaceImage',{id:old.id,filename:row.file.name,
       mimeType:row.file.type,data:dataUrl});
     old.image_url=image.url;
    }
    successes=1;
   }else{
    for(const [i,row] of valid.entries()){
     button.textContent='アップロード中 '+(i+1)+'/'+valid.length;
     try{
      const dataUrl=await new Promise((resolve,reject)=>{
       const reader=new FileReader();
       reader.onerror=()=>reject(Error('ファイルを読み込めません'));
       reader.onload=()=>resolve(String(reader.result||''));
       reader.readAsDataURL(row.file);
      });
      const added=await adminApi('upload',{
       filename:row.file.name,mimeType:row.file.type||'image/png',data:dataUrl
      });
      db.cards.unshift(added);
      // The upload already exists remotely. Keep it in the list if update fails.
      await adminApi('update',{id:added.id,chara:row.chara,code:row.code});
      added.chara=row.chara;added.code=row.code;
      successes++;
     }catch(error){errorList.push((i+1)+'件目: '+error.message);}
    }
   }
   markChanged();draw();
   if(!errorList.length){
    submitting=false;
    closeCard();
    toast(single?'保存しました':successes+'件追加しました');
   }else{
    alert('一部の処理に失敗しました。保存済みのフレカは一覧から確認してください。\n'+errorList.join('\n'));
    // Re-fetch cards because an uploaded image may have been saved even if labels failed.
    try{
     const state=await adminApi('admin');
     db.cards=state.cards;
     draw();
    }catch(_){}
    submitting=false;closeCard();
   }
  }catch(error){
   alert('保存に失敗しました：'+error.message);
   try{const state=await adminApi('admin');db.cards=state.cards;draw();}catch(_){}
  }finally{
   submitting=false;pendingWrites--;updateLastSaved();
   if(button.isConnected){button.disabled=false;button.textContent='保存';}
  }
 };
 paint();
}
async function resizeOwnedImage(file){
 if(!file.type.startsWith('image/'))throw Error('画像ファイルを選択してください');
 if(file.size>16*1024*1024)throw Error('画像は16MB以下にしてください');
 return await new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onerror=()=>reject(Error('画像を読み込めません'));
  reader.onload=()=>{
   const image=new Image();image.onerror=()=>reject(Error('画像形式を確認してください'));
   image.onload=()=>{
    try{
     // GAS/Sheets stores only a thumbnail; keep PNG transparency, never fill white.
     const canvas=document.createElement('canvas');
     let longest=Math.min(320,Math.max(image.width,image.height));
     let result='';
     while(longest>=24){
      const ratio=Math.min(1,longest/Math.max(image.width,image.height));
      canvas.width=Math.max(1,Math.round(image.width*ratio));
      canvas.height=Math.max(1,Math.round(image.height*ratio));
      canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      result=canvas.toDataURL('image/png');
      if(result.length<=36000){resolve(result);return;}
      longest=Math.floor(longest*.82);
     }
     reject(Error('画像が大きすぎます。GASでは透過PNGの小さいサムネイルのみ保存できます'));
    }catch(err){reject(err);}
   };image.src=reader.result;
  };reader.readAsDataURL(file);
 });
}
async function resize(file){if(!file.type.startsWith('image/'))throw Error('画像を指定してください');if(file.size>16*1024*1024)throw Error('画像は16MB以下にしてください');return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(Error('画像を読み込めません'));r.onload=()=>{const image=new Image();image.onerror=()=>reject(Error('画像形式が不正です'));image.onload=()=>{const canvas=document.createElement('canvas');const ratio=Math.min(1,900/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',.76));};image.src=r.result;};r.readAsDataURL(file);});}
async function remove(type,id){
 if(type!=='cards'||pendingWrites)return;
 const card=db.cards.find(x=>String(x.id)===String(id));
 if(!card||!confirm('「'+(card.code||'このフレカ')+'」を削除しますか？'))return;
 pendingWrites++;updateLastSaved();
 try{
  await adminApi('delete',{id:card.id});
  db.cards=db.cards.filter(x=>String(x.id)!==String(id));
  selected.delete(String(id));
  markChanged();draw();toast('削除しました');
 }catch(error){alert('削除に失敗しました：'+error.message);}
 finally{pendingWrites--;updateLastSaved();}
}
async function toggleVisibility(id){
 if(pendingWrites)return;
 const card=db.cards.find(x=>String(x.id)===String(id));
 if(!card)return;
 const next=card.visible===false;
 pendingWrites++;updateLastSaved();
 try{
  await adminApi('visibility',{id:card.id,visible:String(next)});
  card.visible=next;markChanged();draw();
  toast(next?'公開しました':'非公開にしました');
 }catch(error){alert('公開状態の変更に失敗しました：'+error.message);}
 finally{pendingWrites--;updateLastSaved();}
}
async function removeSelected(){
 if(!bulkMode||!selected.size||pendingWrites)return;
 if(!confirm(selected.size+'件のフレカを削除しますか？'))return;
 pendingWrites++;updateLastSaved();
 const failures=[];
 try{
  for(const id of [...selected]){
   try{
    await adminApi('delete',{id});
    db.cards=db.cards.filter(x=>String(x.id)!==String(id));
    selected.delete(id);
   }catch(error){failures.push(String(id)+': '+error.message);}
  }
  if(!failures.length){bulkMode=false;selected.clear();toast('削除しました');}
  else alert('一部を削除できませんでした：'+failures.join('、'));
  markChanged();draw();
 }finally{pendingWrites--;updateLastSaved();}
}
function markChanged(){
 db.lastCardsUpdated=new Date().toISOString();
 db.lastSavedAt=db.lastCardsUpdated;
}
function initColors(){
 const pending=JSON.parse(JSON.stringify(db.colors));
 const get=c=>S.colorSpec(pending[c],DEFAULT_COLORS[c]);
 function preview(wrap,c){
  const t=get(c);pending[c]=t;
  $('.second-color',wrap).classList.toggle('hidden',t.mode!=='gradient');
  const sample=$('.color-sample',wrap);
  sample.style.setProperty('--sample',S.themeBackground(t));
  // Approximate average brightness for gradient text.
  const a=S.colorInfo(t.first),b=S.colorInfo(t.second);
  sample.style.setProperty('--sample-on',t.mode==='solid'?a.on:(a.on===b.on?a.on:'#171717'));
 }
 $$('[data-mode-color]').forEach(el=>el.onchange=()=>{
  const c=el.dataset.modeColor,t=get(c);t.mode=el.value;pending[c]=t;preview(el.closest('.color-card'),c);
 });
 $$('[data-picker]').forEach(el=>el.oninput=()=>{
  const c=el.dataset.picker,t=get(c);t[el.dataset.stop]=el.value;pending[c]=t;
  const wrap=el.closest('.color-card');$(`[data-hex][data-stop="${el.dataset.stop}"]`,wrap).value=el.value;preview(wrap,c);
 });
 $$('[data-hex]').forEach(el=>el.oninput=()=>{
  const hex=cleanColor(el.value);if(!hex)return;
  const c=el.dataset.hex,t=get(c);t[el.dataset.stop]=hex;pending[c]=t;
  const wrap=el.closest('.color-card');$(`[data-picker][data-stop="${el.dataset.stop}"]`,wrap).value=hex;preview(wrap,c);
 });
 $('#save-colors').onclick=async()=>{
  for(const el of $$('[data-hex]'))if(!cleanColor(el.value)){toast('カラーコードは #RRGGBB で入力してください');el.focus();return;}
  const beforeColors=JSON.parse(JSON.stringify(db.colors));
  db.colors=pending;
  S.theme('',db.colors);draw();
  const ok=await save();
  if(ok)toast(S.isMigrated()?'カラー設定を保存しました':'このブラウザにカラー設定を保存しました');
  else{db.colors=beforeColors;S.theme('',db.colors);draw();}
 };
}
if(S.isDemo() && /^https?:$/.test(location.protocol) && !['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
 $('#app').innerHTML='<main class="auth-screen"><div class="login-panel"><h1>管理画面の準備中</h1><p class="note">GAS接続が未設定です。管理機能を公開する前にバックエンドの認証と保存先を設定してください。</p><p><a href="index.html">公開画面へ戻る</a></p></div></main>';
} else {
 restoreAdminTab();
}
})();
