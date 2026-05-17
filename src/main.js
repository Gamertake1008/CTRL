const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const { setupUpdater, checkOnStartup } = require('./updater');
const path = require('path');
const os = require('os');
const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');

// Track all child processes so we can kill them on exit
const childProcs = new Set();
const _exec = exec;
function trackedExec(cmd, opts, cb) {
  const child = _exec(cmd, opts, cb);
  childProcs.add(child);
  child.on('close', () => childProcs.delete(child));
  return child;
}
// Override exec globally
global._trackedExec = trackedExec;

// ── Admin re-launch ───────────────────────────────────
if (!process.argv.includes('--no-elevate')) {
  try {
    const isAdmin = (() => { try { execSync('net session',{stdio:'ignore'}); return true; } catch { return false; } })();
    if (!isAdmin) {
      execSync(`powershell -Command "Start-Process -FilePath '${process.execPath.replace(/'/g,"\\'")}' -ArgumentList '--no-elevate' -Verb RunAs -WindowStyle Hidden"`,{stdio:'ignore'});
      app.exit(0);
    }
  } catch {}
}

// ── Config ────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'ctrl-config.json');
function loadConfig() { try { if(fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')); } catch {} return {autoMuteSystem:false}; }
function saveConfig(cfg) { try { fs.writeFileSync(CONFIG_PATH,JSON.stringify(cfg,null,2)); } catch {} }

// ── App detection ─────────────────────────────────────
const APPDATA  = process.env.APPDATA  || '';
const LOCALAPP = process.env.LOCALAPPDATA || '';
const APP_CANDIDATES = {
  terminal: ['C:\\Windows\\System32\\cmd.exe'],
  firefox:  ['C:\\Program Files\\Mozilla Firefox\\firefox.exe','C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'],
  spotify:  [path.join(APPDATA,'Spotify','Spotify.exe'),path.join(LOCALAPP,'Microsoft','WindowsApps','Spotify.exe')],
  steam:    ['C:\\Program Files (x86)\\Steam\\Steam.exe','C:\\Program Files\\Steam\\Steam.exe','D:\\Steam\\Steam.exe','E:\\Steam\\Steam.exe'],
};
function detectApps() {
  const r = {};
  for(const [k,c] of Object.entries(APP_CANDIDATES)) r[k]=c.find(p=>{try{return fs.existsSync(p);}catch{return false;}})||null;
  if(!r.firefox){try{const o=execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe" /ve 2>nul',{encoding:'utf8',stdio:['pipe','pipe','ignore']});const m=o.match(/REG_SZ\s+(.+\.exe)/i);if(m)r.firefox=m[1].trim();}catch{}}
  return r;
}

// ── Launch app ────────────────────────────────────────
function launchApp(exePath) {
  exec(`start "" "${exePath}"`,{shell:true},(err)=>{
    if(err) try{spawn(exePath,[],{detached:true,stdio:'ignore'}).unref();}catch{}
  });
}

// ── Get all running processes with audio ──────────────
// Cache für Audio-Prozesse — verhindert zu viele PowerShell-Instanzen
let audioProcsCache = [];
let audioLastCheck = 0;
const AUDIO_CACHE_MS = 30000; // nur alle 30 Sek neu abfragen

function getRunningAudioProcesses() {
  // Cache nutzen wenn frisch genug
  if (Date.now() - audioLastCheck < AUDIO_CACHE_MS && audioProcsCache.length > 0) {
    return Promise.resolve(audioProcsCache);
  }
  return new Promise(resolve => {
    // Kurzes schnelles Kommando — kein ConvertTo-Json overhead
    const child = exec(
      'powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "Get-Process | Select-Object -ExpandProperty ProcessName | Sort-Object -Unique | Out-String"',
      {windowsHide:true, timeout:4000},
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve([{name:'system',title:''}]);
          return;
        }
        const procs = stdout.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        const result = [{name:'system',title:''}, ...procs.map(p=>({name:p,title:''}))];
        audioProcsCache = result;
        audioLastCheck = Date.now();
        resolve(result);
      }
    );
    // Force kill after timeout
    setTimeout(() => { try { child.kill(); } catch {} }, 4500);
  });
}

// ── Network speed ─────────────────────────────────────
let netLastRx=0, netLastTx=0, netLastTime=0;
async function getNetworkSpeed() {
  return new Promise(resolve=>{
    const si=require('systeminformation');
    si.networkStats().then(stats=>{
      const now=Date.now();
      let rx=0,tx=0;
      stats.forEach(s=>{rx+=s.rx_bytes||0;tx+=s.tx_bytes||0;});
      let dl=0,ul=0;
      if(netLastTime>0&&now>netLastTime){const dt=(now-netLastTime)/1000;dl=Math.max(0,(rx-netLastRx)/dt/1048576);ul=Math.max(0,(tx-netLastTx)/dt/1048576);}
      netLastRx=rx;netLastTx=tx;netLastTime=now;
      resolve({dl:dl.toFixed(2),ul:ul.toFixed(2)});
    }).catch(()=>resolve({dl:'0.00',ul:'0.00'}));
  });
}

// ── Audio via nircmd (zuverlässig) ───────────────────
const NIRCMD = path.join(__dirname, '..', 'tools', 'nircmd.exe');
const TOOLS_DIR = path.join(__dirname, '..', 'tools');

// nircmd beim ersten Start herunterladen
function ensureNircmd() {
  if (fs.existsSync(NIRCMD)) return Promise.resolve(true);
  return new Promise(resolve => {
    const dir = TOOLS_DIR.split('\\').join('/');
    const cmd = `powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://www.nirsoft.net/utils/nircmd.zip' -OutFile '${dir}/nircmd.zip' -UseBasicParsing; Expand-Archive -Path '${dir}/nircmd.zip' -DestinationPath '${dir}' -Force; Remove-Item '${dir}/nircmd.zip' -Force"`;
    exec(cmd, {windowsHide:true, timeout:30000}, (err) => {
      resolve(!err && fs.existsSync(NIRCMD));
    });
  });
}

function nircmd(...args) {
  if (!fs.existsSync(NIRCMD)) {
    // Fallback: SendKeys mute toggle
    exec(`powershell -NoProfile -Command "$wsh=New-Object -ComObject WScript.Shell;$wsh.SendKeys([char]173)"`, {windowsHide:true}, ()=>{});
    return;
  }
  exec(`"${NIRCMD}" ${args.join(' ')}`, {windowsHide:true}, ()=>{});
}

function setSystemMute(mute) {
  nircmd('mutesysvolume', mute ? '1' : '0');
}

function setAppVolume(processName, volumePct) {
  if (!processName) return;
  const vol = (Math.max(0, Math.min(100, volumePct)) / 100).toFixed(2);
  const script = [
    '$name = \'' + processName + '\'',
    '$vol = [float]' + vol,
    'Add-Type -TypeDefinition @\'',
    'using System;using System.Runtime.InteropServices;',
    '[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]class MME{}',
    '[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMDE{int a();[PreserveSig]int GDE(int f,int r,out IMD d);}',
    '[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMD{[PreserveSig]int Act(ref Guid g,int c,IntPtr p,out object o);}',
    '[Guid("BFA971F1-4D5E-40BB-935E-967039BFBEE4"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IASM{int a();int b();[PreserveSig]int GSE(out IASE e);}',
    '[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IASE{[PreserveSig]int GC(out int c);[PreserveSig]int GS(int i,out IASC s);}',
    '[Guid("BCD7C78F-3098-4F22-B547-A2F25A381269"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IASC{int a();int b();int c();int d();int e();int f();int g();int h();[PreserveSig]int GPI(out uint p);}',
    '[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface ISAV{[PreserveSig]int SMV(float v,ref Guid g);int b();int c();int d();}',
    'public class AV{public static void Set(string proc,float vol){try{',
    '  var e=(IMDE)new MME();IMD d;e.GDE(0,1,out d);',
    '  var g1=typeof(IASM).GUID;object o;d.Act(ref g1,23,IntPtr.Zero,out o);',
    '  var m=(IASM)o;IASE se;m.GSE(out se);int cnt;se.GC(out cnt);',
    '  for(int i=0;i<cnt;i++){IASC sc;se.GS(i,out sc);uint pid;sc.GPI(out pid);',
    '    try{var pr=System.Diagnostics.Process.GetProcessById((int)pid);',
    '      if(pr.ProcessName.ToLower()==proc.ToLower()){var sv=(ISAV)sc;var g=Guid.Empty;sv.SMV(vol,ref g);}',
    '    }catch{}',
    '  }',
    '}catch{}}}\' -EA SilentlyContinue',
    '[AV]::Set(' + '\'' + processName + '\'' + ', ' + vol + ')',
  ].join(' ');
  exec('powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "' + script.replace(/"/g, '\\"') + '"',
    {windowsHide:true, timeout:10000}, ()=>{});
}
function muteApp(processName, mute) {
  if (!processName) return;
  const muteVal = mute ? 'true' : 'false';
  const script = [
    '$name = \'' + processName + '\'',
    '$mute = [System.Convert]::ToBoolean(\'' + muteVal + '\')',
    'Add-Type -TypeDefinition @\'',
    'using System;using System.Runtime.InteropServices;',
    '[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]class MME{}',
    '[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMDE{int a();[PreserveSig]int GDE(int f,int r,out IMD d);}',
    '[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMD{[PreserveSig]int Act(ref Guid g,int c,IntPtr p,out object o);}',
    '[Guid("BFA971F1-4D5E-40BB-935E-967039BFBEE4"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IASM{int a();int b();[PreserveSig]int GSE(out IASE e);}',
    '[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IASE{[PreserveSig]int GC(out int c);[PreserveSig]int GS(int i,out IASC s);}',
    '[Guid("BCD7C78F-3098-4F22-B547-A2F25A381269"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IASC{int a();int b();int c();int d();int e();int f();int g();int h();[PreserveSig]int GPI(out uint p);}',
    '[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface ISAV{[PreserveSig]int SMV(float v,ref Guid g);int b();[PreserveSig]int SM([MarshalAs(UnmanagedType.Bool)]bool m,ref Guid g);int d();}',
    'public class AM{public static void Mute(string proc,bool mute){try{',
    '  var e=(IMDE)new MME();IMD d;e.GDE(0,1,out d);',
    '  var g1=typeof(IASM).GUID;object o;d.Act(ref g1,23,IntPtr.Zero,out o);',
    '  var m=(IASM)o;IASE se;m.GSE(out se);int cnt;se.GC(out cnt);',
    '  for(int i=0;i<cnt;i++){IASC sc;se.GS(i,out sc);uint pid;sc.GPI(out pid);',
    '    try{var pr=System.Diagnostics.Process.GetProcessById((int)pid);',
    '      if(pr.ProcessName.ToLower()==proc.ToLower()){var sv=(ISAV)sc;var g=Guid.Empty;sv.SM(mute,ref g);}',
    '    }catch{}',
    '  }',
    '}catch{}}}\' -EA SilentlyContinue',
    '[AM]::Mute(' + '\'' + processName + '\'' + ', $mute)',
  ].join(' ');
  exec('powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "' + script.replace(/"/g, '\\"') + '"',
    {windowsHide:true, timeout:10000}, ()=>{});
}
// ── Window ────────────────────────────────────────────
let mainWindow, tray;
function createWindow() {
  mainWindow = new BrowserWindow({
    width:1150, height:700, minWidth:900, minHeight:550,
    frame:false, backgroundColor:'#0a0c10',
    webPreferences:{nodeIntegration:false,contextIsolation:true,preload:path.join(__dirname,'preload.js')},
  });
  // Start with login
  mainWindow.loadFile(path.join(__dirname,'login.html'));
  setupUpdater(mainWindow);
  checkOnStartup();
  try {
    tray=new Tray(nativeImage.createEmpty());
    tray.setToolTip('CTRL');
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'CTRL öffnen',click:()=>mainWindow.show()},
      {type:'separator'},
      {label:'Beenden',click:()=>{app.isQuitting=true;app.quit();}},
    ]));
    tray.on('double-click',()=>mainWindow.isVisible()?mainWindow.hide():mainWindow.show());
  } catch {}
  mainWindow.on('close', () => {
    // Kill all tracked child processes
    childProcs.forEach(p => { try { p.kill('SIGKILL'); } catch {} });
    app.exit(0); // Force exit — no lingering processes
  });
}

// ── Single Instance Lock ─────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit(); // Zweite Instanz sofort beenden
} else {
  app.on('second-instance', () => {
    // Wenn jemand CTRL nochmal startet — fokus auf bestehendes Fenster
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(()=>{
  const cfg = loadConfig();
  if (!cfg.eulaAccepted) {
    // Show EULA first
    mainWindow = new BrowserWindow({
      width:580, height:680, minWidth:580, minHeight:600,
      frame:false, backgroundColor:'#0a0c10',
      resizable:false,
      webPreferences:{nodeIntegration:false,contextIsolation:true,preload:path.join(__dirname,'preload.js')},
    });
    mainWindow.loadFile(path.join(__dirname,'eula.html'));
    try {
      tray=new Tray(nativeImage.createEmpty());
      tray.setToolTip('CTRL');
      tray.setContextMenu(Menu.buildFromTemplate([
        {label:'Beenden',click:()=>{app.isQuitting=true;app.exit(0);}},
      ]));
    } catch {}
    mainWindow.on('close', () => { childProcs.forEach(p=>{try{p.kill('SIGKILL');}catch{}}); app.exit(0); });
    return; // Don't continue normal startup
  }
  _startApp();
});

function _startApp() {
  // Download nircmd if not present
  ensureNircmd().then(ok => {
    if(ok) console.log('nircmd ready');
    else console.warn('nircmd not available — audio control limited');
  });
  createWindow();
  app.setLoginItemSettings({openAtLogin:true,name:'CTRL',path:process.execPath});
  const cfg=loadConfig();
  if(cfg.autoMuteSystem) setTimeout(()=>setSystemMute(true),3000);
}
app.on('window-all-closed', () => { childProcs.forEach(p => { try { p.kill('SIGKILL'); } catch {} }); app.exit(0); });

// ── IPC ───────────────────────────────────────────────
// ── EULA ─────────────────────────────────────────────
ipcMain.handle('accept-eula', () => {
  const cfg = loadConfig();
  cfg.eulaAccepted = true;
  saveConfig(cfg);
  // Resize window to normal dashboard size and load login
  mainWindow.setResizable(true);
  mainWindow.setSize(1150, 700);
  mainWindow.setMinimumSize(900, 550);
  mainWindow.center();
  mainWindow.loadFile(path.join(__dirname,'login.html'));
  return true;
});

ipcMain.handle('updater-get-version', () => app.getVersion());
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-close', () => {
  childProcs.forEach(p => { try { p.kill('SIGKILL'); } catch {} });
  app.exit(0);
});
ipcMain.handle('load-loading',()=>{ mainWindow.loadFile(path.join(__dirname,'loading.html')); return true; });
ipcMain.handle('open-admin', () => {
  const adminWin = new BrowserWindow({
    width:900, height:650, minWidth:800, minHeight:550,
    frame:false, backgroundColor:'#0a0c10',
    webPreferences:{nodeIntegration:false,contextIsolation:true,preload:path.join(__dirname,'preload.js')},
  });
  adminWin.loadFile(path.join(__dirname,'admin.html'));
  return true;
});
ipcMain.handle('load-dashboard',()=>{ mainWindow.loadFile(path.join(__dirname,'index.html')); return true; });
ipcMain.handle('logout',()=>{ mainWindow.loadFile(path.join(__dirname,'login.html')); return true; });
ipcMain.handle('get-config',()=>loadConfig());
ipcMain.handle('save-config',(_, c)=>{saveConfig(c);return true;});
ipcMain.handle('detect-apps',()=>detectApps());
ipcMain.handle('get-running-audio',()=>getRunningAudioProcesses());
ipcMain.handle('launch-app',(_,p)=>{launchApp(p);return true;});
ipcMain.handle('set-system-mute',(_,m)=>{setSystemMute(m);return true;});
ipcMain.handle('set-app-volume', (_, proc, vol) => { setAppVolume(proc, parseInt(vol)); return true; });
ipcMain.handle('mute-app', (_, proc, mute) => { muteApp(proc, mute); return true; });
ipcMain.handle('set-autostart',(_,e)=>{app.setLoginItemSettings({openAtLogin:e,name:'CTRL',path:process.execPath});return true;});
ipcMain.handle('start-shutdown-timer',(_,secs)=>{exec(`shutdown /s /t ${secs} /f`,{shell:true},()=>{});return true;});
ipcMain.handle('cancel-shutdown-timer',()=>{exec('shutdown /a',{shell:true},()=>{});return true;});

ipcMain.handle('get-sysinfo', async () => {
  try {
    const si = require('systeminformation');
    const [load, mem, gfx, disks, net, gpuPS] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.graphics(),
      si.fsSize(),
      si.networkStats(),
      getGpuDataPS(),
    ]);
    const netS = net[0] || {};

    // Select dedicated GPU: prefer one with most VRAM, exclude integrated
    const gpus = gfx.controllers.filter(g => g && g.model);
    const dedicated = gpus.find(g =>
      g.model.match(/RX |RTX |GTX |Arc |Pro |XT|Radeon RX/i) &&
      !g.model.match(/\(TM\) Graphics$/i)
    ) || gpus.sort((a,b) => (b.vram||0)-(a.vram||0))[0] || {};

    // Use PS data if SI returns 0
    const gpuUtil = gpuPS.util > 0 ? gpuPS.util : Math.round(dedicated.utilizationGpu || 0);
    const gpuTemp = gpuPS.temp > 0 ? gpuPS.temp : Math.round(dedicated.temperatureGpu || 0);

    return {
      cpu:  Math.round(load.currentLoad),
      ram:  Math.round((mem.active / mem.total) * 100),
      gpu:  gpuUtil,
      gpuTemp,
      disks: disks.filter(d=>d.size>0&&d.mount).map(d=>({
        fs:d.fs, mount:d.mount,
        size:(d.size/1073741824).toFixed(0),
        used:(d.used/1073741824).toFixed(0),
        use: Math.round(d.use||0),
      })),
      network: {
        dl: ((netS.rx_sec||0)/1048576).toFixed(2),
        ul: ((netS.tx_sec||0)/1048576).toFixed(2),
      },
    };
  } catch(e) {
    return {cpu:0,ram:0,gpu:0,gpuTemp:0,disks:[],network:{dl:'0.00',ul:'0.00'}};
  }
});
ipcMain.handle('get-disk-temp',async()=>{try{const si=require('systeminformation');const l=await si.diskLayout();return l.map(d=>({name:d.name,temp:d.temperature||null}));}catch{return[];}});
ipcMain.handle('get-uptime',()=>Math.floor(os.uptime()));

