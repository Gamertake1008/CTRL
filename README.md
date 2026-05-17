# CTRL — Gaming & QOL Dashboard

Dein persönliches Windows-Dashboard. Startet automatisch mit Windows.

---

## Installation & Erste Schritte

### Voraussetzungen
- [Node.js](https://nodejs.org/) (LTS Version, 18+)
- Windows 10 / 11

### Setup (einmalig)

```bash
# 1. In den Projektordner wechseln
cd ctrl-client

# 2. Abhängigkeiten installieren
npm install

# 3. App starten (zum Testen)
npm start
```

### Als .exe bauen

```bash
# EXE + Installer erstellen (dauert ~2-3 Min)
npm run build
```

Die fertige `.exe` liegt danach in `dist/`. Der Installer richtet auch den Autostart ein.

---

## Features

| Tab | Funktion |
|-----|----------|
| Dashboard | System-Stats, Schnellstart, Status-Übersicht |
| Audio | Lautstärke pro App, Auto-Mute System Sound beim Start |
| Festplatten | Belegung, freier Speicher, Temperatur |
| Netzwerk | Download/Upload live, Ping zu Game-Servern |
| Shutdown | Timer mit Presets (15min–4h) oder eigener Zeit |
| Session | Uptime-Rekord, CPU/RAM Durchschnitt |

---

## Schnellstart-Apps anpassen

In `src/renderer.js` die Pfade anpassen:

```javascript
const appPaths = {
  terminal: 'cmd.exe',
  firefox:  'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  steam:    'C:\\Program Files (x86)\\Steam\\Steam.exe',
  spotify:  'C:\\Users\\DEIN_NAME\\AppData\\Roaming\\Spotify\\Spotify.exe',
};
```

---

## Autostart deaktivieren

In `src/main.js` Zeile ändern:
```javascript
setAutostart(false); // war: true
```

Oder in Windows: Task-Manager → Autostart → CTRL deaktivieren.

---

## Tray Icon

CTRL läuft im Hintergrund weiter wenn du das Fenster schließt.  
**Rechtsklick auf das Tray-Icon** → "Beenden" zum vollständigen Beenden.

---

## Troubleshooting

**App startet nicht?**  
→ `npm install` nochmal ausführen

**Festplatten-Temp zeigt "--"?**  
→ Normal — Temperatur braucht Admin-Rechte oder smartmontools. Als Admin starten oder ignorieren.

**Shutdown-Timer funktioniert nicht?**  
→ App als Administrator ausführen (Rechtsklick → Als Admin ausführen)
