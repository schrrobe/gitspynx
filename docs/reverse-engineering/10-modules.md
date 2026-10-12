# 10 – Identifizierte Module

Quelle: `dependencies` aus `.work/app/package.json` (140 Einträge, Volltext in `.work/deps.txt`) **[N]**. Zweckangaben sind **[P]** (aus Paketname/öffentlich bekannter Funktion), sofern nicht anders markiert.

## Kern / Laufzeit

| Bereich | Pakete |
|---|---|
| UI-Framework | `react@17.0.2`, `react-dom`, `react-redux@7`, `prop-types`, `react-helmet-async` |
| State | `redux@4`, `redux-saga@1.3`, `reselect@3`, `jotai@2` (+`jotai-immer`, `jotai-effect`), `@redux-saga/is` |
| Listen/Virtualisierung | `@axosoft/react-virtualized` (Fork), `@axosoft/react-virtualized-select`, `react-infinite-scroll-component` |
| Drag & Drop | `react-dnd@3`, `react-dnd-html5-backend`, `@dnd-kit/*`, `react-sortable-hoc` |
| Layout/Overlay | `re-resizable`, `react-overlays`, `react-bootstrap@0.33`, `bootstrap@3`, `basscss`, `react-transition-group`, `react-motion`, `react-onclickoutside` |
| Eigene UI-Bibliotheken | `@axosoft/gk-ui-kit`, `@gitkraken/gitkraken-components`, `@gitkraken/shared-web-components` |
| Icons | `@fortawesome/*` (inkl. **Pro**-Sets, lizenzpflichtig), `font-awesome@4`, `material-design-iconic-font` |
| Editor/Highlighting | Monaco (unter `src/render/static/monaco`, [N]), `prismjs`, `prism-react-renderer`, `filename2prism` |
| Terminal | `@xterm/xterm@6` + Addons, `node-pty`, `default-shell`, `get-cwd-of-process`, `psparser` |
| Toasts | `react-hot-toast` |
| Tastatur | `@axosoft/atom-keymap` (Fork von Atoms Keymap), `keycode-js`, `native-keymap` [N unpacked] |
| Suche | `fuzzaldrin-plus`, `fuzzy`, `minisearch` |

## Git

| Paket | Zweck |
|---|---|
| `@axosoft/nodegit@0.28.0-alpha.38` | libgit2-Bindings (Fork) – [N] genutzt über `nodegit…Saga` |
| `nodegit-flow@2.2.8` | Git-Flow auf nodegit |
| `@axosoft/node-spawn-server` | Prozess-Spawning für das Git-Binary [P] |
| `@axosoft/rust-socket-bridge` | AskPass-Brücke [N] (`getSocketBridgePath`) |
| `find-git-repositories` | Repos auf der Platte finden (native) |
| `nsfw` | FS-Watcher (native) |
| `diff`, `diff3` | Diff-/3-Wege-Merge-Berechnung (Worker `calculateDiff3` [N]) |
| `ignore` | `.gitignore`-Matching |
| `git-url-parse` | Remote-URL-Parsing |
| `@ianhattendorf/ssh-key-decrypt`, `node-forge` | SSH-Key-Handling/-Generierung |
| `chardet`, `iconv-lite`, `file-type` | Encoding-/Binärerkennung für Diffs |

## Integrationen / Cloud (für gitspynx nicht relevant)

`@octokit/rest`, `@gitbeaker/node`, `bitbucket-v2`, `@axosoft/azure-devops-node-api`, `jql-autocomplete`, `@gitkraken/provider-apis`, `@gitkraken/compose-tools`, `@gitkraken/milestones-tools`, `@axosoft/notifications-service-client`, `socket.io-client`, `@u-wave/react-youtube`, `canvas-confetti`, `@sentry/electron`, `@opentelemetry/*`, `getmac`, `systeminformation`.

## Infrastruktur

`fs-extra@5`, `tmp`, `uuid`, `lodash`, `moment`, `semver`, `yargs@18`, `commander`, `jsonc-parser`, `marked@2`, `dompurify`, `cheerio`, `ws`, `net-ipc`, `form-data`, `validator`, `user-settings-dir`.

## Native Binärmodule

Siehe [01-installation.md](01-installation.md#native-module-appasarunpackednode_modules).

## Ableitung für gitspynx (Vorschlag)

Übernehmbar als **eigene** Abhängigkeiten (permissive Lizenzen, unabhängig von GitKraken): Monaco (MIT), xterm.js (MIT), node-pty (MIT), `diff` (BSD), `minisearch` (MIT). Nicht übernehmbar: alle `@axosoft/*`, `@gitkraken/*` (proprietär/UNLICENSED), Font Awesome Pro.
