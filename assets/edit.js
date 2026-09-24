(function(){
const C=window.FRECA_CONFIG||{};
let cards=[],q='',deleteMode=false,selected=new Set(),
    adminPassword=sessionStorage.getItem('freca_admin_password')||'';

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const configured=()=>C.gasUrl &&
  /^https:\/\/script\.google\.com\/macros\/s\//.test(C.gasUrl) &&
  !C.gasUrl.includes('YOUR_');

const toast=m=>{
  const t=$('#toast');
  if(!t)return;
  t.textContent=m;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),1800);
};

async function get(action,params={}){
  const u=new URL(C.gasUrl);
  u.searchParams.set('action',action);
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  const r=await fetch(u.toString(),{redirect:'follow'});
  const j=await r.json();
  if(!j.ok)throw new Error(j.error||'API error');
  return j;
}

async function post(action,data={}){
  const body=new URLSearchParams({action,password:adminPassword,...data});
  const r=await fetch(C.gasUrl,{
    method:'POST',
    body,
    redirect:'follow'
  });
  const j=await r.json();
  if(!j.ok)throw new Error(j.error||'API error');
  return j;
}

function normalizeSearchText(s){
  return String(s??'')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g,ch =>
      String.fromCharCode(ch.charCodeAt(0)-0x60)
    );
}

function showMessage(t,m){
  document.body.innerHTML=
    '<div class="setup-warning"><b>'+esc(t)+'</b><br>'+esc(m)+'</div>';
}

async function init(){
  if(!configured()){
    showMessage(
      '初期設定が必要です',
      'assets/config.js の gasUrl にGASのウェブアプリURLを貼り付けてください。'
    );
    return;
  }

  if(adminPassword){
    try{
      await post('auth');
      await load();
      return;
    }catch(e){
      sessionStorage.removeItem('freca_admin_password');
      adminPassword='';
    }
  }

  renderLogin();
}

function renderLogin(error=''){
  document.body.innerHTML=`
    <main class="login-page">
      <div class="login-box">
        <div class="login-title">フレンドカード管理</div>
        <div class="login-sub">管理者ログイン</div>
        ${error?`<div class="login-error">${esc(error)}</div>`:''}
        <label>
          管理パスワード
          <input id="password" type="password"
            autocomplete="current-password"
            placeholder="GASで設定したパスワード">
        </label>
        <button class="primary login-btn" id="login">ログイン</button>
        <a class="back-link" href="index.html">← 閲覧ページへ戻る</a>
      </div>
    </main>`;

  $('#login').onclick=login;
  $('#password').onkeydown=e=>{
    if(e.key==='Enter')login();
  };
}

async function login(){
  const p=$('#password').value;
  if(!p)return renderLogin('パスワードを入力してください。');

  adminPassword=p;
  try{
    await post('auth');
    sessionStorage.setItem('freca_admin_password',p);
    await load();
  }catch(e){
    adminPassword='';
    renderLogin('パスワードが違います。');
  }
}

function logout(){
  adminPassword='';
  sessionStorage.removeItem('freca_admin_password');
  renderLogin();
}

async function load(){
  document.body.innerHTML='<div class="loading">読み込み中…</div>';

  try{
    cards=(await post('adminList')).cards||[];
    render();
  }catch(e){
    showMessage('読み込みに失敗しました',e.message);
  }
}

