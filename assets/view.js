const C=window.FRECA_CONFIG||{};
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let cards=[],q='',chara='',page=1;
const PAGE=20;

// 一覧画像のみキャッシュ。管理画面・GAS・拡大画像は対象外。
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./image-cache-sw.js', {scope:'./'})
    .catch(e=>console.warn('画像キャッシュを有効にできませんでした',e));
}


function thumbUrl(url){
  const s=String(url||'');
  const id=s.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1] || s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  return id ? 'https://drive.google.com/thumbnail?id='+encodeURIComponent(id)+'&sz=w480' : s;
}

function normalizeSearchText(s){
  return String(s??'')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g,ch =>
      String.fromCharCode(ch.charCodeAt(0)-0x60)
    );
}

const CACHE_KEY='freca_C_public_cards_v1';
async function load(){
  let shown=false;
  try{
    const saved=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
    if(saved && Array.isArray(saved.cards)){
      cards=saved.cards;
      buildShell();renderResults();shown=true;
    }
  }catch(e){console.warn('cache read',e);}
  if(!shown)document.body.innerHTML='<div class="loading">読み込み中...</div>';
  try{
    const r=await fetch(C.gasUrl+'?action=list&_ts='+Date.now(),{cache:'no-store'});
    const j=await r.json();
    if(j.ok===false)throw new Error(j.error||'API error');
    const fresh=Array.isArray(j)?j:(j.cards||[]);
    if(!Array.isArray(fresh))throw new Error('Invalid card list');
    cards=fresh;
    try{localStorage.setItem(CACHE_KEY,JSON.stringify({cards:fresh}));}catch(e){console.warn('cache write',e);}
    if(!shown){buildShell();renderResults();}
    else{
      const oldQ=q,oldChara=chara,oldPage=page;
      buildShell();q=oldQ;chara=oldChara;page=oldPage;
      const input=$('#q');if(input)input.value=q;
      document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.c===chara));
      setCharacterTheme(chara);
      renderResults();
    }
  }catch(e){
    if(!shown)document.body.innerHTML='<div class="empty">読み込みに失敗しました</div>';
    console.error(e);
  }
}

function filteredCards(){
  return cards.filter(x=>
    (!chara||x.chara===chara) &&
    (!q||normalizeSearchText(x.code).includes(normalizeSearchText(q)))
  );
}


function getLatestUpdateDate(){
  const dates=cards
    .map(x=>new Date(x.created_at))
    .filter(d=>!Number.isNaN(d.getTime()));
  if(!dates.length)return '';
  const latest=new Date(Math.max(...dates.map(d=>d.getTime())));
  const y=latest.getFullYear();
  const m=String(latest.getMonth()+1).padStart(2,'0');
  const day=String(latest.getDate()).padStart(2,'0');
  return `${y}${m}${day}`;
}

function setCharacterTheme(character){
  const themes={
    '': ['#ef9fc3','#cfa7d7','#8fd3e9'],
    'のあ': ['#ef9fc3','#dfb9dc','#c5edfa'],
    'ふあ': ['#FBB8CA','#fbcbd0','#FAFDD8'],
    'るる': ['#ef857d','#f09b9d','#f6bad5'],
    'るり': ['#CFD7E8','#B98EEB','#A82CFE']
  };
  const colors=themes[character]||themes[''];
  const root=document.documentElement;
  root.style.setProperty('--character-a',colors[0]);
  root.style.setProperty('--character-mid',colors[1]);
  root.style.setProperty('--character-b',colors[2]);
  root.style.setProperty('--character-menu-a',colors[0]);
  root.style.setProperty('--character-menu-b',colors[2]);
}

