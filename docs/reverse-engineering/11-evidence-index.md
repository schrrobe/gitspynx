# 11 – Evidenzverzeichnis

## Artefakte (Analysekopie)

Erzeugung reproduzierbar mit [`tools/prepare-work.sh`](../../tools/prepare-work.sh) → `.work/` (gitignored, wird nicht versioniert).

| Kürzel in den Docs | Datei (relativ zu `.work/app/`) | SHA-256 |
|---|---|---|
| – | `../app.asar` (Kopie von `/Applications/GitKraken.app/Contents/Resources/app.asar`) | `3fe50012679420aef51e06ca6d76a4b2558f9031e6c4e4ba68809520e6849667` |
| – | `src/main/static/main.bundle.js` | `28f95a36473b80cae512ee2ec173d52828ab6001732c6f4d5523c737fb50559e` |
| `main-all` | `../main-all.js` = `cat src/main/static/*.main.bundle.js src/main/static/main.bundle.js` (Glob-Reihenfolge) | `d6e8aa39a57a120870c1f3198e3ea94bffd3c42862ac1ded38dc4dbfc4b676cc` |
| `R`, `render` | `src/render/static/entryPoints/main/render.bundle.js` | `0e2e6ac4dc1b867087ec033eef4a2db3e6b94d749371f7d1e44582e86bf3bc40` |
| `W` | `src/render/static/entryPoints/worker/worker.bundle.js` | `fb68f197fc8e83242e138f7700de802c225641d0ac509f9092798ef31135f4ba` |
| – | `src/render/static/entryPoints/requestHandler/requestHandler.bundle.js` | `d54488daa5bd088214b3eb23b186e97c1da0415808a09bf4eb1722b4d63ce2a9` |
| `M57` | `src/main/static/57.main.bundle.js` | `d80d7475b2f21f3bd2bbca061bb0b8d1dcf4a246057a9c90e85d8d4693dc1729` |
| – | `src/main/static/605.main.bundle.js` (Upgrade/Migration) | `88524c8b3084d28bd7147b988ba9c5ceca45f62f8f76f22534579aa73aaaab79` |
| – | `src/main/static/795.main.bundle.js` (Request-Handler-View) | `47b90a70f5aefab018cf6c5d80fef3b3a2b4d6f8ec01aa556c9f366a3648a434` |
| – | `src/main/static/919.main.bundle.js` (AppWindow) | `8734da66474bd6aaca7731e7b9f03e6ce039927ddf0a788767ccc81ccce36936` |
| `U` | `../app.asar.unpacked/` | – |

**Fundstellen-Konvention:** `Kürzel@N` = Byte-Offset `N` im jeweiligen (einzeiligen, minifizierten) Bundle. Nachschlagen mit
`node tools/grepctx.js <datei> '<regex>' [kontext] [max]` – die Ausgabe zeigt `@offset` jedes Treffers.

## Abgeleitete Listen (in `.work/`, nicht versioniert)

| Datei | Inhalt | Erzeugung |
|---|---|---|
| `deps.txt` | 140 direkte Dependencies | `jq '.dependencies'` auf `package.json` |
| `render-generators.txt` | 1906 benannte Generatoren (`function*name`) im Renderer | `grepctx.js R 'function\*([A-Za-z0-9_]+)' 0 100000 uniq` |
| `git-ops.txt` | 253 `{locks:[…],saga:function*…}`-Operationen | `grepctx.js R 'locks:\[[^\]]*\],saga:function\*([A-Za-z0-9_]+)' … uniq` |
| `actions.txt` | 708 Redux-Action-Creator | siehe 06 (Methodik) |

## REA-Evidenz

REA-Server `rea-agents` 6.4.0 (MCP), Skill `reverse-engineer-anything`.

| Evidence-ID | Operation | Ergebnis |
|---|---|---|
| (abgebrochen) | `analyze_javascript_application` auf komplettem `app.asar` (285 MB, 590 Pakete) | nach > 30 min ohne Ergebnis abgebrochen; ersetzt durch Teilbaum-Analyse |
| `ev_d0917d44910b47c65a14c32c16895407bead5810db6f61c4a6b8e6937216c31d` | `analyze_javascript_application` auf `.work/rea-subset` (package.json, `src/main/static`, `src/render/static/entryPoints`, `pty-host`; Digest `e86eba4c…a8e`) | 40 JS-Dateien geparst, 5,1 Mio. AST-Knoten, 1019 Findings, 0 Parse-Fehler; Abdeckung **partial** |
| `ev_75b75b3f5782cc27a3c298d1e6e026a95c9ef0845fa756aa4f3da4124e2a8b8a` | `inspect_analysis_view` (Summary) | siehe unten |
| `ev_bee84c7bfeb2896ca9dd4edefdf20888993d653135cadc070765a68b39fb045f` | `trace_application_feature` (Seed API `contextBridge.exposeInMainWorld`, incoming) | `no-match` – der Trace-Index kennt den Seed nicht unter diesem API-Namen; die Datei-Findings selbst (unten) enthalten den Aufruf |

Export: `.work/rea-evidence-bundle.json` (89,5 MB, 3 Records) – mit `export_evidence_bundle` erzeugt, nicht versioniert.

### Was REA bestätigt (Ergebnis `derived`, Autorität `shipped-artifact`)

| Befund | REA-Daten | Bezug |
|---|---|---|
| Einziges `contextBridge`-API im Haupt-Kontext: `HostIPC` mit Membern `name, on, once, sendToHost, version` | Datei-Finding `webviewPreload.js` (sha `5e8e6457…`), Zeilen 6–12 | 03 „Preload/contextBridge“ |
| Zweites `contextBridge`-Finding `sendToHost` (dynamic) | `webviewIntegration.js` (sha `cd684b85…`) | 03 |
| 0 Preload-Entrypoints | Summary `preload_entrypoints: 0` | 03 „kein Preload“ |
| Literale Renderer-Kanäle `log`, `exit-tests`, `exit-system-tests`, `window-command`, `renderProcessMessages.ERROR_ON_STARTUP` | Datei-Findings in `spec/*.js`, `main/index.js` | 03 Roh-Kanäle |
| Ein explizites `BrowserWindow` mit `webSecurity:false` – in `startDevTools.js` (Dev-Only-Pfad) | `web_preferences` des Findings | neu; nur Entwicklungsmodus (`process.env.NODE_ENV === 'development'` in `startMainProcess.js`) |

### Was REA hier nicht leisten konnte (dokumentierte Grenzen)

- Für `main.bundle.js` und `render.bundle.js` wurde die **semantische Analyse nicht gestartet** (Ergebnis-Budget für statische Fakten reserviert); `requestHandler.bundle.js` lief in Heap-Erschöpfung. Das ist eine Ressourcengrenze, kein Defekt der Bundles.
- Electron-API-Identität folgt nur nachweisbaren lexikalischen Aliassen. In Webpack-Bundles (`n.BrowserWindow`, `i.ipcMain` über Modul-IDs) werden daher die Fenster aus `919/795/605.main.bundle.js` und die ~250 `ipcMain.handle`-Registrierungen **nicht** als Electron-Findings erkannt (`main_handlers: 0`). Diese Befunde stammen aus den Regex-Fundstellen in 02/03 und sind dort als [N] mit Offset belegt.
- 21 713 semantische und 24 Anwendungs-Unknowns verbleiben im Parent-Record.

## Persönliche Daten

`~/.gitkraken` wurde nur auf Verzeichnisnamen geprüft; ein Lesen der Konfigurationsschlüssel wurde vom Sicherheitsmechanismus der Umgebung abgelehnt und nicht umgangen.
