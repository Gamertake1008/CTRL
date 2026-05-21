## CTRL 1.2.0 — Spielebibliothek & Performance

### Neu
- **Spiele-Tab komplett überarbeitet** — Steam-Suche mit echten Cover-Bildern, Bibliothek im Kachel-Layout
- **Admin-Launch für Spiele** mit zwei Modi: Direkt (UAC) und Über Steam (DRM-konform)
- **Game-Timer mit globalen Hotkeys** (F3 + Maus-Button 5 standard, frei konfigurierbar)
- **RUNASADMIN AppCompatFlag** wird automatisch gesetzt — Spiele starten ab dann immer als Admin

### Verbessert
- Visibility-aware Background-Polling — CTRL läuft im Tray unter 1% CPU
- Wetter-FX gedrosselt auf 30 FPS, pausiert komplett wenn minimiert
- Defender-Polling 15s → 60s (PowerShell-Calls drastisch reduziert)
- Clipboard-Watcher pausiert wenn versteckt
- PowerShell Mouse-Watcher in C# verlegt (Below-Normal Priority)

### Fixes
- Steam-DRM-Probleme beim Direkt-Start durch neuen Steam-Button gelöst
- Diagnose-Panel im Spiele-Tab für Admin-Launch-Debugging
- Icon im Installer und auf der .exe
