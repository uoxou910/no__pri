/**
 * Site E standalone GAS backend — 3 characters: そると, みりん, すう.
 * This copy is independent of Site C; the spreadsheet and image folder IDs
 * below are new and contain no existing Site C card data.
 *
 * SETUP: Create a NEW Apps Script project (do not add this to Site C's GAS).
 * Paste this entire file into Code.gs.
 * Script Properties: ADMIN_PASSWORD = a password with 4+ characters.
 * Deploy as Web App: execute as yourself, access anyone.
 * Put the new /exec URL in site-e/assets/config.js.
 *
 * SPREADSHEET_ID and IMAGE_FOLDER_ID properties are optional; without them
 * this script uses E_DEFAULT_SPREADSHEET_ID and E_DEFAULT_IMAGE_FOLDER_ID.
 */
const E_DEFAULT_SPREADSHEET_ID='1hTNcgDR9k0bq8XBjFeERsyUipnyJ12jb1k6vbU6De9s';
const E_DEFAULT_IMAGE_FOLDER_ID='1n663feKRACZhnyl-jDrx7Fwss4D31ZXb';
const E_CARD_TAB='siteD_cards';
const E_COLOR_TAB='siteD_colors';
const E_CARDS=['id','code','chara','image_url','updated_at','visible','file_id','created_at'];
const E_COLORS=['character','mode','first','second'];
const E_CHARACTERS=['そると','みりん','すう'];
const E_DEFAULT_COLORS={
 'すべて':['gradient','#ef9fc3','#8fd3e9'],
 'そると':['gradient','#ef9fc3','#c5edfa'],
 'みりん':['gradient','#fbb8ca','#fafdd8'],
 'すう':['gradient','#ef857d','#f6bad5']
};
const E_MAX_UPLOAD_BYTES=16*1024*1024;
const E_TOKEN_TTL_SECONDS=3600;