// ── File dialog for background image ─────────────────
ipcMain.handle('pick-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Hintergrundbild auswählen',
    filters: [{ name: 'Bilder', extensions: ['jpg','jpeg','png','webp','gif'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  // Convert to base64 so it works inside asar
  const data = fs.readFileSync(result.filePaths[0]);
  const ext = path.extname(result.filePaths[0]).slice(1).replace('jpg','jpeg');
  return `data:image/${ext};base64,${data.toString('base64')}`;
});

// ── File dialog for game picker ─────────────────────────
const { dialog } = require('electron');
ipcMain.handle('pick-exe', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Spiel auswählen',
    filters: [{ name: 'Ausführbare Dateien', extensions: ['exe'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ── GPU driver version check ──────────────────────────
ipcMain.handle('check-gpu-driver', async () => {
  return new Promise(resolve => {
    const gpuChild = exec(`powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_VideoController | Select-Object -First 1 Name,DriverVersion,DriverDate | ConvertTo-Json"`,
      {windowsHide:true, timeout:6000},
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve({name:'Unbekannt', version:'--', outdated: false, error: true});
        try { gpuChild.kill(); } catch {}
        try {
          const data = JSON.parse(stdout);
          const name = data.Name || 'Unbekannt';
          const version = data.DriverVersion || '--';
          // DriverDate format: 20230101000000.000000+000
          const dateStr = data.DriverDate || '';
          const year = parseInt(dateStr.substring(0, 4)) || 0;
          const month = parseInt(dateStr.substring(4, 6)) || 0;
          const driverDate = new Date(year, month - 1);
          const monthsOld = (new Date() - driverDate) / (1000 * 60 * 60 * 24 * 30);
          const outdated = monthsOld > 6; // older than 6 months = outdated
          resolve({ name, version, outdated, monthsOld: Math.round(monthsOld), driverDate: driverDate.toLocaleDateString('de-DE') });
        } catch { resolve({name:'Unbekannt', version:'--', outdated: false, error: true}); }
      }
    );
  });
});

// ── Windows Defender toggle ───────────────────────────
ipcMain.handle('get-defender-status', () => {
  return new Promise(resolve => {
    exec('powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "try { (Get-MpComputerStatus).RealTimeProtectionEnabled } catch { $false }"',
      {windowsHide:true, timeout:8000},
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null);
        const enabled = stdout.trim().toLowerCase() === 'true';
        resolve(enabled);
      }
    );
  });
});

ipcMain.handle('set-defender', (_, enable) => {
  return new Promise(resolve => {
    const val = enable ? '0' : '1'; // 0 = enable RTP, 1 = disable RTP
    exec(`powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "Set-MpPreference -DisableRealtimeMonitoring $${val}"`,
      {windowsHide:true, timeout:10000},
      (err) => resolve(!err)
    );
  });
});

// ── Spotify media control via keyboard simulation ─────
ipcMain.handle('spotify-control', (_, action) => {
  return new Promise(resolve => {
    const keys = {
      play:  '0xB3', // VK_MEDIA_PLAY_PAUSE
      next:  '0xB0', // VK_MEDIA_NEXT_TRACK
      prev:  '0xB1', // VK_MEDIA_PREV_TRACK
    };
    const key = keys[action];
    if (!key) return resolve(false);
    exec(`powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class KB{[DllImport(\"user32.dll\")]public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,int dwExtraInfo);}'; [KB]::keybd_event(${key},0,0,0); Start-Sleep -Milliseconds 50; [KB]::keybd_event(${key},0,2,0)"`,
      {windowsHide:true, timeout:5000},
      (err) => resolve(!err)
    );
  });
});

// ── Spotify current track via Windows Media Session ───
ipcMain.handle('get-spotify-track', () => {
  return new Promise(resolve => {
    exec(`powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "
$p = Get-Process Spotify -EA SilentlyContinue | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -First 1
if ($p) { Write-Output $p.MainWindowTitle } else { Write-Output '' }
"`,    {windowsHide:true, timeout:4000},
      (err, stdout) => {
        const title = stdout.trim();
        if (!title || title === 'Spotify Premium' || title === 'Spotify') return resolve(null);
        // Format: "Artist - Song"
        const parts = title.split(' - ');
        if (parts.length >= 2) {
          resolve({ artist: parts[0].trim(), song: parts.slice(1).join(' - ').trim() });
        } else {
          resolve({ artist: '', song: title });
        }
      }
    );
  });
});

// ── RAM freigeben ─────────────────────────────────────
ipcMain.handle('free-ram', () => {
  return new Promise(resolve => {
    exec('powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue; [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers(); $mem = (Get-CimInstance Win32_OperatingSystem); $free = [math]::Round($mem.FreePhysicalMemory/1MB,1); Write-Output $free"',
      {windowsHide:true, timeout:15000},
      (err, stdout) => resolve({ ok:!err, freeMB: parseFloat(stdout.trim()) || 0 })
    );
  });
});

// ── Temp & Papierkorb aufräumen ───────────────────────
ipcMain.handle('cleanup-temp', () => {
  return new Promise(resolve => {
    const script = [
      '$tempPath = $env:TEMP',
      '$before = (Get-ChildItem $tempPath -Recurse -EA SilentlyContinue | Measure-Object -Property Length -Sum).Sum',
      'Get-ChildItem $tempPath -Recurse -EA SilentlyContinue | Remove-Item -Recurse -Force -EA SilentlyContinue',
      'Clear-RecycleBin -Force -EA SilentlyContinue',
      'Write-Output ([math]::Round($before/1MB,1))',
    ].join('; ');
    exec('powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "' + script + '"',
      {windowsHide:true, timeout:30000},
      (err, stdout) => resolve({ ok:!err, freedMB: parseFloat(stdout.trim()) || 0 })
    );
  });
});

// ── Autostart Manager ─────────────────────────────────
ipcMain.handle('get-autostart', () => {
  return new Promise(resolve => {
    const tmpFile = path.join(os.tmpdir(), 'ctrl_autostart.ps1');
    const lines = [];
    lines.push('$out = @()');
    lines.push('$keys = @("HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run","HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run")');
    lines.push('foreach ($key in $keys) {');
    lines.push('  $hive = if ($key -like "HKCU*") { "HKCU" } else { "HKLM" }');
    lines.push('  try {');
    lines.push('    $props = Get-ItemProperty -Path $key -ErrorAction Stop');
    lines.push('    $props.PSObject.Properties | Where-Object { $_.Name -notmatch "^PS" } | ForEach-Object {');
    lines.push('      $out += $_.Name + "|||" + $_.Value + "|||" + $hive');
    lines.push('    }');
    lines.push('  } catch {}');
    lines.push('}');
    lines.push('Write-Output ($out -join "|~~|")');

    try { fs.writeFileSync(tmpFile, lines.join('\n'), 'utf8'); } catch(e) { return resolve([]); }

    exec('powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + tmpFile + '"',
      { windowsHide: true, timeout: 10000, encoding: 'utf8' },
      (err, stdout) => {
        try { fs.unlinkSync(tmpFile); } catch {}
        if (!stdout || !stdout.trim()) return resolve([]);
        try {
          const entries = stdout.trim().split('|~~|')
            .map(line => {
              const p = line.trim().split('|||');
              return p.length >= 3 ? { name: p[0].trim(), path: p[1].trim(), hive: p[2].trim() } : null;
            })
            .filter(e => e && e.name && e.path);
          resolve(entries);
        } catch { resolve([]); }
      }
    );
  });
});

ipcMain.handle('toggle-autostart-entry', (_, name, enable, hive) => {
  return new Promise(resolve => {
    const key = (hive === 'HKCU')
      ? 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
      : 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
    const fromName = enable ? '_disabled_' + name : name;
    const toName   = enable ? name : '_disabled_' + name;
    const cmd = 'powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "Rename-ItemProperty -Path \"' + key + '\" -Name \"' + fromName + '\" -NewName \"' + toName + '\" -EA SilentlyContinue"';
    exec(cmd, {windowsHide:true, timeout:5000}, (err) => resolve(true));
  });
});

// ── Temp Monitoring für Alerts ────────────────────────
ipcMain.handle('get-temps', async () => {
  try {
    const si = require('systeminformation');
    const [cpu, gpu] = await Promise.all([si.cpuTemperature(), si.graphics()]);
    return {
      cpu: cpu.main || 0,
      gpu: gpu.controllers[0]?.temperatureGpu || 0,
    };
  } catch { return {cpu:0, gpu:0}; }
});

// ── Preview what cleanup will delete ─────────────────
ipcMain.handle('get-cleanup-preview', () => {
  return new Promise(resolve => {
    const sep = 'CTRLSEP';
    const parts = [
      '$t=$env:TEMP',
      '$i=@(Get-ChildItem $t -EA SilentlyContinue)',
      '$s=($i|Measure-Object -Property Length -Sum -EA SilentlyContinue).Sum',
      '$mb=[math]::Round([double]$s/1MB,1)',
      'Write-Output ($i.Count.ToString()+"' + sep + '"+$mb.ToString()+"' + sep + '"+$t)',
    ].join('; ');
    exec('powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "' + parts + '"',
      {windowsHide:true, timeout:8000},
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve({tempCount:0, tempMB:0, tempPath:'%TEMP%', recycleCount:0});
        const p = stdout.trim().split(sep);
        resolve({
          tempCount: parseInt(p[0]) || 0,
          tempMB:    parseFloat(p[1]) || 0,
          tempPath:  p[2]?.trim() || '%TEMP%',
          recycleCount: 0,
        });
      }
    );
  });
});

// ── Mullvad VPN ───────────────────────────────────────
function findMullvad() {
  const paths = [
    'C:\\Program Files\\Mullvad VPN\\resources\\mullvad.exe',
    'C:\\Program Files (x86)\\Mullvad VPN\\resources\\mullvad.exe',
    `${process.env.LOCALAPPDATA}\\Programs\\Mullvad VPN\\resources\\mullvad.exe`,
  ];
  return paths.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || 'mullvad';
}

ipcMain.handle('mullvad-status', () => {
  return new Promise(resolve => {
    const bin = findMullvad();
    exec(`"${bin}" status`, { windowsHide: true, timeout: 6000 }, (err, stdout, stderr) => {
      if (err && !stdout) return resolve({ installed: false });
      const out = (stdout || '').trim();
      const lower = out.toLowerCase();
      // Must explicitly say "connected" — anything else = disconnected
      const connected  = lower.startsWith('connected');
      const connecting = lower.includes('connecting') || lower.includes('blocked');
      const locMatch   = out.match(/connected to .+ in (.+)/i);
      const location   = locMatch ? locMatch[1].trim() : null;
      resolve({ installed: true, connected, connecting, location, raw: out });
    });
  });
});


ipcMain.handle('mullvad-connect', () => {
  return new Promise(resolve => {
    const bin = findMullvad();
    exec(`"${bin}" connect`, { windowsHide: true, timeout: 8000 }, (err) => resolve(!err));
  });
});

ipcMain.handle('mullvad-disconnect', () => {
  return new Promise(resolve => {
    const bin = findMullvad();
    exec(`"${bin}" disconnect`, { windowsHide: true, timeout: 8000 }, (err) => resolve(!err));
  });
});

// ── KI System Analyst — anonymer Snapshot ────────────
ipcMain.handle('get-system-snapshot', async () => {
  try {
    const si = require('systeminformation');
    const [load, mem, gfx, disks, net, cpuTemp, cpuInfo, gpuPS] = await Promise.all([
      si.currentLoad(), si.mem(), si.graphics(), si.fsSize(),
      si.networkStats(), si.cpuTemperature(), si.cpu(), getGpuDataPS(),
    ]);
    const netS = net[0] || {};
    const gpuUtil = gpuPS.util > 0 ? gpuPS.util : Math.round((gfx.controllers[0]||{}).utilizationGpu||0);
    const gpuTemp = gpuPS.temp > 0 ? gpuPS.temp : Math.round((gfx.controllers[0]||{}).temperatureGpu||0);
    // Find dedicated GPU name
    const gpus = gfx.controllers.filter(g=>g&&g.model);
    const dedGpu = gpus.find(g=>g.model.match(/RX |RTX |GTX |Arc |XT/i)&&!g.model.match(/\(TM\) Graphics$/i)) || gpus[0] || {};
    return {
      cpu_name:   cpuInfo.manufacturer + ' ' + cpuInfo.brand,
      cpu_pct:    Math.round(load.currentLoad),
      cpu_cores:  cpuInfo.cores,
      ram_pct:    Math.round((mem.active/mem.total)*100),
      ram_free_gb:((mem.total-mem.active)/1073741824).toFixed(1),
      ram_total_gb:(mem.total/1073741824).toFixed(1),
      gpu_name:   dedGpu.model || 'Unbekannt',
      gpu_pct:    gpuUtil,
      gpu_temp:   gpuTemp > 0 ? gpuTemp : null,
      cpu_temp:   Math.round(cpuTemp.main||0),
      disk_usage: disks.filter(d=>d.size>0).map(d=>({
        drive:d.mount, use_pct:Math.round(d.use||0),
        free_gb:((d.size-d.used)/1073741824).toFixed(0)
      })),
      net_dl_mbs: ((netS.rx_sec||0)/1048576).toFixed(2),
      net_ul_mbs: ((netS.tx_sec||0)/1048576).toFixed(2),
    };
  } catch { return null; }
});

// ── GPU data via Performance Counters ───────────────
function getGpuDataPS() {
  return new Promise(resolve => {
    // Write script to temp file to avoid quoting hell
    const fs2 = require('fs');
    const os2 = require('os');
    const tmp = os2.tmpdir() + '\\ctrl_gpu.ps1';
    const script = [
      'try {',
      '  $c = Get-Counter "\\GPU Engine(*engtype_3D)\\Utilization Percentage" -EA Stop',
      '  $util = [math]::Round(($c.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum, 0)',
      '  if($util -gt 100){$util=100}',
      '} catch { $util = 0 }',
      '$temp = 0',
      'Write-Output "$util|||$temp"',
    ].join('\n');
    try { fs2.writeFileSync(tmp, script, 'utf8'); } catch { return resolve({util:0,temp:0}); }
    exec('powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + tmp + '"',
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        try { fs2.unlinkSync(tmp); } catch {}
        if (err || !stdout.trim()) return resolve({util:0,temp:0});
        const p = stdout.trim().split('|||');
        resolve({ util: Math.min(100,parseInt(p[0])||0), temp: parseInt(p[1])||0 });
      }
    );
  });
}
