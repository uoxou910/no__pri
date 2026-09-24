// サイトA: 一覧サムネイルのみキャッシュ（元画像・API・HTMLは対象外）。
const CACHE='freca-sitea-thumbnails-v1';
const LIMIT=120;
self.addEventListener('install',event=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function isThumb(req){
  if(req.destination!=='image')return false;
  const u=new URL(req.url);
  return u.hostname==='drive.google.com' && u.pathname==='/thumbnail' &&
    u.searchParams.has('id') && u.searchParams.get('sz')==='w480';
}
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(!isThumb(req))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const hit=await cache.match(req);
    if(hit)return hit;
    const response=await fetch(req);
    if(response.ok || response.type==='opaque'){
      try{
        await cache.put(req,response.clone());
        const keys=await cache.keys();
        if(keys.length>LIMIT){
          await Promise.all(keys.slice(0,keys.length-LIMIT).map(key=>cache.delete(key)));
        }
      }catch(e){console.warn('画像のキャッシュ保存に失敗',e);}
    }
    return response;
  })());
});
