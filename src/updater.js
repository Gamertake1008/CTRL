// ═══════════════════════════════════════════════════════
//  CTRL Auto-Updater — modular, sicher, Discord-style
// ═══════════════════════════════════════════════════════
const { autoUpdater } = require('electron-updater');
const { ipcMain }     = require('electron');
const path            = require('path');
const fs              = require('fs');

let mainWin  = null;
let logLines = [];

// ── Logging ───────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  logLines.push(line);
  console.log(line);
  // Keep last 100 lines
  if (logLines.length > 100) logLines.shift();
}

// ── Configure AutoUpdater ─────────────────────────────
function setupUpdater(win) {
  mainWin = win;

  autoUpdater.logger           = { info: log, warn: log, error: log };
  autoUpdater.autoDownload     = false; // We control the download
  autoUpdater.autoInstallOnAppQuit = true;

  // ── Events ───────────────────────────────────────────
  autoUpdater.on('checking-for-update', () => {
    log('Checking for updates...');
    send('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    log(`Update available: v${info.version}`);
    send('update-available', {
      version:   info.version,
      changelog: info.releaseNotes || 'Keine Änderungsnotizen verfügbar.',
      date:      info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    log('App is up to date.');
    send('update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    send('update-progress', {
      percent:  Math.round(progress.percent),
      speed:    (progress.bytesPerSecond / 1048576).toFixed(1),
      transferred: (progress.transferred / 1048576).toFixed(1),
      total:    (progress.total / 1048576).toFixed(1),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log(`Update downloaded: v${info.version}`);
    send('update-downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    log(`Update error: ${err?.message || err}`);
    let msg = 'Unbekannter Fehler';
    if (err?.message?.includes('net::')) msg = 'Kein Internet oder GitHub nicht erreichbar.';
    else if (err?.message?.includes('404'))  msg = 'Release nicht gefunden.';
    else if (err?.message?.includes('ENOENT')) msg = 'Update-Datei nicht gefunden.';
    else msg = err?.message || 'Update fehlgeschlagen.';
    send('update-error', { message: msg });
  });

  // ── IPC Handlers ─────────────────────────────────────
  ipcMain.handle('updater-check',    () => { autoUpdater.checkForUpdates(); });
  ipcMain.handle('updater-download', () => { autoUpdater.downloadUpdate(); });
  ipcMain.handle('updater-install',  () => { autoUpdater.quitAndInstall(false, true); });
  ipcMain.handle('updater-get-log',  () => logLines.join('\n'));
  ipcMain.handle('updater-get-version', () => require('electron').app.getVersion());
}

function send(channel, data) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('updater-event', { type: channel, data });
  }
}

// ── Check on startup (delayed 10s) ───────────────────
function checkOnStartup() {
  setTimeout(() => {
    try { autoUpdater.checkForUpdates(); } catch(e) { log('Startup check failed: ' + e.message); }
  }, 10000);
}

module.exports = { setupUpdater, checkOnStartup };