function buildShell(){
  const chars=['のあ','ふあ','るる','るり'];

  document.body.innerHTML=`
    <header class="header">
      <div class="header-inner">
        <div class="title">${esc(C.appName||'フレカ置き場')}</div>
        <div class="updated" id="updated"></div>
      </div>
    </header>

    <div class="hero">
      <div class="search">⌕<input id="q" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="コーデ名で検索"></div>
    </div>

    <div class="tabs" id="tabs">
      <button class="tab active" data-c="">
        <span class="tab-icon tab-icon-home" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M3.5 10.7 12 3.8l8.5 6.9v8.8a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z"/></svg>
        </span>
        <span class="tab-label">すべて</span>
      </button>
      ${chars.map(c=>`<button class="tab" data-c="${esc(c)}">
        <span class="tab-icon tab-icon-person" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5.8 20c.4-4 2.7-6.2 6.2-6.2s5.8 2.2 6.2 6.2"/></svg>
        </span>
        <span class="tab-label">${esc(c)}</span>
      </button>`).join('')}
    </div>

    <main class="grid" id="grid"></main>
    <div class="pager" id="pager"></div>

    <div class="modal" id="modal">
      <div class="modal-content">
        <img id="modal-img">
        <button class="close" id="close" aria-label="閉じる">×</button>
      </div>
    </div>`;

  setCharacterTheme(chara);
  const latest=getLatestUpdateDate();
  if(latest)$('#updated').textContent=`更新:${latest}`;

  const input=$('#q');
  let timer;

  input.addEventListener('input',e=>{
    clearTimeout(timer);
    timer=setTimeout(()=>{
      q=e.target.value.trim();
      page=1;
      renderResults();
    },180);
  });

  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
    chara=b.dataset.c;
    setCharacterTheme(chara);
    page=1;
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));
    renderResults();
  });

  $('#close').onclick=()=>$('#modal').classList.remove('open');
  $('#modal').onclick=e=>{
    if(e.target.id==='modal')$('#modal').classList.remove('open');
  };
}


function makePageItems(current,total){
  if(total<=7)return Array.from({length:total},(_,i)=>i+1);

  const items=[1];
  let start=Math.max(2,current-1);
  let end=Math.min(total-1,current+1);

  if(current<=3){
    start=2;
    end=4;
  }else if(current>=total-2){
    start=total-3;
    end=total-1;
  }

  if(start>2)items.push('…');
  for(let i=start;i<=end;i++)items.push(i);
  if(end<total-1)items.push('…');
  items.push(total);
  return items;
}

function renderResults(){
  const filtered=filteredCards();
  const total=Math.max(1,Math.ceil(filtered.length/PAGE));
  page=Math.min(page,total);
  const list=filtered.slice((page-1)*PAGE,page*PAGE);

  const grid=$('#grid');
  const pager=$('#pager');

  grid.innerHTML=list.length
    ? list.map((x,i)=>`
      <article class="card" data-id="${x.id}" style="--delay:${Math.min(i,18)*55}ms">
        <div class="card-img"><img
          src="${esc(thumbUrl(x.image_url))}"
          loading="${i<2?'eager':'lazy'}"
          fetchpriority="${i<2?'high':'low'}"
          decoding="async"
        ></div>
        <div class="card-info">
          <div class="chara">${esc(x.chara||'未設定')}</div>
          <div class="code">${esc(x.code||'')}</div>
        </div>
      </article>`).join('')
    : '<div class="empty" style="grid-column:1/-1">カードがありません</div>';

  const pageItems=makePageItems(page,total);
  pager.innerHTML=`
    <button class="page-btn page-arrow" data-page="${page-1}" ${page<=1?'disabled':''} aria-label="前のページ">‹</button>
    ${pageItems.map(p=>p==='…'
      ? '<span class="page-ellipsis">…</span>'
      : `<button class="page-btn ${p===page?'active':''}" data-page="${p}">${p}</button>`
    ).join('')}
    <button class="page-btn page-arrow" data-page="${page+1}" ${page>=total?'disabled':''} aria-label="次のページ">›</button>`;

  pager.querySelectorAll('[data-page]').forEach(btn=>{
    btn.onclick=()=>{
      if(btn.disabled)return;
      const next=Number(btn.dataset.page);
      if(!Number.isFinite(next)||next<1||next>total||next===page)return;
      page=next;
      renderResults();
      window.scrollTo({top:0,behavior:'smooth'});
    };
  });

  document.querySelectorAll('.card').forEach(el=>el.onclick=()=>{
    const x=cards.find(x=>String(x.id)===String(el.dataset.id));
    if(!x)return;
    $('#modal-img').src=x.image_url;
    $('#modal').classList.add('open');
  });
}

load();