function render(){
  const publicCount=cards.filter(x=>x.visible!==false).length;

  document.body.innerHTML=`
    <header class="header admin-header">
      <div class="header-inner">
        <div>
          <div class="title">フレンドカード管理</div>
          <div class="admin-user">管理者としてログイン中</div>
        </div>

        <div class="head-actions">
          <a class="btn" href="index.html">閲覧</a>
          <button class="btn" id="logout">ログアウト</button>
          <button class="btn" id="del">削除</button>
        </div>
      </div>
    </header>

    <main class="admin">
      <div class="upload">
        <label class="upload-label">
          ＋ カード画像を追加
          <input id="files" type="file" accept="image/*" multiple>
        </label>
        <div class="hint">
          複数選択できます。画像はGoogle Driveに保存されます。
        </div>
      </div>

      <div class="search admin-search">
        <span>⌕</span>
        <input id="q"
          placeholder="キャラ名・コーデ名で検索"
          value="${esc(q)}"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false">
      </div>

      <div class="section">
        登録カード <span>${cards.length}</span>件
        <span class="admin-public-count">／ 公開 ${publicCount}件</span>
      </div>

      <div class="admin-grid" id="list"></div>
    </main>

    <div class="bar" id="bar">
      <div class="count" id="selCount">0件選択中</div>
      <button id="cancel">キャンセル</button>
      <button id="exec" style="background:#fff;color:#d9535f">削除</button>
    </div>

    <div class="modal admin-modal" id="adminModal">
      <div class="modal-content">
        <img id="adminModalImg" alt="">
        <button class="close" id="adminModalClose" aria-label="閉じる">×</button>
      </div>
    </div>

    <div class="toast" id="toast"></div>`;

  draw();

  $('#files').onchange=e=>addFiles(e.target.files);

  let searchTimer;
  $('#q').oninput=e=>{
    clearTimeout(searchTimer);
    const value=e.target.value;
    searchTimer=setTimeout(()=>{
      q=value;
      draw();
    },120);
  };

  $('#del').onclick=()=>{
    deleteMode=!deleteMode;
    selected.clear();
    updateBar();
    draw();
  };

  $('#cancel').onclick=()=>{
    deleteMode=false;
    selected.clear();
    updateBar();
    draw();
  };

  $('#exec').onclick=deleteSelected;
  $('#logout').onclick=logout;

  $('#adminModalClose').onclick=closePreview;
  $('#adminModal').onclick=e=>{
    if(e.target.id==='adminModal')closePreview();
  };
}

function filteredCards(){
  if(!q)return cards;
  const nq=normalizeSearchText(q);

  return cards.filter(x=>
    normalizeSearchText(`${x.chara} ${x.code}`).includes(nq)
  );
}

function draw(){
  const list=filteredCards();

  $('#list').innerHTML=list.length
    ?list.map((x,i)=>{
      const visible=x.visible!==false;

      return `
        <div class="selectable admin-card-wrap ${visible?'':'is-hidden'}"
             style="--delay:${Math.min(i,18)*45}ms">

          <div class="selectbox ${deleteMode?'on':''} ${selected.has(x.id)?'checked':''}"
               data-id="${x.id}">
            ${selected.has(x.id)?'✓':''}
          </div>

          <div class="edit-card">
            <button class="admin-image-button"
                    type="button"
                    data-preview="${x.id}"
                    aria-label="画像を拡大">
              <img
                src="${esc(x.image_url)}"
                alt=""
                loading="${i<8?'eager':'lazy'}"
                fetchpriority="${i<4?'high':'auto'}"
                decoding="async">
              ${visible?'':'<span class="hidden-badge">非表示</span>'}
            </button>

            <div class="fields">
              <select class="chara" data-id="${x.id}" aria-label="キャラクター名">
                <option value="" ${!x.chara?'selected':''} disabled>キャラ名を選択</option>
                ${['のあ','ふあ','るる','るり'].map(name=>`<option value="${name}" ${x.chara===name?'selected':''}>${name}</option>`).join('')}
              </select>

              <input class="code"
                     data-id="${x.id}"
                     value="${esc(x.code||'')}"
                     placeholder="コーデ名">

              <div class="visibility-row">
                <span class="visibility-state ${visible?'public':'private'}">
                  ${visible?'公開中':'非表示'}
                </span>
                <button class="btn visibility-toggle"
                        data-id="${x.id}"
                        data-visible="${visible}">
                  ${visible?'非表示にする':'表示する'}
                </button>
              </div>

              <div class="row">
                <button class="btn save" data-id="${x.id}">保存</button>
                <button class="btn danger one-delete" data-id="${x.id}">削除</button>
              </div>
            </div>
          </div>
        </div>`;
    }).join('')
    :'<div class="empty">カードがありません</div>';

  document.querySelectorAll('.selectbox').forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.id;
      selected.has(id)?selected.delete(id):selected.add(id);
      updateBar();
      draw();
    };
  });

  document.querySelectorAll('.save').forEach(b=>{
    b.onclick=()=>saveCard(b.dataset.id);
  });

  document.querySelectorAll('.one-delete').forEach(b=>{
    b.onclick=()=>deleteOne(b.dataset.id);
  });

  document.querySelectorAll('.visibility-toggle').forEach(b=>{
    b.onclick=()=>toggleVisibility(
      b.dataset.id,
      b.dataset.visible==='true'
    );
  });

  document.querySelectorAll('[data-preview]').forEach(b=>{
    b.onclick=()=>{
      if(deleteMode)return;
      openPreview(b.dataset.preview);
    };
  });
}

