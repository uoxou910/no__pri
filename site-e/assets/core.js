(()=>{'use strict';
const groups=[['そると','みりん','すう']];const chars=groups.flat();
const DEFAULT_COLORS={
 'すべて':{mode:'gradient',first:'#ef9fc3',second:'#8fd3e9'},
 'そると':{mode:'gradient',first:'#ef9fc3',second:'#c5edfa'},
 'みりん':{mode:'gradient',first:'#fbb8ca',second:'#fafdd8'},
 'すう':{mode:'gradient',first:'#ef857d',second:'#f6bad5'}
};
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const norm=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).trim();
const uuid=()=>crypto?.randomUUID?.()||('id-'+Date.now()+'-'+Math.random().toString(36).slice(2));
const cleanColor=s=>/^#[a-f\d]{6}$/i.test(String(s))?s.toLowerCase():null;
function colorSpec(value,fallback='#eaa1bf'){
 const legacy=cleanColor(value),obj=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const first=legacy||cleanColor(obj.first)||cleanColor(obj.hex)||cleanColor(fallback?.first)||cleanColor(fallback)||'#eaa1bf';
 const second=cleanColor(obj.second)||(obj.mode==='gradient'&&cleanColor(fallback?.second))||first;
 return {mode:obj.mode==='gradient'?'gradient':'solid',first,second};
}
function themeBackground(value,fallback){
 const t=colorSpec(value,fallback);
 return t.mode==='gradient'?`linear-gradient(110deg, ${t.first}, ${t.second})`:t.first;
}
function themeMain(value,fallback){return colorSpec(value,fallback).first;}

const validChara=s=>chars.includes(s);
// Site E uses an independent D-compatible GAS backend.
const C=window.FRECA_CONFIG||{};
const COLOR_KEY='freca_E_colors_v1';
const CACHE_KEY='freca_E_public_cards_v1';
const isDemo=()=>!String(C.gasUrl||'').trim();
function readColors(){
 try{
  const obj=JSON.parse(localStorage.getItem(COLOR_KEY)||'null');
  if(obj&&typeof obj==='object'){
   const colors={...DEFAULT_COLORS};
   for(const key of Object.keys(DEFAULT_COLORS))
    if(Object.prototype.hasOwnProperty.call(obj,key))colors[key]=colorSpec(obj[key],DEFAULT_COLORS[key]);
   return colors;
  }
 }catch(_){}
 return {...DEFAULT_COLORS};
}
function saveColors(colors){
 const out={};
 for(const key of Object.keys(DEFAULT_COLORS))out[key]=colorSpec(colors[key],DEFAULT_COLORS[key]);
 localStorage.setItem(COLOR_KEY,JSON.stringify(out));
 return out;
}
async function request(action,params={},password=''){
 if(isDemo())throw Error('サイトEのGAS接続が設定されていません');
 const url=C.gasUrl;
 let response;
 if(action==='list'){
  response=await fetch(url+(url.includes('?')?'&':'?')+'action=list&_ts='+Date.now(),{redirect:'follow',cache:'no-store'});
 }else{
  const body=new URLSearchParams({action,password,...params});
  response=await fetch(url,{method:'POST',body,redirect:'follow'});
 }
 if(!response.ok)throw Error('通信エラー: '+response.status);
 const data=await response.json();
 if(data.ok===false)throw Error(data.error||'処理に失敗しました');
 return data;
}
function normalizeCard(card){
 if(!card||typeof card!=='object')return null;
 return {...card,id:String(card.id||''),code:String(card.code||''),chara:String(card.chara||''),
  image_url:String(card.image_url||''),visible:card.visible!==false};
}
function cardArray(items){return (Array.isArray(items)?items:[]).map(normalizeCard).filter(Boolean);}
function base(){return {cards:[],owned:[],plans:[],colors:readColors(),lastCardsUpdated:'',lastSavedAt:''};}
function sanitize(obj){
 const state=base();
 if(obj&&typeof obj==='object'){
  state.cards=cardArray(obj.cards);
  state.colors=obj.colors&&typeof obj.colors==='object'?{...readColors(),...obj.colors}:readColors();
  state.lastCardsUpdated=String(obj.lastCardsUpdated||'');
  state.lastSavedAt=String(obj.lastSavedAt||'');
 }
 return state;
}
async function modernApi(action,payload={},token=''){
 if(isDemo())throw Error('サイトEのGASが設定されていません');
 let response;
 if(action==='public'){
  response=await fetch(C.gasUrl+(C.gasUrl.includes('?')?'&':'?')+'action=public&t='+Date.now(),
   {cache:'no-store',redirect:'follow'});
 }else{
  response=await fetch(C.gasUrl,{
   method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
   body:JSON.stringify({action,...payload,token}),redirect:'follow'
  });
 }
 if(!response.ok)throw Error('通信エラー: '+response.status);
 const result=await response.json();
 if(result.ok===false)throw Error(result.error||'GAS処理に失敗しました');
 const data=result.data??result;
 if(action==='public'){
  const list=cardArray(data.cards).filter(x=>x.visible!==false);
  return {...data,cards:list,colors:data.colors||readColors()};
 }
 if(action==='admin')return sanitize(data);
 if(action==='login'&&data.admin)return {...data,admin:sanitize(data.admin)};
 return data;
}
async function api(action,payload={},token=''){
 if(C.backendMode==='migrated')return modernApi(action,payload,token);
 if(action==='public'){
  const fresh=await request('list');
  const items=Array.isArray(fresh)?fresh:fresh.cards;
  if(!Array.isArray(items))throw Error('公開フレカの形式が不正です');
  const cards=cardArray(items).filter(card=>card.visible!==false);
  try{localStorage.setItem(CACHE_KEY,JSON.stringify({cards}));}catch(_){}
  const lastCardsUpdated=cards.map(x=>x.updated_at||x.created_at).filter(Boolean).sort().at(-1)||'';
  return {cards,colors:readColors(),lastCardsUpdated};
 }
 if(action==='login'){
  const password=String(payload.password||'');
  await request('auth',{},password);
  if(payload.includeAdmin){
   const res=await request('adminList',{},password);
   return {token:password,admin:sanitize({cards:res.cards})};
  }
  return {token:password};
 }
 if(action==='admin'){
  const res=await request('adminList',{},token);
  return sanitize({cards:res.cards});
 }
 if(action==='upload'){
  const res=await request('upload',payload,token);
  if(!res.card)throw Error('アップロード結果が取得できません');
  return normalizeCard(res.card);
 }
 if(action==='update'){
  await request('update',payload,token);
  return {ok:true};
 }
 if(action==='visibility'){
  await request('visibility',payload,token);
  return {ok:true};
 }
 if(action==='delete'){
  await request('delete',payload,token);
  return {ok:true};
 }
 throw Error('サイトEで未対応の操作: '+action);
}
function colorInfo(hex){
 const c=cleanColor(hex)||'#eaa1bf';
 const r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16);
 const f=v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)};
 const L=.2126*f(r)+.7152*f(g)+.0722*f(b);
 const on=(L+.05)/.05>=1.05/(L+.05)?'#171717':'#ffffff';
 return {color:c,on,soft:`rgba(${r}, ${g}, ${b}, .21)`,line:`rgba(${r}, ${g}, ${b}, .38)`};
}
let lastBackground='';
function theme(chara,colors){
 const key=chara||'すべて',spec=colorSpec(colors[key],DEFAULT_COLORS[key]);
 const mix=spec.mode==='gradient'?
 '#'+[1,3,5].map(i=>Math.round((parseInt(spec.first.slice(i,i+2),16)+parseInt(spec.second.slice(i,i+2),16))/2).toString(16).padStart(2,'0')).join('')
 :spec.first;
 const t=colorInfo(mix),bg=themeBackground(spec),st=document.documentElement.style;
 if(lastBackground && lastBackground!==bg){
  st.setProperty('--old-theme-background',lastBackground);
  document.documentElement.classList.remove('theme-changing');
  void document.documentElement.offsetWidth;
  document.documentElement.classList.add('theme-changing');
  clearTimeout(theme.timer);
  theme.timer=setTimeout(()=>document.documentElement.classList.remove('theme-changing'),720);
 }
 lastBackground=bg;
 st.setProperty('--theme-background',bg);
 st.setProperty('--theme-color',t.color);st.setProperty('--theme-on',t.on);
 st.setProperty('--theme-soft',t.soft);st.setProperty('--theme-line',t.line);
}
function characterStyle(chara,colors){
 const spec=colorSpec(colors[chara||'すべて'],DEFAULT_COLORS[chara||'すべて']);
 const c=colorInfo(spec.first),other=colorInfo(spec.second);
 const soft=spec.mode==='gradient'?`linear-gradient(110deg, ${c.soft}, ${other.soft})`:c.soft;
 return `--item-color:${c.color};--item-background:${themeBackground(spec)};--item-on:${c.on};--item-soft:${soft};--item-line:${c.line}`;
}
function cardImage(src,code){if(!src)return '<div class="empty-image"><span>♡</span><small>画像未登録</small></div>';return `<img src="${esc(src)}" alt="${esc(code)}" loading="lazy" decoding="async">`;}
function iconHome(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10h-6v-7H9v7H3z"/></svg>';}
function iconUser(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.3"/><path d="M5.5 21c.5-4.6 2.7-6.8 6.5-6.8s6 2.2 6.5 6.8"/></svg>';}
function buildCharacterNav(onSelect,{mobile=true,colors=DEFAULT_COLORS}={}){
 let current='', group=0;
 const pc=`<nav class="desktop-tabs" aria-label="キャラクター切替"><button data-char="" class="char-tab active">すべて</button>${chars.map(c=>`<button data-char="${esc(c)}" class="char-tab">${esc(c)}</button>`).join('')}</nav>`;
 const bottom=mobile?`<nav class="bottom-nav" aria-label="キャラクター切替"><div class="bottom-nav-inner"><button class="bottom-all active" data-char="">すべて</button><div class="nav-scroller" id="nav-scroller"><div class="nav-track">${groups.map((a,i)=>`<div class="nav-slide" data-group="${i}">${a.map(c=>`<button class="bottom-char" data-char="${esc(c)}">${esc(c)}</button>`).join('')}</div>`).join('')}</div></div></div></nav>`:'';
 return {html:pc+bottom,init(root=document){
  const update=()=>{
   $$('[data-char]',root).forEach(b=>{b.classList.toggle('active',b.dataset.char===current);b.style.cssText=characterStyle(b.dataset.char||'すべて',colors);});
   theme(current,colors);
  };
  $$('[data-char]',root).forEach(b=>b.addEventListener('click',()=>{current=b.dataset.char;update();onSelect(current);}));
  const sc=$('#nav-scroller',root);
  if(sc){let timer;sc.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(()=>{group=Math.max(0,Math.min(3,Math.round(sc.scrollLeft/Math.max(1,sc.clientWidth))));},60);},{passive:true});}
  update();
  return {set(c){current=c;update();},updateColors(c){colors=c;update();}};
 }};}
function toast(msg){let n=$('#toast');if(!n){n=document.createElement('div');n.id='toast';n.className='toast';document.body.appendChild(n);}n.textContent=msg;n.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.classList.remove('show'),2300);}
window.SiteD={colorSpec,themeBackground,themeMain,colorInfo,characterStyle,groups,chars,DEFAULT_COLORS,$,$$,esc,norm,uuid,cleanColor,validChara,base,sanitize,isDemo,api,request,readColors,saveColors,normalizeCard,cardImage,theme,buildCharacterNav,toast,isMigrated:()=>C.backendMode==='migrated'};
})();
