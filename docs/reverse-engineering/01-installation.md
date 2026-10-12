# 01 – Installation & Bestandsaufnahme

Analysestand: 2026-10-12 · Ziel: GitKraken Desktop 12.5.0 (lokal installiert)
Legende: **[N]** nachgewiesen · **[P]** plausibel · **[U]** unbekannt

## Methode

- Originalinstallation unverändert gelassen. `app.asar` und `app.asar.unpacked` wurden nach `.work/` kopiert (gitignored) und mit `@electron/asar extract` nach `.work/app` entpackt.
- Werkzeuge: Shell-Inventar (`ls`, `codesign`, `strings`, `jq`), REA `analyze_javascript_application` auf der ASAR-Kopie, ein kleiner Regex-Kontextextraktor (`grepctx.js`, liegt im Scratchpad, nicht im Repo) für minifizierte Bundles.
- Fundstellen werden als `datei@byteoffset` angegeben (Byte-Offset im jeweiligen Bundle).
- Persönliche Profildaten unter `~/.gitkraken` wurden **nicht** gelesen (nur Verzeichnisnamen).

## Umgebung

| Merkmal | Wert | Status |
|---|---|---|
| OS | macOS 26.6.2 (Build 25G83), Darwin 25.6.0 | [N] `sw_vers` |
| App-Pfad | `/Applications/GitKraken.app` | [N] |
| Bundle-ID | `com.axosoft.gitkraken` | [N] `codesign -dv` |
| Version | 12.5.0 | [N] `Info.plist` CFBundleShortVersionString, `package.json` |
| Architektur | arm64 (kein Universal-Binary) | [N] `lipo -archs` |
| Signatur | Developer ID Application: Axosoft, LLC (T7QVVUTZQ8), Hardened Runtime | [N] |
| Entitlements | `cs.allow-jit`, `cs.allow-unsigned-executable-memory` | [N] |
| SHA-256 app.asar | `3fe50012…6849667` | [N] |

## Laufzeit-Versionen

| Komponente | Version | Nachweis |
|---|---|---|
| Electron | 41.3.0 | [N] `Electron Framework.framework/Resources/Info.plist` CFBundleVersion; UA-String `Chrome/146.0.7680.188 Electron/41.3.0` im Framework-Binary |
| Chromium | 146.0.7680.188 | [N] `strings "Electron Framework"` |
| Node.js | 24.15.0 | [N] String `https://nodejs.org/download/release/v24.15.0` im Framework-Binary |
| Gebündeltes Git | 2.54.0 (arm64 Mach-O) | [N] `app/git/bin/git`, `strings` |
| React | 17.0.2 | [N] `node_modules/react/package.json` |
| Redux | 4.0.4 (+ redux-saga) | [N] |
| nodegit (Fork) | `@axosoft/nodegit` 0.28.0-alpha.38 | [N] |

## Dateistruktur

```
GitKraken.app/Contents/
├── MacOS/GitKraken                 Electron-Launcher (arm64)
├── Frameworks/
│   ├── Electron Framework.framework
│   ├── GitKraken Helper{,(GPU),(Plugin),(Renderer)}.app   Chromium-Hilfsprozesse
│   └── Squirrel / Mantle / ReactiveObjC.framework          Auto-Update (Squirrel.Mac)
└── Resources/
    ├── app.asar            285 MB  – eigentliche App
    ├── app.asar.unpacked    79 MB  – native Module, git, gk-CLI
    ├── default_app.asar            – Electron-Standard (ungenutzt)
    ├── bin/gitkraken.sh            – CLI-Wrapper
    └── *.lproj                     – Locale-Ressourcen
```

Entpacktes `app.asar` (`.work/app`):

| Pfad | Größe | Inhalt | Status |
|---|---|---|---|
| `package.json` | – | `main: ./src/main/static/main.bundle.js`, `license: UNLICENSED`, pnpm 10.15 | [N] |
| `src/main/static/main.bundle.js` | 6,7 MB | Main-Process-Bundle (Webpack), + 17 Lazy-Chunks `NNN.main.bundle.js` | [N] |
| `src/render/static/entryPoints/main/render.bundle.js` | 12,1 MB | Haupt-Renderer (UI) | [N] |
| `src/render/static/entryPoints/requestHandler/` | 1,8 MB | Versteckter Renderer für Netzwerk-Requests | [N] |
| `src/render/static/entryPoints/worker/worker.bundle.js` | 128 KB | Web-Worker (Commit-Suche, Fonts, Diff3) | [N] |
| `src/render/static/entryPoints/webview/webviewPreload.js` | 306 B | einziges `contextBridge`-Preload (für Webviews) | [N] |
| `src/render/static/monaco/` | – | Monaco-Editor (Diff/Editor) | [N] |
| `src/sharedModules/cli/pty-host/pty-host.bundle.js` | 93 KB | PTY-Host fürs integrierte Terminal | [N] |
| `src/keyBindings/`, `src/css/`, `src/strings/` | – | Tastenkürzel, Styles, i18n | [N] |
| `src/main/static/{defaultThemes,celestialThemes,themeBases}` | – | Theme-Definitionen | [N] |
| `git/` | 42 MB | gebündeltes Git inkl. `libexec/git-core`, `mergetools` | [N] |
| `gkcli/gk` | 19 MB | GitKraken-CLI (eigenständiges Binary) | [N] |
| `node_modules/` | 370 MB, 590 Einträge | 140 direkte Dependencies (`.work/deps.txt`) | [N] |

Source-Maps: keine `*.map` unter `src/` gefunden **[N]** (Suchgrenze: `find src -name '*.map'`). Funktions- und Saga-Namen sind im Bundle jedoch weitgehend erhalten (z. B. `function*pullSaga`).

## Native Module (`app.asar.unpacked/node_modules`)

| Modul | Binary | Zweck | Status |
|---|---|---|---|
| `@axosoft/nodegit` | `nodegit.node` | libgit2-Bindings | [N] Datei; Zweck [N] über Saga-Namen `nodegit*Saga` |
| `@axosoft/rust-socket-bridge` | `target/release/rust-socket-bridge` | AskPass-Brücke Git → App | [N] `render.bundle.js@6811591` `getSocketBridgePath` neben `AskPassClient.js` |
| `@axosoft/node-spawn-server` | – | Prozess-Spawning | [P] Name; Details in 04 |
| `nsfw` | `nsfw.node` | Dateisystem-Watcher | [N] Datei; Fehlertexte `ErrorMessage-FileWatcherFailedToStart` |
| `node-pty` | `pty.node` | Terminal | [N] |
| `find-git-repositories` | `findGitRepos.node` | Repo-Scan auf Platte | [N] Datei |
| `native-keymap` | `keymapping.node` | Tastaturlayout | [N] |
| `get-cwd-of-process` | `readCwd.node` | CWD eines Terminal-Prozesses | [P] |
| `@msgpackr-extract/*` | `node.napi.glibc.node` | MessagePack | [N] Datei |
| `@vscode/windows-process-tree` | – | nur Windows | [N] |

## Erste Architekturübersicht

Siehe [02-architecture.md](02-architecture.md). Kurzfassung: klassisches Electron mit **Node-Integration im Renderer** (kein Preload/contextBridge für das Hauptfenster), Redux-Store im Main-Process, der seinen „Shared State“ per MessagePort an Renderer repliziert; Git läuft im Renderer über nodegit **und** das gebündelte Git-Binary, koordiniert über Redux-Saga-Operationen mit Locks.
