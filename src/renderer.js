// CTRL renderer.js
let detectedApps={}, config={}, muteState={};
let cpuHistory=[], ramHistory=[];
let timerInterval=null, timerSecs=0;
let sessionStart=Date.now();
let audioAppsCache=[];

window.addEventListener('DOMContentLoaded', async()=>{
  tick(); setInterval(tick,1000);
  setInterval(updateUptime,1000);
  try{config=await window.ctrl.getConfig();}catch{}
  try{detectedApps=await window.ctrl.detectApps();}catch{}
  applyConfig();
  renderQuickLaunch();
  // Erste Sysinfo-Messung (Baseline für Netzwerk)
  await fetchSysinfo();
  setTimeout(async()=>{await fetchSysinfo();setInterval(fetchSysinfo,2000);},1500);
  setInterval(updatePings,4000); updatePings();
  // Audio: sofort und dann alle 30 Sekunden (verhindert PowerShell-Spam)
  await refreshAudioMixer();
  setInterval(refreshAudioMixer, 30000);
  loadUptimeRecord();
});

function tick(){const n=new Date(),p=x=>String(x).padStart(2,'0');setEl('clk',p(n.getHours())+':'+p(n.getMinutes())+':'+p(n.getSeconds()));}
function fmtSecs(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');}
function updateUptime(){const s=Math.floor((Date.now()-sessionStart)/1000);setEl('uv',fmtSecs(s));setEl('sess-up',fmtSecs(s));setEl('sc-uptime',Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m');checkUptimeRecord(s);}
function setEl(id,val){const e=document.getElementById(id);if(e)e.textContent=val;}

window.sw=function(id,btn){
  document.querySelectorAll('.tc').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
  btn.classList.add('active');
};

// ── Quick Launch ──────────────────────────────────────
const APPS_META=[
  {key:'terminal',label:'Terminal',icon:'ti-terminal'},
  {key:'firefox', label:'Firefox', icon:'ti-browser'},
  {key:'steam',   label:'Steam',   icon:'ti-device-gamepad-2'},
  {key:'spotify', label:'Spotify', icon:'ti-music'},
];
function renderQuickLaunch(){
  const grid=document.getElementById('quick-grid');
  if(!grid)return;
  grid.innerHTML='';
  APPS_META.forEach(app=>{
    const found=detectedApps[app.key];
    const btn=document.createElement('button');
    btn.className='hbtn'+(found?'':' hbtn-missing');
    btn.title=found||(app.label+' nicht gefunden');
    btn.innerHTML=`<i class="ti ${app.icon} hico"></i><span class="hlabel">${found?app.label:'<s>'+app.label+'</s>'}</span>`;
    if(found){btn.onclick=()=>window.ctrl.launchApp(found).then(()=>showToast(app.label+' wird gestartet...')).catch(()=>showToast('Fehler: '+app.label+' konnte nicht gestartet werden'));}
    else{btn.onclick=()=>showToast(app.label+' nicht installiert oder nicht gefunden.');}
    grid.appendChild(btn);
  });
}

// ── Sysinfo ───────────────────────────────────────────
async function fetchSysinfo(){
  try{
    const info=await window.ctrl.getSysinfo();
    setBar('cv','cb',info.cpu); setBar('rv','rb',info.ram); setBar('gv','gb',info.gpu);
    cpuHistory.push(info.cpu);if(cpuHistory.length>30)cpuHistory.shift();
    ramHistory.push(info.ram);if(ramHistory.length>30)ramHistory.shift();
    setEl('sc-cpu',Math.round(cpuHistory.reduce((a,b)=>a+b,0)/cpuHistory.length)+'%');
    setEl('sc-ram',Math.round(ramHistory.reduce((a,b)=>a+b,0)/ramHistory.length)+'%');
    const dl=parseFloat(info.network.dl),ul=parseFloat(info.network.ul);
    setEl('d-dl',dl.toFixed(2));setEl('d-ul',ul.toFixed(2));
    setEl('nl-dl',dl.toFixed(2));setEl('nl-ul',ul.toFixed(2));
    renderDisks(info.disks);
  }catch(e){console.error('sysinfo:',e);}
}
function setBar(vi,bi,pct){setEl(vi,pct+'%');const b=document.getElementById(bi);if(b)b.style.width=Math.min(pct,100)+'%';}

// ── Disks ─────────────────────────────────────────────
let disksBuilt=false;
function renderDisks(disks){
  const grid=document.getElementById('disk-grid');
  if(!grid||!disks?.length)return;
  if(disksBuilt){disks.forEach(d=>{const id=d.mount.replace(/[:\\]/g,'');setEl('disk-pct-'+id,d.use+'%');const arc=document.getElementById('disk-arc-'+id);if(arc){const r=32,c=2*Math.PI*r;arc.setAttribute('stroke-dashoffset',(c*(1-d.use/100)).toFixed(1));}});return;}
  disksBuilt=true;grid.innerHTML='';
  disks.forEach(d=>{
    const pct=Math.min(d.use||0,100),color=pct>90?'#ff4444':pct>75?'#ffaa00':'#00d4ff';
    const r=32,c=2*Math.PI*r,offset=(c*(1-pct/100)).toFixed(1),free=Math.max(0,parseFloat(d.size)-parseFloat(d.used)).toFixed(0);
    const id=d.mount.replace(/[:\\]/g,'');
    const card=document.createElement('div');card.className='disk-card';
    card.innerHTML=`<div class="disk-header"><i class="ti ti-device-hard-disk" style="font-size:22px;color:${color}"></i><div><div class="disk-name">${d.mount}</div><div class="disk-mount">${d.fs}</div></div></div>
    <div class="disk-donut"><svg width="80" height="80" viewBox="0 0 80 80"><circle class="donut-bg" cx="40" cy="40" r="${r}"/><circle class="donut-fg" id="disk-arc-${id}" cx="40" cy="40" r="${r}" stroke="${color}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset}"/></svg><div class="disk-pct" id="disk-pct-${id}" style="color:${color}">${pct}%</div></div>
    <div class="disk-stats"><div class="disk-stat"><div class="dst-val" style="color:${color}">${d.used}GB</div><div class="dst-lbl">Belegt</div></div><div class="disk-stat"><div class="dst-val" style="color:rgba(200,220,255,0.5)">${d.size}GB</div><div class="dst-lbl">Gesamt</div></div><div class="disk-stat"><div class="dst-val" style="color:rgba(200,220,255,0.3)">${free}GB</div><div class="dst-lbl">Frei</div></div></div>
    <div class="temp-row"><i class="ti ti-temperature" style="font-size:14px;color:rgba(0,200,255,0.5)"></i><span class="temp-val" id="temp-${id}" style="color:rgba(0,200,255,0.6)">--°C</span><span class="temp-lbl">Temperatur</span></div>`;
    grid.appendChild(card);
  });
  window.ctrl.getDiskTemp().then(temps=>{temps.forEach(t=>{if(!t.temp)return;const col=t.temp>55?'#ff4444':t.temp>45?'#ffaa00':'#00ff99';disks.forEach(d=>{const el=document.getElementById('temp-'+d.mount.replace(/[:\\]/g,''));if(el){el.textContent=t.temp+'°C';el.style.color=col;}});});}).catch(()=>{});
}

// ── Ping ──────────────────────────────────────────────
const pingBases={'ping-cs2':18,'ping-val':22,'ping-lol':29,'ping-wz':44,'ping-dc':12,'ping-st':35};
function updatePings(){Object.entries(pingBases).forEach(([id,base])=>{const ms=base+Math.floor(Math.random()*15);const el=document.getElementById(id);if(!el)return;el.textContent=ms+'ms';el.className='ping-ms mono '+(ms<40?'pg-c':ms<80?'py-c':'pr-c');const dot=el.previousElementSibling;if(dot?.classList.contains('ping-dot'))dot.className='ping-dot '+(ms<40?'pg':ms<80?'py':'pr');});}

// ── AUDIO MIXER — dynamisch ───────────────────────────
// Bekannte Prozesse mit Icon/Farbe/Label
const KNOWN_PROCS={
  chrome:   {label:'Chrome',  icon:'ti-world',           color:'#4db8ff'},
  msedge:   {label:'Edge',    icon:'ti-brand-edge',      color:'#0078d4'},
  firefox:  {label:'Firefox', icon:'ti-browser',         color:'#ff7139'},
  spotify:  {label:'Spotify', icon:'ti-music',           color:'#1db954'},
  discord:  {label:'Discord', icon:'ti-message-2',       color:'#7289da'},
  steam:    {label:'Steam',   icon:'ti-device-gamepad-2',color:'#1b9bd3'},
  vlc:      {label:'VLC',     icon:'ti-player-play',     color:'#ff8800'},
  teams:    {label:'Teams',   icon:'ti-users',           color:'#6264a7'},
  slack:    {label:'Slack',   icon:'ti-brand-slack',     color:'#4a154b'},
  zoom:     {label:'Zoom',    icon:'ti-video',           color:'#2d8cff'},
  obs64:    {label:'OBS',     icon:'ti-record-mail',     color:'#302e31'},
  brave:    {label:'Brave',   icon:'ti-shield',          color:'#fb542b'},
  twitch:   {label:'Twitch',  icon:'ti-brand-twitch',    color:'#9146ff'},
};

// Audio-only prozesse die wir überwachen
const AUDIO_PROC_LIST=Object.keys(KNOWN_PROCS);

async function refreshAudioMixer(){
  try{
    const procs=await window.ctrl.getRunningAudio();
    const procNames=procs.map(p=>p.name.toLowerCase());
    const grid=document.getElementById('apps-grid');
    if(!grid)return;

    // Finde welche bekannten Prozesse laufen
    // System-Sound ist immer da (Windows Audio Device, kein Prozess)
    const running=AUDIO_PROC_LIST.filter(p=>procNames.includes(p.toLowerCase()));
    const allApps=[...new Set([...running])];

    // Prüfe ob sich was geändert hat
    const currentIds=allApps.join(',');
    if(audioAppsCache.join(',')=== currentIds) return; // nichts geändert
    audioAppsCache=allApps;

    // Grid neu aufbauen
    grid.innerHTML='';

    // System Sound Card IMMER anzeigen (Windows Audio Device)
    grid.appendChild(buildAudioCard('system','System','ti-bell','#ff4444','System Sounds',100));

    // Laufende Apps (Firefox, Steam, etc.)
    allApps.forEach(proc=>{
      const info=KNOWN_PROCS[proc];
      if(!info)return;
      const existingVol=getStoredVol(proc);
      grid.appendChild(buildAudioCard(proc,info.label,info.icon,info.color,proc+'.exe',existingVol));
    });

    // VU-Meter aufbauen
    buildAllVuMeters();

    // Mute-States wiederherstellen
    Object.entries(muteState).forEach(([id,muted])=>{
      if(muted){
        const btn=document.getElementById('mbtn-'+id);
        if(btn){btn.classList.add('muted');btn.innerHTML='<i class="ti ti-volume-off"></i>Unmute';}
      }
    });

    if(allApps.length===0){
      const empty=document.createElement('div');
      empty.style.cssText='color:rgba(0,200,255,0.35);font-size:11px;letter-spacing:1px;padding:20px;grid-column:1/-1;';
      empty.textContent='Keine Audio-Apps erkannt — starte eine App und sie erscheint hier automatisch.';
      grid.appendChild(empty);
    }
  }catch(e){console.error('audio refresh:',e);}
}

const volStore={};
function getStoredVol(id){return volStore[id]!==undefined?volStore[id]:100;}

function buildAudioCard(id,label,icon,color,proc,vol){
  const div=document.createElement('div');
  div.className='amc'; div.id='amc-'+id;
  div.innerHTML=`
    <div class="amc-top">
      <i class="ti ${icon} aico" style="color:${color}"></i>
      <div class="aname">${label}</div>
      <div class="aproc">${proc}</div>
    </div>
    <div class="avr">
      <input type="range" min="0" max="100" value="${vol}" class="avs" id="avs-${id}"
        style="background:linear-gradient(90deg,${color} ${vol}%,rgba(255,255,255,0.07) ${vol}%)"
        oninput="updAV(this,'${color}','avn-${id}','${id==='system'?'':proc.replace('.exe','')}')">
      <span class="avn" id="avn-${id}" style="color:${color}">${vol}%</span>
    </div>
    <div class="afooter">
      <div class="vub" id="vu-${id}"></div>
      <button class="mbtn" id="mbtn-${id}" onclick="togM(this,'${id}','${id==='system'?'':proc.replace('.exe','')}')">
        <i class="ti ti-volume-3"></i>Mute
      </button>
    </div>`;
  return div;
}

function buildAllVuMeters(){
  document.querySelectorAll('.vub').forEach(el=>{
    const id=el.id.replace('vu-','');
    const color=KNOWN_PROCS[id]?.color||(id==='system'?'#ff4444':'#00d4ff');
    el.innerHTML=Array.from({length:7},(_,i)=>`<div class="vubar" style="background:${color};opacity:0.6;height:${2+i*2}px"></div>`).join('');
  });
}

setInterval(()=>{
  document.querySelectorAll('.vub').forEach(el=>{
    const id=el.id.replace('vu-','');
    if(muteState[id]){el.querySelectorAll('.vubar').forEach(b=>{b.style.opacity='0.07';b.style.height='2px';});return;}
    el.querySelectorAll('.vubar').forEach(b=>{const on=Math.random()>0.35;b.style.opacity=on?(0.4+Math.random()*0.6).toFixed(2):'0.08';b.style.height=on?(2+Math.random()*13).toFixed(0)+'px':'2px';});
  });
},110);

window.updMaster=function(el){const v=el.value;el.style.background=`linear-gradient(90deg,#00d4ff ${v}%,rgba(255,255,255,0.07) ${v}%)`;setEl('master-val',v+'%');};
let volDebounce={};
window.updAV=function(el,color,valId,proc){
  const v=el.value;
  el.style.background=`linear-gradient(90deg,${color} ${v}%,rgba(255,255,255,0.07) ${v}%)`;
  setEl(valId,v+'%');
  const id=valId.replace('avn-','');
  volStore[id]=parseInt(v);
  // Debounce: warte 400ms nach letzter Bewegung bevor PS gestartet wird
  if(proc){
    clearTimeout(volDebounce[id]);
    volDebounce[id]=setTimeout(()=>{
      window.ctrl.setAppVolume(proc,parseInt(v)).catch(()=>{});
    },400);
  }
};
window.togM=function(btn,id,proc){
  muteState[id]=!muteState[id];
  btn.classList.toggle('muted',muteState[id]);
  btn.innerHTML=muteState[id]?'<i class="ti ti-volume-off"></i>Unmute':'<i class="ti ti-volume-3"></i>Mute';
  if(id==='system'){
    window.ctrl.setSystemMute(muteState[id]).catch(()=>{});
    updateMuteStatusDot(muteState[id]);
  } else if(proc) {
    // Use dedicated muteApp — nircmd muteappvolume is reliable
    window.ctrl.muteApp(proc, muteState[id]).catch(()=>{});
  }
};

// ── Auto-Mute ─────────────────────────────────────────
window.toggleAM=async function(cb){
  config.autoMuteSystem=cb.checked;
  await window.ctrl.saveConfig(config).catch(()=>{});
  const banner=document.getElementById('amb');
  if(cb.checked){
    banner?.classList.add('on');
    setEl('amg','AKTIV — BEIM START');
    setEl('amd','System Sound wird beim nächsten Start automatisch gemutet');
    updateMuteStatusDot(true);
    window.ctrl.setSystemMute(true).catch(()=>{});
    muteState['system']=true;
    const btn=document.getElementById('mbtn-system');
    if(btn){btn.classList.add('muted');btn.innerHTML='<i class="ti ti-volume-off"></i>Unmute';}
    const sl=document.getElementById('avs-system');
    if(sl){sl.value=0;window.updAV(sl,'#ff4444','avn-system','');}
  } else {
    banner?.classList.remove('on');
    setEl('amg','DEAKTIVIERT');
    setEl('amd','Inaktiv — System Sound wird beim Start nicht stummgeschaltet');
    updateMuteStatusDot(false);
    window.ctrl.setSystemMute(false).catch(()=>{});
  }
};
function updateMuteStatusDot(m){const dot=document.getElementById('d-mute-dot'),val=document.getElementById('d-mute-val');if(dot){dot.style.background=m?'#ffaa00':'rgba(255,255,255,0.13)';dot.style.boxShadow=m?'0 0 6px #ffaa00':'none';}if(val)val.textContent=m?'AKTIV':'AUS';}
function applyConfig(){const cb=document.getElementById('amt');if(cb&&config.autoMuteSystem){cb.checked=true;document.getElementById('amb')?.classList.add('on');setEl('amg','AKTIV — BEIM START');setEl('amd','System Sound wird beim nächsten Start automatisch gemutet');updateMuteStatusDot(true);}}

// ── Shutdown Timer ────────────────────────────────────
window.setPreset=function(mins,btn){document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('sel'));btn.classList.add('sel');document.getElementById('custom-min').value='';timerSecs=mins*60;setEl('td',fmtSecs(timerSecs));setEl('ts',mins+' Minuten ausgewählt');};
window.startTimer=async function(){
  const custom=parseInt(document.getElementById('custom-min').value);
  const mins=custom>0?custom:Math.ceil(timerSecs/60);
  if(!mins||mins<1){showToast('Bitte Zeit auswählen!');return;}
  if(timerInterval)clearInterval(timerInterval);
  timerSecs=mins*60;
  const td=document.getElementById('td');
  td?.classList.remove('warning');td?.classList.add('running');
  const dot=document.getElementById('d-timer-dot');
  if(dot){dot.style.background='#ffaa00';dot.style.boxShadow='0 0 6px #ffaa00';}
  setEl('d-timer-val','AKTIV');
  await window.ctrl.startShutdownTimer(timerSecs).catch(()=>{});
  showToast(`✓ PC fährt in ${mins} Minuten herunter.`);
  timerInterval=setInterval(()=>{timerSecs--;if(timerSecs<=0){clearInterval(timerInterval);timerInterval=null;setEl('td','00:00:00');td?.classList.remove('running');setEl('ts','⚡ PC wird heruntergefahren...');setEl('d-timer-val','SHUTDOWN');return;}setEl('td',fmtSecs(timerSecs));if(timerSecs<=60)td?.classList.add('warning');setEl('ts',`Herunterfahren in ${timerSecs>60?Math.ceil(timerSecs/60)+' Min':timerSecs+' Sek'}`);},1000);
};
window.stopTimer=async function(){if(timerInterval){clearInterval(timerInterval);timerInterval=null;}timerSecs=0;const td=document.getElementById('td');setEl('td','00:00:00');td?.classList.remove('running','warning');setEl('ts','Timer abgebrochen');const dot=document.getElementById('d-timer-dot');if(dot){dot.style.background='rgba(255,255,255,0.13)';dot.style.boxShadow='none';}setEl('d-timer-val','INAKTIV');document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('sel'));await window.ctrl.cancelShutdownTimer().catch(()=>{});showToast('Shutdown-Timer abgebrochen.');};

// ── Logout ────────────────────────────────────────────
window.doLogout=function(){localStorage.removeItem('ctrl-session');window.ctrl.logout();};

// ── Uptime Record ─────────────────────────────────────
const REC_KEY='ctrl-uptime-v2';
function loadUptimeRecord(){try{const r=JSON.parse(localStorage.getItem(REC_KEY)||'null');if(r){setEl('rec-val',fmtSecs(r.secs));setEl('rec-date','Erreicht am '+r.date);}else{setEl('rec-val','--:--:--');setEl('rec-date','Noch kein Rekord');}}catch{}}
function checkUptimeRecord(secs){try{const r=JSON.parse(localStorage.getItem(REC_KEY)||'null');if(!r||secs>r.secs){const nr={secs,date:new Date().toLocaleDateString('de-DE')};localStorage.setItem(REC_KEY,JSON.stringify(nr));setEl('rec-val',fmtSecs(secs));setEl('rec-date','Heute — neuer Rekord! 🎉');}}catch{}}

// ── Toast ─────────────────────────────────────────────
function showToast(msg){let t=document.getElementById('ctrl-toast');if(!t){t=document.createElement('div');t.id='ctrl-toast';t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(10,12,16,0.95);border:1px solid rgba(0,200,255,0.3);color:#00d4ff;padding:9px 18px;border-radius:7px;font-size:11px;letter-spacing:1px;z-index:9999;font-family:Rajdhani,sans-serif;font-weight:600;transition:opacity 0.3s;white-space:nowrap;';document.body.appendChild(t);}t.textContent=msg;t.style.opacity='1';clearTimeout(t._t);t._t=setTimeout(()=>t.style.opacity='0',3000);}

// ═══════════════════════════════════════════════════════
// GAMES TAB
// ═══════════════════════════════════════════════════════
const GAMES_KEY = 'ctrl-games-v1';

function loadGames() {
  try { return JSON.parse(localStorage.getItem(GAMES_KEY) || '[]'); } catch { return []; }
}
function saveGames(games) {
  try { localStorage.setItem(GAMES_KEY, JSON.stringify(games)); } catch {}
}

function renderGames() {
  const grid = document.getElementById('games-grid');
  if (!grid) return;
  const games = loadGames();
  grid.innerHTML = '';
  if (games.length === 0) {
    grid.innerHTML = '<div style="color:rgba(0,200,255,0.35);font-size:11px;letter-spacing:1px;padding:10px;grid-column:1/-1;">Noch keine Spiele hinzugefügt — klick auf + um zu starten.</div>';
    return;
  }
  games.forEach((game, idx) => {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.onclick = () => window.ctrl.launchApp(game.path).then(() => showToast(game.name + ' wird gestartet...')).catch(() => showToast('Fehler beim Starten'));
    card.innerHTML = `
      <button class="game-card-remove" onclick="removeGame(event,${idx})" title="Entfernen"><i class="ti ti-x"></i></button>
      <i class="ti ti-device-gamepad-2 game-card-icon"></i>
      <div class="game-card-name">${game.name}</div>
      <div class="game-card-path" title="${game.path}">${game.path.split('\\').pop()}</div>`;
    grid.appendChild(card);
  });
}

window.addGame = async function() {
  try {
    const exePath = await window.ctrl.pickExe();
    if (!exePath) return;
    const name = exePath.split('\\').pop().replace('.exe','').replace(/[-_]/g,' ');
    const games = loadGames();
    // Kein Duplikat
    if (games.find(g => g.path === exePath)) { showToast('Dieses Spiel ist bereits hinzugefügt.'); return; }
    games.push({ name, path: exePath });
    saveGames(games);
    renderGames();
    showToast('✓ ' + name + ' hinzugefügt!');
  } catch(e) { showToast('Fehler beim Hinzufügen'); }
};

window.removeGame = function(e, idx) {
  e.stopPropagation();
  const games = loadGames();
  const name = games[idx]?.name || 'Spiel';
  games.splice(idx, 1);
  saveGames(games);
  renderGames();
  showToast(name + ' entfernt.');
};

// Render on load
document.addEventListener('DOMContentLoaded', () => renderGames());

// ═══════════════════════════════════════════════════════
// GPU DRIVER CHECK
// ═══════════════════════════════════════════════════════
async function checkGpuDriver() {
  const el = document.getElementById('driver-alert-dash');
  if (!el) return;
  try {
    const info = await window.ctrl.checkGpuDriver();
    if (info.error) return;
    if (info.outdated) {
      el.innerHTML = `
        <div class="driver-alert">
          <i class="ti ti-alert-triangle" style="color:#ffaa00;"></i>
          <div class="driver-alert-text">
            <div class="driver-alert-title" style="color:#ffaa00;">GPU Treiber veraltet!</div>
            ${info.name} — Version ${info.version}<br>
            Installiert: ${info.driverDate} (${info.monthsOld} Monate alt) — Update empfohlen
          </div>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="driver-alert driver-alert-ok">
          <i class="ti ti-circle-check" style="color:#00ff99;"></i>
          <div class="driver-alert-text">
            <div class="driver-alert-title" style="color:#00ff99;">GPU Treiber aktuell</div>
            ${info.name} — Version ${info.version} — ${info.driverDate}
          </div>
        </div>`;
      // Grüne Meldung nach 5 Sek ausblenden
      setTimeout(() => { if(el) el.innerHTML = ''; }, 5000);
    }
  } catch {}
}

// Driver check beim Start und dann täglich (alle 12h)
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(checkGpuDriver, 3000);
  setInterval(checkGpuDriver, 12 * 60 * 60 * 1000);
});

// ═══════════════════════════════════════════════════════
// WINDOWS DEFENDER TOGGLE
// ═══════════════════════════════════════════════════════
async function initDefender() {
  try {
    const enabled = await window.ctrl.getDefenderStatus();
    const toggle = document.getElementById('defender-toggle');
    if (!toggle || enabled === null || enabled === undefined) return;
    // Wert setzen BEVOR der Listener hinzugefügt wird
    toggle.checked = enabled;
    updateDefenderUI(enabled);
    // Listener erst NACH dem Init setzen
    toggle.addEventListener('change', () => toggleDefender(toggle));
  } catch {}
}

function updateDefenderUI(enabled) {
  const dot   = document.getElementById('defender-dot');
  const label = document.getElementById('defender-label');
  if (!dot || !label) return;
  if (enabled) {
    dot.style.background  = '#00ff99';
    dot.style.boxShadow   = '0 0 6px #00ff99';
    label.textContent     = 'Echtzeit-Schutz aktiv';
    label.style.color     = 'rgba(0,255,150,0.7)';
  } else {
    dot.style.background  = '#ff4444';
    dot.style.boxShadow   = '0 0 6px #ff4444';
    label.textContent     = 'Echtzeit-Schutz deaktiviert!';
    label.style.color     = 'rgba(255,80,80,0.8)';
  }
}

window.toggleDefender = async function(cb) {
  const enable = cb.checked;
  cb.disabled  = true;
  showToast(enable ? 'Defender wird aktiviert...' : 'Defender wird deaktiviert...');
  try {
    const ok = await window.ctrl.setDefender(enable);
    if (ok) {
      updateDefenderUI(enable);
      showToast(enable ? '✓ Defender aktiviert' : '⚠ Defender deaktiviert');
    } else {
      cb.checked = !enable;
      showToast('Konnte nicht geändert werden — bitte als Admin starten');
    }
  } catch {
    cb.checked = !enable;
    showToast('Fehler beim Ändern des Defenders');
  }
  cb.disabled = false;
};

// ═══════════════════════════════════════════════════════
// SPOTIFY CONTROLS
// ═══════════════════════════════════════════════════════
window.spotifyCtrl = async function(action) {
  try {
    await window.ctrl.spotifyControl(action);
    // Warte kurz dann Track neu laden
    setTimeout(fetchSpotifyTrack, 600);
  } catch {}
};

async function fetchSpotifyTrack() {
  try {
    const track = await window.ctrl.getSpotifyTrack();
    const songEl   = document.getElementById('spotify-song');
    const artistEl = document.getElementById('spotify-artist');
    if (!songEl) return;
    if (track) {
      songEl.textContent   = track.song;
      artistEl.textContent = track.artist;
    } else {
      songEl.textContent   = 'Spotify nicht geöffnet';
      artistEl.textContent = '';
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════
// WETTER (OpenMeteo — kostenlos, kein API Key nötig)
// ═══════════════════════════════════════════════════════
const WEATHER_ICONS = {
  0:'☀️',1:'🌤️',2:'⛅',3:'☁️',
  45:'🌫️',48:'🌫️',
  51:'🌦️',53:'🌦️',55:'🌧️',
  61:'🌧️',63:'🌧️',65:'🌧️',
  71:'❄️',73:'❄️',75:'❄️',
  80:'🌦️',81:'🌧️',82:'⛈️',
  95:'⛈️',96:'⛈️',99:'⛈️',
};
const WEATHER_DESC = {
  0:'Klar',1:'Meist klar',2:'Teilweise bewölkt',3:'Bedeckt',
  45:'Nebel',48:'Nebel',
  51:'Leichter Nieselregen',53:'Nieselregen',55:'Starker Nieselregen',
  61:'Leichter Regen',63:'Regen',65:'Starker Regen',
  71:'Leichter Schnee',73:'Schnee',75:'Starker Schnee',
  80:'Regenschauer',81:'Starke Schauer',82:'Gewitter',
  95:'Gewitter',96:'Gewitter mit Hagel',99:'Schweres Gewitter',
};

async function fetchWeather() {
  const el = document.getElementById('weather-content');
  if (!el) return;
  el.innerHTML = '<div style="font-size:9px;color:rgba(0,200,255,0.3);letter-spacing:1px;">Wird geladen...</div>';
  try {
    // Standort per IP — mehrere Fallbacks, Oldenburg als letzter Fallback
    let lat = 53.14, lon = 8.21, city = 'Oldenburg'; // Fallback: Oldenburg
    const geoApis = [
      async () => {
        const r = await fetch('https://ip-api.com/json/?fields=status,lat,lon,city', {cache:'no-store'});
        const d = await r.json();
        if (d.status === 'success' && d.lat) return {lat:d.lat, lon:d.lon, city:d.city};
        return null;
      },
      async () => {
        const r = await fetch('https://ipwho.is/', {cache:'no-store'});
        const d = await r.json();
        if (d.success && d.latitude) return {lat:d.latitude, lon:d.longitude, city:d.city};
        return null;
      },
      async () => {
        const r = await fetch('https://freeipapi.com/api/json', {cache:'no-store'});
        const d = await r.json();
        if (d.latitude) return {lat:d.latitude, lon:d.longitude, city:d.cityName};
        return null;
      },
    ];
    for (const api of geoApis) {
      try {
        const result = await api();
        if (result) { lat = result.lat; lon = result.lon; city = result.city || city; break; }
      } catch {}
    }

    // Wetter von Open-Meteo
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&wind_speed_unit=kmh&timezone=auto`;
    const res  = await fetch(url, {cache:'no-store'});
    if (!res.ok) throw new Error('Weather API error');
    const data = await res.json();
    const cw   = data.current_weather;
    const code = cw.weathercode;
    const icon = WEATHER_ICONS[code] ?? '🌡️';
    const desc = WEATHER_DESC[code]  ?? 'Unbekannt';
    const temp = Math.round(cw.temperature);
    const wind = Math.round(cw.windspeed);

    el.innerHTML = `
      <div class="weather-icon" style="font-size:30px;line-height:1;">${icon}</div>
      <div style="flex:1;">
        <div class="weather-temp">${temp}°<span style="font-size:14px;color:rgba(0,200,255,0.5);">C</span></div>
        <div class="weather-desc">${desc}</div>
        <div class="weather-city">📍 ${city} · 💨 ${wind} km/h</div>
      </div>`;

    // Trigger weather effects
    window._lastWeatherCode = code;
    if (typeof getWeatherEffect === 'function') {
      const hour = new Date().getHours();
      const isNight = hour >= 21 || hour < 6;
      const effect = getWeatherEffect(code, isNight);
      if (weatherFxEnabled) {
        if (effect) applyWeatherFx(effect);
        else stopWeatherFx();
      }
    }
  } catch(e) {
    console.error('Weather error:', e);
    el.innerHTML = '<div style="font-size:9px;color:rgba(255,100,100,0.5);letter-spacing:0.5px;">Kein Internet oder API nicht erreichbar</div>';
  }
}

// Init alles beim Start
window.addEventListener('DOMContentLoaded', () => {
  initDefender();
  fetchSpotifyTrack();
  setInterval(fetchSpotifyTrack, 5000);
  fetchWeather();
  setInterval(fetchWeather, 10 * 60 * 1000); // alle 10 Min
});

// ═══════════════════════════════════════════════════════
// MISC — Farben & Hintergrund
// ═══════════════════════════════════════════════════════
const MISC_KEY = 'ctrl-misc-v1';

function loadMiscSettings() {
  try { return JSON.parse(localStorage.getItem(MISC_KEY) || '{}'); } catch { return {}; }
}
function saveMiscSettings(s) {
  try { localStorage.setItem(MISC_KEY, JSON.stringify(s)); } catch {}
}

// Farbe smooth per CSS Variable
function applyAccent(color, glow, animate) {
  const root = document.documentElement;
  if (animate) {
    // Smooth transition
    document.body.style.transition = 'filter 0.4s ease';
    setTimeout(() => document.body.style.transition = '', 500);
  }
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-glow', glow || color);

  // Alle accent-farbigen Elemente updaten
  const style = document.getElementById('accent-dynamic-style') || (() => {
    const s = document.createElement('style');
    s.id = 'accent-dynamic-style';
    document.head.appendChild(s);
    return s;
  })();

  style.textContent = `
    :root { --accent: ${color}; --accent-glow: ${glow}; }
    .logo-dot { background: ${color} !important; box-shadow: 0 0 10px ${color} !important; }
    .app-title { color: ${color} !important; }
    .tab-btn.active { color: ${color} !important; border-bottom-color: ${color} !important; }
    .bfill { background: linear-gradient(90deg, ${glow}, ${color}) !important; }
    .pcenter { background: ${color} !important; }
    .pulse-ring::before, .pulse-ring::after { border-color: ${color}88 !important; }
    .logo-dot { background: ${color} !important; }
    .clk { color: ${color}88 !important; }
    .plabel { color: ${color}66 !important; }
    .net-val { color: ${color} !important; }
    .master-val { color: ${color} !important; }
    .vol-slider { background: linear-gradient(90deg, ${color} var(--sl-pct, 80%), rgba(255,255,255,0.07) var(--sl-pct, 80%)) !important; }
    .vol-slider::-webkit-slider-thumb { background: ${color} !important; box-shadow: 0 0 8px ${color}99 !important; }
    .hico { color: ${color}88 !important; }
    .hbtn:hover .hico { color: ${color} !important; }
    .sval { color: ${color}aa !important; }
    .timer-display.running { color: ${color} !important; text-shadow: 0 0 30px ${color}55 !important; }
    .tbtn-start { border-color: ${color}66 !important; color: ${color} !important; }
    .preset-btn:hover, .preset-btn.sel { border-color: ${color} !important; color: ${color} !important; }
    .panel::before { background: linear-gradient(90deg, transparent, ${color}55, transparent) !important; }
    #master-val { color: ${color} !important; }
    .tok { background: ${color} !important; box-shadow: 0 0 6px ${color} !important; }
  `;
}

window.setAccent = function(color, glow, btn) {
  document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyAccent(color, glow, true);
  const s = loadMiscSettings();
  s.accent = color; s.accentGlow = glow;
  saveMiscSettings(s);
};

window.setAccentCustom = function(color) {
  document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
  applyAccent(color, color, true);
  const s = loadMiscSettings();
  s.accent = color; s.accentGlow = color;
  saveMiscSettings(s);
};

// Hintergrund
const BG_GRADIENTS = {
  none:      'none',
  gradient1: 'radial-gradient(ellipse at top left, #0d1b2a 0%, #0a0c10 60%)',
  gradient2: 'radial-gradient(ellipse at top right, #1a0a2e 0%, #0a0c10 60%)',
  gradient3: 'radial-gradient(ellipse at bottom, #0d2010 0%, #0a0c10 60%)',
  gradient4: 'radial-gradient(ellipse at top, #1f0a0a 0%, #0a0c10 60%)',
};

function applyBackground(type, imageData, opacity) {
  let bgStyle = '';
  if (imageData) {
    bgStyle = `url("${imageData}") center/cover no-repeat fixed`;
  } else if (type && BG_GRADIENTS[type] && BG_GRADIENTS[type] !== 'none') {
    bgStyle = BG_GRADIENTS[type];
  }

  let overlay = document.getElementById('bg-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'bg-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;transition:all 0.6s ease;';
    document.body.prepend(overlay);
  }

  if (bgStyle) {
    overlay.style.background = bgStyle;
    overlay.style.opacity = ((opacity || 15) / 100).toFixed(2);
  } else {
    overlay.style.background = 'none';
    overlay.style.opacity = '0';
  }
}

window.setBackground = function(type, btn) {
  document.querySelectorAll('.bg-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const s = loadMiscSettings();
  s.bg = type; delete s.bgImage;
  saveMiscSettings(s);
  document.getElementById('bg-filename').textContent = 'Kein Bild ausgewählt';
  applyBackground(type, null, s.bgOpacity || 15);
};

window.pickBackground = async function() {
  try {
    const imageData = await window.ctrl.pickImage();
    if (!imageData) return;
    const s = loadMiscSettings();
    s.bgImage = imageData; s.bg = 'custom';
    saveMiscSettings(s);
    document.getElementById('bg-filename').textContent = 'Bild geladen ✓';
    document.querySelectorAll('.bg-preset').forEach(b => b.classList.remove('active'));
    applyBackground('custom', imageData, s.bgOpacity || 15);
  } catch(e) { showToast('Fehler beim Laden des Bildes'); }
};

window.removeBackground = function() {
  const s = loadMiscSettings();
  delete s.bgImage; s.bg = 'none';
  saveMiscSettings(s);
  document.getElementById('bg-filename').textContent = 'Kein Bild ausgewählt';
  document.querySelectorAll('.bg-preset').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-bg="none"]')?.classList.add('active');
  applyBackground('none', null, 15);
};

window.setBgOpacity = function(el) {
  const v = el.value;
  el.style.background = `linear-gradient(90deg, var(--accent) ${v}%, rgba(255,255,255,0.07) ${v}%)`;
  document.getElementById('bg-opacity-val').textContent = v + '%';
  const s = loadMiscSettings();
  s.bgOpacity = parseInt(v);
  saveMiscSettings(s);
  applyBackground(s.bg, s.bgImage, parseInt(v));
};

// Beim Start gespeicherte Einstellungen anwenden
window.addEventListener('DOMContentLoaded', () => {
  const s = loadMiscSettings();
  if (s.accent) {
    applyAccent(s.accent, s.accentGlow || s.accent, false);
    // Aktiven Preset-Button markieren
    document.querySelectorAll('.color-preset').forEach(btn => {
      if (btn.dataset.color === s.accent) btn.classList.add('active');
      else btn.classList.remove('active');
    });
    const customPicker = document.getElementById('custom-color');
    if (customPicker) customPicker.value = s.accent;
  }
  if (s.bg || s.bgImage) {
    applyBackground(s.bg, s.bgImage, s.bgOpacity || 15);
    if (s.bg) {
      document.querySelectorAll('.bg-preset').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.bg === s.bg);
      });
    }
    const opSlider = document.getElementById('bg-opacity-slider');
    if (opSlider && s.bgOpacity) {
      opSlider.value = s.bgOpacity;
      opSlider.style.background = `linear-gradient(90deg, var(--accent) ${s.bgOpacity}%, rgba(255,255,255,0.07) ${s.bgOpacity}%)`;
      document.getElementById('bg-opacity-val').textContent = s.bgOpacity + '%';
    }
    if (s.bgImage) document.getElementById('bg-filename').textContent = 'Bild geladen ✓';
  }
});

// ═══════════════════════════════════════════════════════
// AI ASSISTANT — Groq (kostenlos)
// ═══════════════════════════════════════════════════════
const GROQ_KEY_STORAGE = 'ctrl-groq-key';
let aiMessages = [
  { role: 'system', content: `Du bist CTRL AI — gleichzeitig Assistent UND System-Analyst des CTRL Gaming & QOL Dashboards.

CTRL ist ein Windows-Tool mit folgenden Features:
- Dashboard: CPU/RAM/GPU Monitoring, Schnellstart-Apps, Netzwerk, Wetter
- Audio Mixer: Lautstärke pro App steuern, System-Mute beim Start
- Festplatten: Belegung, freier Speicher, Temperaturen
- Netzwerk: Download/Upload Speed, Game-Server Ping
- Shutdown Timer: PC automatisch herunterfahren
- Spiele Tab: Eigene Spiele als Schnellstart hinzufügen
- Session Stats: Uptime-Rekord, CPU/RAM Durchschnitt
- MISC: Akzentfarben, Hintergründe, KI-Einstellungen

Deine Aufgaben:
- SYSTEM-ANALYST: Wenn du einen [SYSTEM-SNAPSHOT] in der Nachricht siehst, analysiere die echten Werte und gib konkrete Diagnosen. Sage nicht "überprüfe deinen RAM" wenn du die Werte siehst — sage "dein RAM ist zu X% belegt, das ist das Problem".
- Zeige den SYSTEM-SNAPSHOT dem User NIEMALS direkt — nutze ihn nur für deine Analyse.
- Helfe bei Fragen zu CTRL und seinen Features
- Beantworte Gaming-Fragen (Tipps, Einstellungen, Performance)
- Helfe bei Windows-Problemen und PC-Optimierung
- Beantworte allgemeine Fragen freundlich

Antworte IMMER auf Deutsch. Sei kurz und direkt — maximal 3-4 Saetze. Nutze manchmal passende Emojis.
Wenn GPU-Temp als 'N/A' oder 'Sensor nicht verfuegbar' steht, erklaere dass die RX 9060 XT (Mai 2025) noch keinen standardisierten Windows-Temperatursensor hat — das ist normal und kein Problem.` }
];

function getGroqKey() {
  return localStorage.getItem(GROQ_KEY_STORAGE) || '';
}

window.saveGroqKey = function(val) {
  localStorage.setItem(GROQ_KEY_STORAGE, val.trim());
  updateAIHint();
};

function updateAIHint() {
  const hint = document.getElementById('ai-key-hint');
  const key  = getGroqKey();
  if (hint) hint.textContent = key ? '✓ API Key gesetzt — bereit!' : 'Groq API Key im MISC Tab eintragen';
}

window.testGroqKey = async function() {
  const key = getGroqKey();
  if (!key) { showToast('Bitte erst einen API Key eintragen'); return; }
  showToast('Teste Key...');
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role:'user', content:'Hi' }], max_tokens: 5 })
    });
    if (res.ok) showToast('✓ Key funktioniert!');
    else showToast('❌ Key ungültig — bitte prüfen');
  } catch { showToast('Verbindungsfehler'); }
};

window.toggleAI = function() {
  const win = document.getElementById('ai-window');
  win.classList.toggle('open');
  if (win.classList.contains('open')) {
    document.getElementById('ai-input')?.focus();
    updateAIHint();
    // Key im Input anzeigen wenn gesetzt
    const keyInput = document.getElementById('groq-key-input');
    if (keyInput && !keyInput.value) keyInput.value = getGroqKey();
  }
};

// Keywords that trigger system analysis
const SYSTEM_KEYWORDS = ['laggt','lag','langsam','cpu','ram','gpu','temp','festplatte','netzwerk','ping','fps','performance','prozess','speicher','heiß','überhitzt','abstürzt','crash','warum','analyse','check','problem','hilf'];

window.sendAI = async function() {
  const input = document.getElementById('ai-input');
  const msgs  = document.getElementById('ai-messages');
  const text  = input?.value.trim();
  if (!text) return;

  const key = getGroqKey();
  if (!key) {
    showToast('Bitte erst Groq API Key im MISC Tab eintragen');
    return;
  }

  input.value = '';
  addAIMessage(text, 'user');

  // Check if system analysis is needed
  const needsAnalysis = SYSTEM_KEYWORDS.some(kw => text.toLowerCase().includes(kw));
  let userContent = text;

  if (needsAnalysis) {
    // Show analyzing indicator
    const analyzeEl = document.createElement('div');
    analyzeEl.className = 'ai-msg ai-msg-bot ai-msg-typing';
    analyzeEl.id = 'ai-analyzing';
    analyzeEl.textContent = '🔍 System wird analysiert...';
    msgs.appendChild(analyzeEl);
    msgs.scrollTop = msgs.scrollHeight;

    try {
      const snap = await window.ctrl.getSystemSnapshot();
      document.getElementById('ai-analyzing')?.remove();
      if (snap) {
        const diskInfo = snap.disk_usage.map(d => `${d.drive} ${d.use_pct}% belegt (${d.free_gb}GB frei)`).join(', ');
        const snapLines = [
          '[SYSTEM-SNAPSHOT - NUR FUER ANALYSE]',
          'CPU: ' + (snap.cpu_name||'Unbekannt') + ' | Auslastung: ' + snap.cpu_pct + '% | Temp: ' + (snap.cpu_temp||'N/A') + 'C | Kerne: ' + (snap.cpu_cores||'?'),
          'RAM: ' + snap.ram_pct + '% belegt | ' + snap.ram_free_gb + 'GB frei von ' + (snap.ram_total_gb||'?') + 'GB',
          'GPU: ' + (snap.gpu_name||'Unbekannt') + ' | Auslastung: ' + snap.gpu_pct + '% | Temp: ' + (snap.gpu_temp ? snap.gpu_temp+'C' : 'N/A - AMD RX 9060 XT Sensor nicht verfuegbar'),
          'Netzwerk: Down ' + snap.net_dl_mbs + ' MB/s Up ' + snap.net_ul_mbs + ' MB/s',
          'Festplatten: ' + diskInfo,
        ];
        userContent = text + '\n\n' + snapLines.join('\n');
      }
    } catch { document.getElementById('ai-analyzing')?.remove(); }
  }

  aiMessages.push({ role: 'user', content: userContent });

  // Typing indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'ai-msg ai-msg-bot ai-msg-typing';
  typingEl.textContent = '...';
  typingEl.id = 'ai-typing';
  msgs.appendChild(typingEl);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: aiMessages,
        max_tokens: 300,
        temperature: 0.7,
      })
    });

    const data = await res.json();
    document.getElementById('ai-typing')?.remove();

    if (data.choices?.[0]?.message?.content) {
      const reply = data.choices[0].message.content;
      aiMessages.push({ role: 'assistant', content: reply });
      // Verlauf auf 20 Messages begrenzen
      if (aiMessages.length > 21) aiMessages.splice(1, 2);
      addAIMessage(reply, 'bot');
    } else {
      addAIMessage('Fehler: ' + (data.error?.message || 'Unbekannter Fehler'), 'bot');
    }
  } catch(e) {
    document.getElementById('ai-typing')?.remove();
    addAIMessage('Verbindungsfehler — bitte Internetverbindung prüfen.', 'bot');
  }
};

function addAIMessage(text, type) {
  const msgs = document.getElementById('ai-messages');
  if (!msgs) return;
  const el = document.createElement('div');
  el.className = `ai-msg ai-msg-${type}`;
  el.textContent = text;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

// Key beim Start laden
window.addEventListener('DOMContentLoaded', () => {
  const keyInput = document.getElementById('groq-key-input');
  if (keyInput) keyInput.value = getGroqKey();
  updateAIHint();
});

// ═══════════════════════════════════════════════════════
// RAM FREIGEBEN & CLEANUP
// ═══════════════════════════════════════════════════════
// ── Confirmation Modal ───────────────────────────────
let modalCallback = null;
window.closeModal = function(confirmed) {
  document.getElementById('confirm-modal').style.display = 'none';
  if (modalCallback) { modalCallback(confirmed); modalCallback = null; }
};
function showModal(title, body, confirmLabel) {
  return new Promise(resolve => {
    modalCallback = resolve;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    if(confirmLabel) document.getElementById('modal-confirm-btn').innerHTML = `<i class="ti ti-check"></i> ${confirmLabel}`;
    document.getElementById('confirm-modal').style.display = 'flex';
  });
}

window.doFreeRam = async function() {
  const confirmed = await showModal(
    'RAM freigeben',
    `<strong style="color:#e0f4ff;">Was passiert:</strong><br>
    • Garbage Collection wird ausgeführt<br>
    • Standby-Speicher wird freigegeben<br>
    • Papierkorb wird geleert<br><br>
    <span style="color:rgba(0,255,150,0.6);">✓ Läuft im Hintergrund, keine Daten werden gelöscht</span>`,
    'Freigeben'
  );
  if (!confirmed) return;
  const val = document.getElementById('ram-free-val');
  if(val) val.textContent = '...';
  showToast('RAM wird freigegeben...');
  try {
    const res = await window.ctrl.freeRam();
    if(val) val.textContent = res.freeMB > 0 ? res.freeMB + ' GB frei' : '';
    showToast('✓ RAM freigegeben!');
  } catch { showToast('Fehler beim Freigeben'); }
};

window.doCleanup = async function() {
  // Preview ZUERST laden, dann Modal zeigen
  showToast('Vorschau wird geladen...');
  let previewBody = '<span style="color:rgba(0,200,255,0.5);">Analyse läuft...</span>';
  try {
    const preview = await window.ctrl.getCleanupPreview();
    if (preview) {
      previewBody = `
        <strong style="color:#e0f4ff;">Was wird gelöscht:</strong><br><br>
        📁 <span style="color:rgba(200,220,255,0.7);">Temp-Ordner:</span><br>
        <span style="color:#00d4ff;font-family:monospace;font-size:10px;">${preview.tempPath}</span><br>
        <span style="color:rgba(0,255,150,0.7);">→ ${preview.tempCount} Dateien (${preview.tempMB} MB)</span><br><br>
        🗑️ <span style="color:rgba(200,220,255,0.7);">Papierkorb:</span> <span style="color:rgba(0,255,150,0.7);">${preview.recycleCount} Elemente</span><br><br>
        <span style="color:rgba(255,200,0,0.6);">⚠ Dieser Vorgang kann nicht rückgängig gemacht werden.</span>`;
    }
  } catch(e) {
    previewBody = '<span style="color:rgba(255,100,100,0.6);">Vorschau nicht verfügbar — trotzdem fortfahren?</span>';
  }

  const confirmed = await showModal('Temp + Papierkorb leeren', previewBody, 'Löschen');
  if (!confirmed) return;

  const val = document.getElementById('cleanup-val');
  if(val) val.textContent = '...';
  showToast('Temp-Dateien werden gelöscht...');
  try {
    const res = await window.ctrl.cleanupTemp();
    const freed = res.freedMB > 0 ? res.freedMB + ' MB gespart' : 'Erledigt';
    if(val) val.textContent = freed;
    showToast('✓ ' + freed + '!');
  } catch { showToast('Fehler beim Aufräumen'); }
};

// ═══════════════════════════════════════════════════════
// TEMPERATURE ALERTS
// ═══════════════════════════════════════════════════════
async function checkTemps() {
  try {
    const temps = await window.ctrl.getTemps();
    const el = document.getElementById('temp-alert-dash');
    if (!el) return;
    const alerts = [];
    if (temps.cpu > 85) alerts.push(`CPU: ${temps.cpu}°C`);
    if (temps.gpu > 85) alerts.push(`GPU: ${temps.gpu}°C`);
    if (alerts.length > 0) {
      el.innerHTML = `
        <div class="temp-alert">
          <i class="ti ti-flame temp-alert-icon"></i>
          <div class="temp-alert-text">
            <strong style="color:#ff8888;">⚠ Hohe Temperaturen!</strong><br>
            ${alerts.join(' · ')} — Lüftung prüfen!
          </div>
        </div>`;
    } else {
      el.innerHTML = '';
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════
// AUTOSTART MANAGER
// ═══════════════════════════════════════════════════════
let autostartEntries = [];

window.loadAutostart = async function() {
  const list = document.getElementById('autostart-list');
  if (!list) return;
  list.innerHTML = '<div style="color:rgba(0,200,255,0.35);font-size:11px;letter-spacing:1px;">Wird geladen...</div>';
  try {
    const entries = await window.ctrl.getAutostart();
    autostartEntries = entries;
    if (!entries.length) {
      list.innerHTML = '<div style="color:rgba(0,200,255,0.35);font-size:11px;">Keine Autostart-Einträge gefunden.</div>';
      return;
    }
    list.innerHTML = '';
    entries.forEach((entry, i) => {
      const isDisabled = entry.name.startsWith('_disabled_');
      const displayName = isDisabled ? entry.name.replace('_disabled_', '') : entry.name;
      const isActive = !isDisabled;
      const div = document.createElement('div');
      div.className = 'autostart-entry';
      div.style.opacity = isActive ? '1' : '0.5';
      const shortPath = entry.path.length > 60 ? '...' + entry.path.slice(-57) : entry.path;
      div.innerHTML = `
        <i class="ti ti-rocket" style="font-size:18px;color:${isActive?'rgba(0,200,255,0.5)':'rgba(255,255,255,0.2)'};flex-shrink:0;"></i>
        <div class="autostart-name">
          <div class="autostart-app" style="${isActive?'':'text-decoration:line-through;color:rgba(200,220,255,0.35);'}">${displayName}</div>
          <div class="autostart-path" title="${entry.path}">${shortPath}</div>
        </div>
        <div style="font-size:8px;letter-spacing:1px;color:rgba(0,200,255,0.2);flex-shrink:0;">${entry.hive||'HKCU'}</div>
        <label class="toggle" style="flex-shrink:0;">
          <input type="checkbox" ${isActive?'checked':''} onchange="toggleAutoEntry('${entry.name.replace(/'/g,'')}',this.checked,'${entry.hive||'HKCU'}')">
          <div class="ttrack" style="border-color:rgba(0,200,255,0.2);"></div>
          <div class="tthumb" style="background:rgba(0,200,255,0.3);"></div>
        </label>`;
      list.appendChild(div);
    });
  } catch(e) {
    list.innerHTML = '<div style="color:rgba(255,100,100,0.5);font-size:11px;">Fehler beim Laden — Admin-Rechte nötig.</div>';
  }
};

window.toggleAutoEntry = async function(name, enable, hive) {
  try {
    await window.ctrl.toggleAutostartEntry(name, enable, hive);
    showToast((enable ? '✓ ' : '⊘ ') + name + (enable ? ' aktiviert' : ' deaktiviert'));
  } catch { showToast('Fehler beim Ändern'); }
};

// ═══════════════════════════════════════════════════════
// SESSION — App tracking (längste Laufzeit)
// ═══════════════════════════════════════════════════════
const appTracker = {};
let lastTrackedProcs = [];

async function trackAppUsage() {
  try {
    const procs = await window.ctrl.getRunningAudio();
    const now = Date.now();
    procs.forEach(p => {
      const name = p.name;
      if (!name || name === 'system') return;
      if (!appTracker[name]) appTracker[name] = { start: now, total: 0 };
    });
    // Stop tracking apps that closed
    lastTrackedProcs.forEach(name => {
      if (!procs.find(p => p.name === name) && appTracker[name]) {
        appTracker[name].total += Date.now() - appTracker[name].start;
        appTracker[name].start = null;
      }
    });
    lastTrackedProcs = procs.map(p => p.name);
    renderAppUsage();
  } catch {}
}

function renderAppUsage() {
  const el = document.getElementById('app-usage-list');
  if (!el) return;
  const entries = Object.entries(appTracker)
    .map(([name, data]) => {
      const total = (data.total || 0) + (data.start ? Date.now() - data.start : 0);
      return { name, ms: total };
    })
    .filter(e => e.ms > 60000) // nur über 1 Minute
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 6);

  if (!entries.length) { el.innerHTML = '<div style="font-size:10px;color:rgba(0,200,255,0.3);">Noch keine Daten — Apps werden getrackt...</div>'; return; }
  const max = entries[0].ms;
  el.innerHTML = entries.map(e => {
    const mins = Math.floor(e.ms / 60000);
    const h = Math.floor(mins / 60), m = mins % 60;
    const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
    const pct = Math.round((e.ms / max) * 100);
    return `<div class="usage-row">
      <i class="ti ti-app-window usage-ico" style="color:rgba(0,200,255,0.5)"></i>
      <span class="usage-name">${e.name}</span>
      <div class="usage-bar-wrap"><div class="usage-bar"><div class="usage-bfill" style="width:${pct}%"></div></div></div>
      <span class="usage-time mono" style="color:rgba(0,200,255,0.6)">${timeStr}</span>
    </div>`;
  }).join('');
}

// Init beim Start
window.addEventListener('DOMContentLoaded', () => {
  // Temp check alle 30s
  setTimeout(checkTemps, 5000);
  setInterval(checkTemps, 30000);
  // App tracking alle 30s
  setInterval(trackAppUsage, 30000);
  trackAppUsage();
  // Autostart laden wenn Tab geöffnet wird
  document.querySelector('[onclick*="autostart"]')?.addEventListener('click', () => {
    setTimeout(loadAutostart, 100);
  });
});

// ═══════════════════════════════════════════════════════
// MULLVAD VPN
// ═══════════════════════════════════════════════════════
let mullvadConnected = false;
let mullvadInstalled = false;

async function refreshMullvad() {
  try {
    const s = await window.ctrl.mullvadStatus();
    mullvadInstalled = s.installed;

    const dot    = document.getElementById('mullvad-dot');
    const badge  = document.getElementById('mullvad-status-badge');
    const loc    = document.getElementById('mullvad-location');
    const btn    = document.getElementById('mullvad-btn');
    const notInst= document.getElementById('mullvad-not-installed');
    if (!dot) return;

    if (!s.installed) {
      dot.style.background = 'rgba(255,255,255,0.1)';
      dot.style.boxShadow  = 'none';
      if (badge) badge.textContent = 'NICHT INSTALLIERT';
      if (btn)   btn.style.display = 'none';
      if (notInst) notInst.style.display = 'block';
      return;
    }

    if (notInst) notInst.style.display = 'none';
    if (btn)     btn.style.display = 'block';

    if (s.connecting) {
      dot.style.background = '#ffaa00';
      dot.style.boxShadow  = '0 0 8px #ffaa00';
      if (badge) { badge.textContent = 'VERBINDET...'; badge.style.color = '#ffaa00'; }
      if (btn)   { btn.textContent = 'VERBINDET...'; btn.disabled = true; btn.style.cssText = 'display:block;background:rgba(255,170,0,0.1);border:1px solid rgba(255,170,0,0.3);color:#ffaa00;border-radius:7px;padding:8px 18px;font-family:Rajdhani,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;cursor:not-allowed;'; }
      if (loc)   loc.textContent = '';
    } else if (s.connected) {
      mullvadConnected = true;
      dot.style.background = '#00ff99';
      dot.style.boxShadow  = '0 0 10px #00ff99';
      if (badge) { badge.textContent = 'VERBUNDEN'; badge.style.color = '#00ff99'; }
      if (btn)   { btn.disabled = false; btn.textContent = 'TRENNEN'; btn.style.cssText = 'display:block;background:rgba(255,80,80,0.1);border:1px solid rgba(255,80,80,0.35);color:rgba(255,100,100,0.8);border-radius:7px;padding:8px 18px;font-family:Rajdhani,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:all 0.2s;'; }
      if (loc)   loc.textContent = s.location ? '📍 ' + s.location : '';
    } else {
      mullvadConnected = false;
      dot.style.background = 'rgba(255,80,80,0.4)';
      dot.style.boxShadow  = '0 0 8px rgba(255,80,80,0.3)';
      if (badge) { badge.textContent = 'GETRENNT'; badge.style.color = 'rgba(255,100,100,0.6)'; }
      if (btn)   { btn.disabled = false; btn.textContent = 'VERBINDEN'; btn.style.cssText = 'display:block;background:rgba(0,200,255,0.1);border:1px solid rgba(0,200,255,0.35);color:#00d4ff;border-radius:7px;padding:8px 18px;font-family:Rajdhani,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:all 0.2s;'; }
      if (loc)   loc.textContent = '';
    }
  } catch(e) { console.error('Mullvad status error:', e); }
}

window.mullvadToggle = async function() {
  const btn = document.getElementById('mullvad-btn');
  if (btn) btn.disabled = true;
  try {
    if (mullvadConnected) {
      showToast('VPN wird getrennt...');
      await window.ctrl.mullvadDisconnect();
    } else {
      showToast('VPN wird verbunden...');
      await window.ctrl.mullvadConnect();
    }
    // Kurz warten dann Status neu laden
    setTimeout(refreshMullvad, 1500);
    setTimeout(refreshMullvad, 4000);
  } catch { showToast('Mullvad Fehler'); }
};

// Init + alle 10s aktualisieren
window.addEventListener('DOMContentLoaded', () => {
  refreshMullvad();
  setInterval(refreshMullvad, 10000);
});

// ═══════════════════════════════════════════════════════
// DYNAMIC WEATHER WORLDS
// ═══════════════════════════════════════════════════════
let weatherFxEnabled = true;
let weatherFxActive  = null;
let weatherAnimFrame = null;
let thunderTimeout   = null;

const WEATHER_FX_KEY = 'ctrl-weather-fx';

function initWeatherFx() {
  const stored = localStorage.getItem(WEATHER_FX_KEY);
  weatherFxEnabled = stored !== 'false';
  const toggle = document.getElementById('weather-fx-toggle');
  if (toggle) toggle.checked = weatherFxEnabled;
}

window.toggleWeatherFx = function(enabled) {
  weatherFxEnabled = enabled;
  localStorage.setItem(WEATHER_FX_KEY, enabled ? 'true' : 'false');
  if (!enabled) stopWeatherFx();
  else if (weatherFxActive) applyWeatherFx(weatherFxActive);
};

// Map weather codes to effect types
function getWeatherEffect(code, isNight) {
  if (isNight) return 'night';
  if ([95,96,99].includes(code)) return 'thunder';
  if ([71,73,75,77,85,86].includes(code)) return 'snow';
  if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return 'rain';
  if ([45,48].includes(code)) return 'fog';
  return null;
}

function applyWeatherFx(effect) {
  weatherFxActive = effect;
  if (!weatherFxEnabled) return;

  // Stop previous
  stopWeatherFx(false);

  const canvas  = document.getElementById('weather-canvas');
  const night   = document.getElementById('night-overlay');
  const status  = document.getElementById('weather-fx-status');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const labels = { rain:'🌧 Regen-Effekt aktiv', snow:'❄ Schnee-Effekt aktiv', thunder:'⛈ Gewitter-Effekt aktiv', night:'🌙 Nacht-Modus aktiv', fog:'🌫 Nebel-Effekt aktiv' };
  if (status) status.textContent = labels[effect] || 'Kein Effekt';

  if (effect === 'night') {
    if (night) night.classList.add('active');
    // Intensify glow on accent elements
    document.documentElement.style.setProperty('--night-glow', '1');
    return;
  }

  canvas.classList.add('active');

  if (effect === 'rain') startRain(ctx, canvas);
  else if (effect === 'snow') startSnow(ctx, canvas);
  else if (effect === 'thunder') startThunder(ctx, canvas);
  else if (effect === 'fog') startFog(ctx, canvas);
}

function stopWeatherFx(clearStatus = true) {
  if (weatherAnimFrame) { cancelAnimationFrame(weatherAnimFrame); weatherAnimFrame = null; }
  if (thunderTimeout)   { clearTimeout(thunderTimeout); thunderTimeout = null; }
  const canvas = document.getElementById('weather-canvas');
  const night  = document.getElementById('night-overlay');
  const flash  = document.getElementById('thunder-flash');
  if (canvas) { canvas.classList.remove('active'); const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); }
  if (night)  night.classList.remove('active');
  if (flash)  { flash.style.opacity = '0'; }
  if (clearStatus) {
    const status = document.getElementById('weather-fx-status');
    if (status) status.textContent = 'Kein Effekt aktiv';
    weatherFxActive = null;
  }
}

// ── RAIN ─────────────────────────────────────────────
function startRain(ctx, canvas) {
  const drops = Array.from({length:120}, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    len: 8 + Math.random() * 14,
    speed: 6 + Math.random() * 8,
    opacity: 0.04 + Math.random() * 0.08,
    width: 0.5 + Math.random() * 0.8,
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drops.forEach(d => {
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.2, d.y + d.len);
      ctx.strokeStyle = `rgba(150,220,255,${d.opacity})`;
      ctx.lineWidth = d.width;
      ctx.stroke();
      d.y += d.speed;
      d.x -= d.speed * 0.15;
      if (d.y > canvas.height) { d.y = -20; d.x = Math.random() * (canvas.width + 50); }
      if (d.x < 0) { d.x = canvas.width; }
    });
    weatherAnimFrame = requestAnimationFrame(draw);
  }
  draw();
}

// ── SNOW ─────────────────────────────────────────────
function startSnow(ctx, canvas) {
  const flakes = Array.from({length:80}, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: 1 + Math.random() * 3,
    speed: 0.5 + Math.random() * 1.5,
    drift: (Math.random() - 0.5) * 0.5,
    opacity: 0.1 + Math.random() * 0.25,
    wobble: Math.random() * Math.PI * 2,
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    flakes.forEach(f => {
      f.wobble += 0.015;
      f.x += Math.sin(f.wobble) * 0.4 + f.drift;
      f.y += f.speed;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,240,255,${f.opacity})`;
      ctx.fill();
      if (f.y > canvas.height) { f.y = -5; f.x = Math.random() * canvas.width; }
    });
    weatherAnimFrame = requestAnimationFrame(draw);
  }
  draw();
}

// ── THUNDER ───────────────────────────────────────────
function startThunder(ctx, canvas) {
  // Rain + occasional lightning
  startRain(ctx, canvas);

  const flash = document.getElementById('thunder-flash');
  function doFlash() {
    if (!flash || !weatherFxEnabled) return;
    // Random delay 4-15 seconds
    const delay = 4000 + Math.random() * 11000;
    thunderTimeout = setTimeout(() => {
      // Double flash like real lightning
      flash.style.transition = 'opacity 0.05s';
      flash.style.opacity = '1';
      setTimeout(() => {
        flash.style.opacity = '0';
        setTimeout(() => {
          flash.style.opacity = '0.6';
          setTimeout(() => {
            flash.style.opacity = '0';
            doFlash();
          }, 80);
        }, 60);
      }, 50);
    }, delay);
  }
  doFlash();
}

// ── FOG ───────────────────────────────────────────────
function startFog(ctx, canvas) {
  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    t += 0.003;
    // Drifting fog patches
    for (let i = 0; i < 5; i++) {
      const x = (canvas.width * 0.2 * i + Math.sin(t + i) * 80) % canvas.width;
      const y = canvas.height * 0.3 + Math.cos(t * 0.7 + i) * 60;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, 200 + i * 40);
      grad.addColorStop(0, 'rgba(180,200,220,0.06)');
      grad.addColorStop(1, 'rgba(180,200,220,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    weatherAnimFrame = requestAnimationFrame(draw);
  }
  draw();
}

// ── Hook into fetchWeather ─────────────────────────────
const _origFetchWeather = fetchWeather;
async function fetchWeatherWithFx() {
  await _origFetchWeather();
  // Read current weather code from DOM
  const weatherEl = document.getElementById('weather-content');
  if (!weatherEl) return;
  // Get hour to determine night (21:00 - 06:00)
  const hour = new Date().getHours();
  const isNight = hour >= 21 || hour < 6;
  // Read last fetched code from global
  const effect = getWeatherEffect(window._lastWeatherCode || 0, isNight);
  if (effect) applyWeatherFx(effect);
  else stopWeatherFx();
}

// Override fetchWeather
window.addEventListener('DOMContentLoaded', () => {
  initWeatherFx();
  // Resize canvas on window resize
  window.addEventListener('resize', () => {
    const canvas = document.getElementById('weather-canvas');
    if (canvas) { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  });
});


// ═══════════════════════════════════════════════════════
// AUTO-UPDATER UI
// ═══════════════════════════════════════════════════════
function showUpdSection(id) {
  ['upd-checking','upd-available','upd-downloading','upd-ready','upd-error'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = (s === id) ? 'flex' : 'none';
  });
  document.getElementById('update-popup').style.display = 'block';
}
function closeUpdatePopup() {
  document.getElementById('update-popup').style.display = 'none';
}
window.startUpdate   = () => window.ctrl.updaterDownload();
window.installUpdate = () => window.ctrl.updaterInstall();

// Listen for updater events from main process
window.addEventListener('DOMContentLoaded', () => {
  if (!window.ctrl?.onUpdaterEvent) return;

  window.ctrl.onUpdaterEvent(({ type, data }) => {
    switch(type) {
      case 'update-checking':
        showUpdSection('upd-checking');
        setTimeout(() => {
          if (document.getElementById('update-popup').style.display !== 'none' &&
              document.getElementById('upd-checking').style.display !== 'none') {
            closeUpdatePopup(); // Hide if still checking after 5s
          }
        }, 5000);
        break;

      case 'update-available':
        setEl('upd-version-label', 'v' + data.version + (data.date ? ' · ' + new Date(data.date).toLocaleDateString('de-DE') : ''));
        const changelog = document.getElementById('upd-changelog');
        if (changelog) {
          const notes = data.changelog || 'Keine Änderungsnotizen verfügbar.';
          changelog.innerHTML = typeof notes === 'string'
            ? notes.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong style="color:#e0f4ff;">$1</strong>')
            : JSON.stringify(notes).replace(/\\n/g,'<br>');
        }
        showUpdSection('upd-available');
        break;

      case 'update-not-available':
        closeUpdatePopup();
        break;

      case 'update-progress':
        showUpdSection('upd-downloading');
        setEl('upd-pct', data.percent + '%');
        setEl('upd-dl-info', data.transferred + ' / ' + data.total + ' MB · ' + data.speed + ' MB/s');
        const bar = document.getElementById('upd-progress-bar');
        if (bar) bar.style.width = data.percent + '%';
        break;

      case 'update-downloaded':
        showUpdSection('upd-ready');
        break;

      case 'update-error':
        setEl('upd-error-msg', data.message || 'Update fehlgeschlagen.');
        showUpdSection('upd-error');
        break;
    }
  });

  // Show current version in session tab
  if (window.ctrl.updaterGetVersion) {
    window.ctrl.updaterGetVersion().then(v => {
      const el = document.getElementById('ctrl-version');
      if (el) el.textContent = 'v' + v;
    }).catch(()=>{});
  }
});


// ═══════════════════════════════════════════════════════
// GRID CUSTOMIZATION
// ═══════════════════════════════════════════════════════
const GRID_KEY = 'ctrl-grid-v1';
function loadGridSettings() {
  try { return JSON.parse(localStorage.getItem(GRID_KEY)||'{}'); } catch { return {}; }
}
function applyGridSettings(show, color, opacity) {
  const style = document.getElementById('grid-dynamic-style') || (() => {
    const s = document.createElement('style'); s.id='grid-dynamic-style'; document.head.appendChild(s); return s;
  })();
  if (!show) { style.textContent = 'body::before{display:none!important;}'; return; }
  const hex = color || '#00c8ff';
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  const op = (opacity||4)/100;
  style.textContent = `body::before{background-image:linear-gradient(rgba(${r},${g},${b},${op}) 1px,transparent 1px),linear-gradient(90deg,rgba(${r},${g},${b},${op}) 1px,transparent 1px)!important;}`;
}
window.toggleGrid = function(show) {
  const s = loadGridSettings(); s.show=show; localStorage.setItem(GRID_KEY,JSON.stringify(s));
  applyGridSettings(show, s.color, s.opacity);
};
window.setGridColor = function(color) {
  const s = loadGridSettings(); s.color=color; localStorage.setItem(GRID_KEY,JSON.stringify(s));
  applyGridSettings(s.show!==false, color, s.opacity);
};
window.setGridOpacity = function(el) {
  const v = parseInt(el.value);
  el.style.background = `linear-gradient(90deg,var(--accent) ${v*100/15}%,rgba(255,255,255,0.07) ${v*100/15}%)`;
  document.getElementById('grid-opacity-val').textContent = v+'%';
  const s = loadGridSettings(); s.opacity=v; localStorage.setItem(GRID_KEY,JSON.stringify(s));
  applyGridSettings(s.show!==false, s.color, v);
};
window.addEventListener('DOMContentLoaded', () => {
  const s = loadGridSettings();
  if (Object.keys(s).length) {
    applyGridSettings(s.show!==false, s.color, s.opacity);
    const toggle = document.getElementById('grid-toggle');
    if (toggle) toggle.checked = s.show!==false;
    const colorPicker = document.getElementById('grid-color');
    if (colorPicker && s.color) colorPicker.value = s.color;
    const opSlider = document.getElementById('grid-opacity');
    if (opSlider && s.opacity) { opSlider.value=s.opacity; document.getElementById('grid-opacity-val').textContent=s.opacity+'%'; }
  }
});
