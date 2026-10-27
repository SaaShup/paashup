// The plugin's small web UI: a self-contained page to start a migration and watch the
// live progress bar. It's written to a temp dir at load and served as a static asset
// (plugin routes can only return JSON, so an HTML page must come from an asset mount).
// The page is shown in the paashup sidebar via the /ui/ manifest (see routes.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const UI_PREFIX = '/api/plugins/netbox-migrate/app/';

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>NetBox → paashup migration</title>
<style>
 :root{--p:#0EA5E9;--pd:#0284c7;--bd:#e2e8f0;--mut:#64748b;--bg:#f8fafc;--txt:#0f172a}
 body{font:14px system-ui,sans-serif;color:var(--txt);margin:0;background:var(--bg);padding:24px}
 h1{font-size:20px;margin:0 0 4px} .sub{color:var(--mut);margin:0 0 18px}
 .card{background:#fff;border:1px solid var(--bd);border-radius:10px;padding:18px;max-width:760px;margin-bottom:16px}
 label{display:block;font-weight:600;margin:10px 0 4px;font-size:13px}
 input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bd);border-radius:6px;font:inherit}
 .row{display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap}
 button{background:var(--p);color:#fff;border:0;border-radius:6px;padding:9px 16px;font-weight:600;cursor:pointer}
 button:hover{background:var(--pd)} button:disabled{opacity:.5;cursor:default}
 button.ghost{background:#fff;color:var(--txt);border:1px solid var(--bd)}
 .bar{height:24px;background:#e2e8f0;border-radius:12px;overflow:hidden;margin:10px 0}
 .fill{height:100%;width:0;background:linear-gradient(90deg,#38bdf8,#0EA5E9);transition:width .35s;border-radius:12px}
 .stat{display:flex;gap:18px;flex-wrap:wrap;color:var(--mut);font-size:13px;align-items:center}
 .stat b{color:var(--txt)} .ok{color:#15803d;font-weight:600}
 table{border-collapse:collapse;width:100%;font-size:13px;margin-top:10px}
 th,td{border-bottom:1px solid var(--bd);padding:6px 8px;text-align:left} th{color:var(--mut);font-weight:600}
 .err{color:#b91c1c;margin-top:10px;white-space:pre-wrap} .hide{display:none}
 code{background:#f1f5f9;padding:1px 5px;border-radius:4px}
</style></head>
<body>
 <h1>NetBox &rarr; paashup migration</h1>
 <p class="sub">Reads core objects from a NetBox instance and creates them here. Use an API token with read access to all objects.</p>
 <div class="card">
   <label>NetBox URL</label>
   <input type="text" id="url" placeholder="https://netbox.example.com">
   <label>API token</label>
   <input type="password" id="token" placeholder="NetBox API token">
   <label>Only these entities (optional &mdash; comma-separated tables/endpoints)</label>
   <input type="text" id="only" placeholder="e.g. dcim_region, dcim_site, dcim_device">
   <div class="row">
     <button id="start">Start migration</button>
     <button id="dry" class="ghost">Dry run</button>
     <label style="display:flex;align-items:center;gap:6px;margin:0;font-weight:400"><input type="checkbox" id="confirm"> I understand this writes into paashup</label>
   </div>
   <div class="err hide" id="error"></div>
 </div>
 <div class="card hide" id="progress">
   <div class="stat">
     <span><b id="pct">0</b>%</span>
     <span><b id="mig">0</b> / <b id="tot">0</b> migrated</span>
     <span>current: <b id="cur">&mdash;</b></span>
     <span>failed: <b id="fail">0</b></span>
     <span id="state"></span>
   </div>
   <div class="bar"><div class="fill" id="fill"></div></div>
   <div id="report"></div>
 </div>
<script>
var API='/api/plugins/netbox-migrate';
function $(id){return document.getElementById(id);}
function setErr(m){var e=$('error');e.textContent=m;e.classList.remove('hide');}
function clearErr(){$('error').classList.add('hide');}
function busy(b){$('start').disabled=b;$('dry').disabled=b;}
function start(dry){
  clearErr();
  var url=$('url').value.trim(), token=$('token').value.trim();
  if(!url||!token){setErr('NetBox URL and API token are required.');return;}
  if(!dry && !$('confirm').checked){setErr('Tick the confirmation box (or use Dry run).');return;}
  var raw=$('only').value.trim();
  var only=raw?raw.split(',').map(function(s){return s.trim();}).filter(Boolean):undefined;
  busy(true);
  fetch(API+'/run/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:url,token:token,only:only,dry_run:dry})})
   .then(function(r){return r.json().then(function(b){return {status:r.status,body:b};});})
   .then(function(res){
     if(res.status!==202 && res.status!==200){busy(false);setErr((res.body&&res.body.detail)||JSON.stringify(res.body));return;}
     $('progress').classList.remove('hide');$('report').innerHTML='';
     poll();
   }).catch(function(e){busy(false);setErr(String(e));});
}
function poll(){
  fetch(API+'/progress/').then(function(r){return r.json();}).then(function(p){
    render(p);
    if(!p.done){setTimeout(poll,700);}else{busy(false);renderReport(p);}
  }).catch(function(e){busy(false);setErr(String(e));});
}
function render(p){
  $('pct').textContent=p.percent;$('mig').textContent=p.migrated;$('tot').textContent=p.total;
  $('cur').textContent=p.current||'\\u2014';$('fail').textContent=p.failed;
  $('fill').style.width=p.percent+'%';
  $('state').innerHTML=p.done?'<span class=ok>&#10003; done</span>':(p.running?'running&hellip;':'');
}
function renderReport(p){
  if(p.error){setErr(p.error);}
  var r=p.result;if(!r||!r.entities){return;}
  var h='<table><tr><th>entity</th><th>total</th><th>created</th><th>linked</th><th>failed</th></tr>';
  r.entities.forEach(function(e){h+='<tr><td><code>'+e.table+'</code></td><td>'+e.total+'</td><td>'+e.created+'</td><td>'+e.linked+'</td><td>'+e.failed+'</td></tr>';});
  h+='</table>';
  $('report').innerHTML=h;
}
$('start').onclick=function(){start(false);};
$('dry').onclick=function(){start(true);};
</script>
</body></html>`;

export const UI_DIR = join(tmpdir(), 'paashup-nbmigrate-ui');
mkdirSync(UI_DIR, { recursive: true });
writeFileSync(join(UI_DIR, 'index.html'), HTML);