function cProperties_(){return PropertiesService.getScriptProperties();}
function cSpreadsheet_(){
 const id=cProperties_().getProperty('SPREADSHEET_ID')||E_DEFAULT_SPREADSHEET_ID;
 if(id)return SpreadsheetApp.openById(id);
 const active=SpreadsheetApp.getActiveSpreadsheet();
 if(!active)throw Error('SPREADSHEET_ID をスクリプトプロパティに設定してください');
 return active;
}
function cTab_(name,headers){
 const sheet=cSpreadsheet_().getSheetByName(name);
 if(!sheet)throw Error(name+' シートが見つかりません');
 const actual=sheet.getRange(1,1,1,headers.length).getDisplayValues()[0];
 if(headers.some((v,i)=>actual[i]!==v))
  throw Error(name+' の列見出しが異なります。移行先スプレッドシートを確認してください');
 return sheet;
}
function cBool_(value){
 return value===true||String(value).trim().toLowerCase()==='true'||String(value).trim()==='1';
}
function cCleanString_(value){return String(value==null?'':value);}
function cRows_(sheet,width){
 const last=sheet.getLastRow();
 return last<2?[]:sheet.getRange(2,1,last-1,width).getDisplayValues()
  .filter(row=>row.some(value=>String(value).trim()!==''));
}
function cReadCards_(){
 const sheet=cTab_(E_CARD_TAB,E_CARDS);
 return cRows_(sheet,E_CARDS.length).map(row=>({
  id:row[0],code:row[1],chara:row[2],image_url:row[3],
  updated_at:row[4],visible:cBool_(row[5]),file_id:row[6],
  created_at:row[7]
 })).filter(row=>row.id);
}
function cReadColors_(){
 const sheet=cTab_(E_COLOR_TAB,E_COLORS);
 const result={};
 Object.keys(E_DEFAULT_COLORS).forEach(name=>{
  const defaults=E_DEFAULT_COLORS[name];
  result[name]={mode:defaults[0],first:defaults[1],second:defaults[2]};
 });
 cRows_(sheet,4).forEach(row=>{
  if(!(row[0] in result))return;
  const spec=cValidateColor_({mode:row[1],first:row[2],second:row[3]},result[row[0]]);
  result[row[0]]=spec;
 });
 return result;
}
function cValidateColor_(value,fallback){
 const mode=value&&value.mode==='gradient'?'gradient':'solid';
 const hex=x=>/^#[0-9a-f]{6}$/i.test(String(x||''))?String(x).toLowerCase():null;
 return {
  mode,first:hex(value&&value.first)||fallback.first,
  second:hex(value&&value.second)||hex(value&&value.first)||fallback.second
 };
}
function cPublicData_(){
 const cards=cReadCards_().filter(card=>card.visible);
 const colors=cReadColors_();
 const updated=cards.map(x=>x.updated_at||x.created_at).filter(Boolean).sort().pop()||'';
 return {cards:cards.map(c=>({
  id:c.id,code:c.code,chara:c.chara,image_url:c.image_url,
  updated_at:c.updated_at,created_at:c.created_at,visible:true
 })),colors,lastCardsUpdated:updated};
}
function cAdminData_(){
 const cards=cReadCards_();
 return {
  cards,colors:cReadColors_(),owned:[],ownedImages:{},plans:[],
  lastCardsUpdated:cards.map(x=>x.updated_at||x.created_at).filter(Boolean).sort().pop()||''
 };
}
function cPassword_(){
 const value=cProperties_().getProperty('ADMIN_PASSWORD');
 if(!value||value.length<4)throw Error('ADMIN_PASSWORD が設定されていません');
 return value;
}
function cLogin_(password,includeAdmin){
 if(String(password)!==cPassword_())throw Error('パスワードが違います');
 const token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
 CacheService.getScriptCache().put('site_e_session_'+token,'1',E_TOKEN_TTL_SECONDS);
 const result={token,expiresIn:E_TOKEN_TTL_SECONDS};
 if(includeAdmin)result.admin=cAdminData_();
 return result;
}
function cCheckToken_(token){
 if(!token||CacheService.getScriptCache().get('site_e_session_'+String(token))!=='1')
  throw Error('認証の期限が切れました。再ログインしてください');
}
function cCheckLegacyPassword_(password){
 if(String(password)!==cPassword_())throw Error('パスワードが違います');
}
function cWithLock_(fn){
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(30000))throw Error('別の保存処理が実行中です');
 try{return fn();}
 finally{lock.releaseLock();}
}
function cValidateName_(data){
 const chara=cCleanString_(data.chara).trim();
 const code=cCleanString_(data.code).trim();
 if(!E_CHARACTERS.includes(chara))throw Error('キャラ名が不正です');
 if(!code||code.length>120)throw Error('コーデ名を1〜120文字で指定してください');
 return {code,chara};
}
function cFindRow_(sheet,id){
 const last=sheet.getLastRow();
 if(last<2)return 0;
 const ids=sheet.getRange(2,1,last-1,1).getDisplayValues();
 const index=ids.findIndex(row=>row[0]===String(id));
 if(index<0)throw Error('フレカが見つかりません');
 return index+2;
}
function cUpdateCard_(payload){
 return cWithLock_(()=>{
  const sheet=cTab_(E_CARD_TAB,E_CARDS),row=cFindRow_(sheet,payload.id);
  const names=cValidateName_(payload);
  sheet.getRange(row,2,1,3).setValues([[names.code,names.chara,
   sheet.getRange(row,4).getDisplayValue()]]);
  sheet.getRange(row,5).setValue(new Date().toISOString());
  return {ok:true};
 });
}
function cVisibility_(payload){
 return cWithLock_(()=>{
  const sheet=cTab_(E_CARD_TAB,E_CARDS),row=cFindRow_(sheet,payload.id);
  sheet.getRange(row,6).setValue(cBool_(payload.visible)?'TRUE':'FALSE');
  sheet.getRange(row,5).setValue(new Date().toISOString());
  return {ok:true};
 });
}
function cDelete_(payload){
 return cWithLock_(()=>{
  const sheet=cTab_(E_CARD_TAB,E_CARDS),row=cFindRow_(sheet,payload.id);
  // Never delete the Drive image: old files can be needed by backups.
  sheet.deleteRow(row);
  return {ok:true};
 });
}
function cMime_(value){
 const mime=String(value||'');
 if(!['image/png','image/jpeg','image/webp','image/gif'].includes(mime))
  throw Error('PNG、JPEG、WebP、GIFのみアップロードできます');
 return mime;
}
function cImageFolder_(){
 const folderId=cProperties_().getProperty('IMAGE_FOLDER_ID')||E_DEFAULT_IMAGE_FOLDER_ID;
 if(!folderId)throw Error('IMAGE_FOLDER_ID が設定されていません');
 return DriveApp.getFolderById(folderId);
}
function cUploadBlob_(filename,mimeType,data){
 const mime=cMime_(mimeType);
 let raw=String(data||'');
 raw=raw.replace(/^data:[^,]+,/,'');
 if(raw.length>E_MAX_UPLOAD_BYTES*1.4)throw Error('画像が大きすぎます');
 const bytes=Utilities.base64Decode(raw);
 if(bytes.length>E_MAX_UPLOAD_BYTES)throw Error('画像は16MB以下にしてください');
 const file=cImageFolder_().createFile(Utilities.newBlob(bytes,mime,
  String(filename||'freca-image').slice(0,180)));
 file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
 return {file_id:file.getId(),image_url:'https://drive.google.com/uc?export=view&id='+file.getId()};
}
function cUpload_(payload){
 // Upload to Drive first, then append one row. Old data remains unchanged on failure.
 const image=cUploadBlob_(payload.filename,payload.mimeType,
   payload.base64||payload.data);
 return cWithLock_(()=>{
  const sheet=cTab_(E_CARD_TAB,E_CARDS),now=new Date().toISOString();
  const names=cValidateName_({chara:payload.chara||E_CHARACTERS[0],code:payload.code||'新規フレカ'});
  const card={id:Utilities.getUuid(),code:names.code,chara:names.chara,
   image_url:image.image_url,updated_at:now,visible:true,
   file_id:image.file_id,created_at:now};
  sheet.appendRow(E_CARDS.map(key=>key==='visible'?'TRUE':String(card[key]||'')));
  return card;
 });
}
function cReplaceImage_(payload){
 const image=cUploadBlob_(payload.filename,payload.mimeType,
   payload.base64||payload.data);
 return cWithLock_(()=>{
  const sheet=cTab_(E_CARD_TAB,E_CARDS),row=cFindRow_(sheet,payload.id);
  sheet.getRange(row,4).setValue(image.image_url);
  sheet.getRange(row,7).setValue(image.file_id);
  sheet.getRange(row,5).setValue(new Date().toISOString());
  return {ok:true,url:image.image_url,file_id:image.file_id};
 });
}
function cSaveColors_(payload){
 return cWithLock_(()=>{
  const sheet=cTab_(E_COLOR_TAB,E_COLORS),input=payload.colors||{};
  const present=cReadColors_(),keys=Object.keys(E_DEFAULT_COLORS);
  const rows=keys.map(key=>{
   const value=cValidateColor_(input[key]||present[key],present[key]);
   return [key,value.mode,value.first,value.second];
  });
  sheet.getRange(2,1,rows.length,4).setValues(rows);
  return {ok:true,colors:cReadColors_()};
 });
}
function cHandle_(action,data,legacy){
 const isLegacy=!!legacy;
 if(action==='public')return cPublicData_();
 if(action==='list')return {ok:true,cards:cPublicData_().cards};
 if(action==='login')return cLogin_(data.password,data.includeAdmin===true||String(data.includeAdmin)==='true');
 if(isLegacy)cCheckLegacyPassword_(data.password);
 else cCheckToken_(data.token);
 if(action==='auth')return {ok:true};
 if(action==='admin'||action==='adminList'){
  const admin=cAdminData_();
  return isLegacy?{ok:true,cards:admin.cards}:admin;
 }
 if(action==='update')return cUpdateCard_(data);
 if(action==='visibility')return cVisibility_(data);
 if(action==='delete')return cDelete_(data);
 if(action==='upload' || action==='uploadImage'){
  const card=cUpload_(data);
  return action==='upload'?{ok:true,card}:{url:card.image_url,card};
 }
 if(action==='replaceImage')return cReplaceImage_(data);
 if(action==='saveColors')return cSaveColors_(data);
 throw Error('未対応の操作: '+action);
}
function cRespond_(result){
 return ContentService.createTextOutput(JSON.stringify({ok:true,data:result}))
  .setMimeType(ContentService.MimeType.JSON);
}
function cError_(error){
 return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(error&&error.message||error)}))
  .setMimeType(ContentService.MimeType.JSON);
}
function doGet(e){
 try{
  const action=String(e&&e.parameter&&e.parameter.action||'public');
  if(action!=='public'&&action!=='list')throw Error('この操作はPOSTのみ対応です');
  const result=cHandle_(action,{},true);
  // Legacy C 'list' expects top-level cards; modern D returns nested data.
  if(action==='list')return ContentService.createTextOutput(JSON.stringify(result))
   .setMimeType(ContentService.MimeType.JSON);
  return cRespond_(result);
 }catch(error){return cError_(error);}
}
function doPost(e){
 try{
  const payload=String(e&&e.postData&&e.postData.contents||'').trim();
  let data={},legacy=false;
  if(payload.startsWith('{')){
   data=JSON.parse(payload);
  }else{
   legacy=true;
   data=Object.assign({},e&&e.parameter||{});
  }
  const action=String(data.action||'');
  if(!action)throw Error('操作名がありません');
  const result=cHandle_(action,data,legacy);
  if(legacy)return ContentService.createTextOutput(JSON.stringify({ok:true,...result}))
   .setMimeType(ContentService.MimeType.JSON);
  return cRespond_(result);
 }catch(error){return cError_(error);}
}