function openPreview(id){
  const x=cards.find(x=>String(x.id)===String(id));
  if(!x)return;

  $('#adminModalImg').src=x.image_url;
  $('#adminModal').classList.add('open');
}

function closePreview(){
  const modal=$('#adminModal');
  if(!modal)return;
  modal.classList.remove('open');
  const img=$('#adminModalImg');
  if(img)img.src='';
}

async function toggleVisibility(id,currentVisible){
  const next=!currentVisible;
  const x=cards.find(x=>String(x.id)===String(id));
  if(!x)return;

  try{
    await post('visibility',{
      id,
      visible:String(next)
    });

    x.visible=next;
    draw();
    toast(next?'公開しました':'非表示にしました');
  }catch(e){
    alert('表示状態の変更に失敗しました：'+e.message);
  }
}

async function saveCard(id){
  const chara=
    document.querySelector('.chara[data-id="'+id+'"]')?.value.trim()||'';
  const code=
    document.querySelector('.code[data-id="'+id+'"]')?.value.trim()||'';

  try{
    await post('update',{id,chara,code});

    const x=cards.find(x=>x.id===id);
    if(x){
      x.chara=chara;
      x.code=code;
    }

    toast('保存しました');
  }catch(e){
    alert('保存に失敗しました：'+e.message);
  }
}

function readDataURL(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result);
    r.onerror=rej;
    r.readAsDataURL(file);
  });
}

async function addFiles(files){
  const list=[...files];
  if(!list.length)return;

  let completed=0;
  for(const file of list){
    try{
      toast(`アップロード中… ${completed+1}/${list.length}`);
      const dataUrl=await readDataURL(file);

      // PNG・解像度・画質はそのまま。余計な画像変換処理はしません。
      const j=await post('upload',{
        filename:file.name,
        mimeType:file.type||'image/png',
        data:dataUrl
      });

      cards.unshift(j.card);
      completed++;
    }catch(e){
      alert('アップロードに失敗しました：'+e.message);
    }
  }

  // 全件アップロード後に一度だけ管理画面を描画します。
  render();
  toast(completed===list.length?'追加しました':`${completed}/${list.length}件追加しました`);
}

async function deleteOne(id){
  if(confirm('このカードを削除しますか？')){
    await remove([id]);
  }
}

async function deleteSelected(){
  if(selected.size && confirm(selected.size+'件削除しますか？')){
    await remove([...selected]);
  }
}

async function remove(ids){
  try{
    for(const id of ids)await post('delete',{id});

    cards=cards.filter(x=>!ids.includes(x.id));
    selected.clear();
    deleteMode=false;

    render();
    toast('削除しました');
  }catch(e){
    alert('削除に失敗しました：'+e.message);
  }
}

function updateBar(){
  const b=$('#bar');
  if(!b)return;

  b.classList.toggle('show',deleteMode);
  $('#selCount').textContent=selected.size+'件選択中';
}

init();
})();
