# 07 – Datenflüsse

Legende: **[N]** nachgewiesen · **[P]** plausibel · **[U]** unbekannt. Diagramme fassen Befunde aus 02–06 zusammen; jede Kante verweist auf die Fundstelle im jeweiligen Dokument. Sequenzen sind **statisch rekonstruiert**, nicht zur Laufzeit beobachtet.

## 1. Start der Anwendung

```mermaid
sequenceDiagram
  participant OS
  participant M as Main
  participant SP as Splash-Fenster
  participant W as AppWindow (Renderer)
  participant RH as Request-Handler (WebContentsView)
  OS->>M: startMainProcess.js (clientType, mode)
  M->>M: requestSingleInstanceLock
  M->>SP: BrowserWindow(javascript:false) → splash/index.html
  M->>M: Upgrade-Skripte (LATEST_UPGRADE_SCRIPT)
  M->>W: BrowserWindow(nodeIntegration) → main/index.html?loadSettings
  W->>W: initializeGlobals.js → js/start
  W->>M: REPLICA_READY + MessagePort
  M-->>W: {type:STATE, state}
  M->>RH: WebContentsView → requestHandler/index.html
  RH-->>M: request-handler-initialized
  W->>M: SIGNAL_RENDER_STARTUP
  M->>M: finishStartup (Splash schließen)
```
Belege: 02 (Splash, Upgrade, Fenster), 03 (Replica, Request-Handler), `appIpcMessageChannels.SIGNAL_RENDER_STARTUP` [N], `getRendererReadyPromise…finishStartup` [N] `main-all@567697`. Reihenfolge Request-Handler vs. Renderer-Start: **[P]**.

## 2. Repository öffnen

```mermaid
sequenceDiagram
  participant UI as UI (Fuzzy-Finder / Repo-Tab)
  participant S as Open-Repo-Saga
  participant C as Redux-Cache
  participant NG as nodegit
  participant FS as nsfw-Watcher
  participant ST as Store
  UI->>S: Pfad
  S->>ST: FetchesReset, PushPromiseReset, RepoOpenStarted
  S->>C: hasReduxCache(path)?
  alt Cache & >4 CPUs
    C-->>ST: CachedRepoReduxStoreLoaded (sofort anzeigen)
  end
  S->>NG: Repository.open(path)
  S->>S: AskPass- & Sequence-Editor-Emitter starten
  S->>FS: Watcher Workdir (2 s) / .git (200 ms)
  S->>NG: Revwalk + commitWalk (2000, dann je 200)
  NG-->>ST: InitialCommitWalkUpdated/Finished
  ST-->>UI: Graph rendert (GraphContainer → ColumnsCalculated)
```
Belege: 06 §1, §2; 04 (Watcher-Intervalle, commitWalk). Cache-Bedingung `>4` **[P]** (06 §1).

## 3. Commit erstellen

```mermaid
sequenceDiagram
  participant UI as Commit-Formular
  participant S as doCommitSaga
  participant L as Lock-Manager
  participant H as Hook-Wrapper
  participant G as Backend (git-Binary | nodegit)
  participant W as Watcher
  participant ST as Store
  UI->>S: commit:commit (⌘↩)
  S->>L: locks [CONFIG, INDEX]
  S->>S: gestagte Dateien? sonst CANNOT_COMMIT_WITHOUT_STAGED_FILES
  S->>S: guardGpgSignMessage
  S->>W: pauseWorkDirTrigger
  S->>H: wrapCommitWithHooks(Skip)Saga
  H->>G: git commit (Proxy-Hook via core.hooksPath) | nodeGitCreateCommit + run*Hook
  G-->>S: neuer SHA | GkGitError
  S->>ST: CommitAdded / CommitFinished
  S->>W: Watcher fortsetzen → workDirRefreshSaga
  ST-->>UI: WIP-Knoten aktualisiert, Toast bei Fehler
```
Belege: 06 §4, 04 (Hooks, Lock-Modell).

## 4. Pull mit Credential-Abfrage

```mermaid
sequenceDiagram
  participant UI as Toolbar Pull
  participant S as pullSaga
  participant E as buildAskPassGitOverrides
  participant G as git pull (spawn)
  participant A as AskPass (rust-socket-bridge | AskPassClient.js)
  participant R as Renderer-Socket-Server
  participant M as Main (credsIpcMessageChannels)
  UI->>S: pull
  S->>S: Upstream? sonst promptSetUpstreamForRef; Remotes? sonst promptToAddRemote
  S->>E: env (GIT_ASKPASS, SSH_ASKPASS, Port)
  S->>G: git pull …
  G->>A: Passwort-Prompt
  A->>R: TCP 127.0.0.1 · ask_pass → ready · JSON\0
  R->>M: GET_HTTP_CREDENTIALS / ACQUIRE_OR_WAIT_FOR_CREDENTIALS_LOCK
  M-->>R: Credentials | Dialog nötig
  R-->>A: Antwort
  A-->>G: stdout
  G-->>S: Exitcode / stderr
  S->>S: FORCE_PUSH_ERROR_MESSAGES / GkGitError → Toast
```
Belege: 06 §6, 04 §5 (AskPass), 03 (`creds`-Kanäle). Exakte Zuordnung „Renderer fragt Main nach gespeicherten Credentials“ **[P]**.

## 5. Externe Dateiänderung

```mermaid
flowchart LR
  E[Editor speichert Datei] --> N[nsfw Event]
  N -->|Debounce Workdir 2 s / .git 200 ms| T{Watcher pausiert?}
  T -- ja --> X[verwerfen]
  T -- nein --> WR[workDirRefreshSaga]
  WR --> ST[(WorkDirDiffsUpdated / Refs)]
  ST --> UI[Graph-WIP-Knoten · Datei-Liste]
```
Belege: 04 (Watcher), 06 (Watcher-Pause). Ob `.git`-Events (refs) einen vollständigen Graph-Reload auslösen: **[U]**.

## 6. Main-Store-Replikation (Querschnitt)

```mermaid
flowchart LR
  MA[Main-Saga dispatch] --> MS[(Main-Store)]
  MS --> SH[getSharedState / Diff]
  SH -->|port.postMessage UPDATE,updateIndex| R1[Renderer 1]
  SH --> R2[weitere Renderer]
  R1 -->|ack updateIndex| MS
```
Belege: 03 §3 (`main-all@374349`).
