# gitspynx

Eigenständige Git-Desktop-App (geplant: Electron · TypeScript · Vue 3 · Pinia · Vite).

Aktueller Stand: **M0–M10** – Repository öffnen, Commit-Graph, Arbeitsverzeichnis (Stage/Unstage, Diff, Commit/Amend), Branches (anlegen, wechseln, umbenennen, löschen), Fetch/Pull/Push inkl. Upstream und Force-with-lease, Merge/Rebase/Cherry-Pick mit Konflikt-Editor, Stash, Commit-Suche und Branch-Filter (Ausblenden/Solo), Tabs und Workspaces, Einstellungen (Theme, Zoom, Pull-Modus), anpassbare Tastenkürzel und Command Palette (⌘⇧P), Hunk-/Zeilen-Staging, interaktiver Rebase, Undo/Redo, Worktrees, Submodule, integriertes Terminal und Git LFS.

## Installation

Die Installer liegen bei den [Releases](https://github.com/schrrobe/gitspynx/releases) (bzw. als Artefakte des Workflows „Package"). Voraussetzung ist ein installiertes **git** (macOS: wird bei Bedarf über die Command Line Tools angeboten · Windows: [Git for Windows](https://git-scm.com/download/win) · Linux: über den Paketmanager).

| System | Datei | Prozessoren |
|---|---|---|
| macOS 12+ | `gitspynx-<version>-universal.dmg` (oder `.zip`) | Apple Silicon und Intel |
| Windows 10/11 | `gitspynx-<version>-setup-x64.exe`, `…-setup-arm64.exe` | x64, ARM |
| Linux | `gitspynx-<version>-x86_64.AppImage`, `gitspynx_<version>_amd64.deb` | x64 |

Solange die App nicht mit einem Zertifikat signiert ist (siehe unten), warnt das System beim ersten Start:

- **macOS:** „gitspynx kann nicht geöffnet werden, da der Entwickler nicht verifiziert werden kann". App nach *Programme* ziehen und einmal öffnen, dann *Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen"*. Danach startet sie normal.
- **Windows:** „Der Computer wurde durch Windows geschützt" (SmartScreen). *Weitere Informationen → Trotzdem ausführen*.
- **Linux:** keine Warnung. Das AppImage einmal ausführbar machen (`chmod +x gitspynx-*.AppImage`), das `.deb` mit `sudo apt install ./gitspynx_*.deb` installieren.

## Signieren (für Releases ohne Warnung)

Der Workflow „Package" signiert automatisch, sobald die passenden Repository-Secrets angelegt sind (*Settings → Secrets and variables → Actions*). Ohne sie wird die macOS-App ad-hoc signiert und die Windows-App bleibt unsigniert.

**macOS** – braucht ein Apple-Developer-Konto (99 $/Jahr) und ein Zertifikat „Developer ID Application":

| Secret | Inhalt |
|---|---|
| `MAC_CSC_LINK` | das Zertifikat als `.p12`, base64-kodiert (`base64 -i cert.p12 \| pbcopy`) |
| `MAC_CSC_KEY_PASSWORD` | Passwort der `.p12`-Datei |
| `APPLE_ID` | Apple-ID des Kontos |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-spezifisches Passwort ([appleid.apple.com](https://appleid.apple.com)) |
| `APPLE_TEAM_ID` | Team-ID aus dem Developer-Konto |

Mit allen fünf wird signiert **und notarisiert**: macOS öffnet die App dann ohne jede Rückfrage.

**Windows** – eine der beiden Varianten:

- *Codesigning-Zertifikat* (OV/EV, bei einer CA gekauft): `WIN_CSC_LINK` (`.pfx` base64-kodiert) und `WIN_CSC_KEY_PASSWORD`.
- *Azure Trusted Signing* (Microsoft, monatlich abgerechnet): `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TRUSTED_SIGNING_ENDPOINT` (z. B. `https://weu.codesigning.azure.net/`), `AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_TRUSTED_SIGNING_PROFILE`, `AZURE_TRUSTED_SIGNING_PUBLISHER` (z. B. `CN=Robert, C=DE`).

Signierte Windows-Installer bauen bei SmartScreen mit der Zeit Vertrauen auf; die Warnung verschwindet nicht sofort mit dem ersten Download.

## Dokumentation

Statische Analyse von GitKraken Desktop 12.5.0 als Referenz für Funktionsumfang und Benutzerabläufe:

| Dokument | Inhalt |
|---|---|
| [01-installation](docs/reverse-engineering/01-installation.md) | Versionen (Electron 41.3 / Chromium 146 / Node 24.15), Dateistruktur, native Module |
| [02-architecture](docs/reverse-engineering/02-architecture.md) | Prozessmodell, Schichten, Speicherorte |
| [03-electron-internals](docs/reverse-engineering/03-electron-internals.md) | Fenster, Preload, IPC (43 Kanalgruppen), State-Replikation |
| [04-git-integration](docs/reverse-engineering/04-git-integration.md) | Lock-Modell, nodegit vs. git-Binary, AskPass, Hooks, Watcher |
| [05-ui-components](docs/reverse-engineering/05-ui-components.md) | Layout, Commit-Graph, Themes, Zoom, Shortcuts |
| [06-feature-analysis](docs/reverse-engineering/06-feature-analysis.md) | 12 Kernfunktionen: UI-Einstieg, Sagas, Git-Befehle, Fehler |
| [07-data-flows](docs/reverse-engineering/07-data-flows.md) | Sequenzdiagramme der zentralen Abläufe |
| [08-implementation-plan](docs/reverse-engineering/08-implementation-plan.md) | **Eigener** Architekturentwurf + priorisierte Roadmap |
| [09-open-questions](docs/reverse-engineering/09-open-questions.md) | Grenzen & offene Fragen |
| [10-modules](docs/reverse-engineering/10-modules.md) | Identifizierte Module |
| [11-evidence-index](docs/reverse-engineering/11-evidence-index.md) | Artefakt-Hashes, Fundstellen-Konvention, REA-Evidenz |

Die Analyse nutzt ausschließlich die lokal installierte Kopie, verändert die Installation nicht und übernimmt weder Code noch Marken oder Assets. Die Analysekopie liegt in `.work/` (gitignored) und lässt sich mit `tools/prepare-work.sh` neu erzeugen.

## Entwicklung

```sh
npm install        # node-pty (Terminal) bringt Binärdateien für macOS/Windows mit; Linux braucht build-essential
npm run dev        # App mit Hot Reload
npm test           # Vitest (Parser, Git-Backend gegen echte Temp-Repos, Graph-Layout)
npm run typecheck
npm run build      # nach out/
npm run e2e        # Klicktests gegen die gebaute App
npm run dist       # Installer für das eigene System nach dist/ (macOS: universal)
```

Stand: M0–M10 aus dem [Implementierungsplan](docs/reverse-engineering/08-implementation-plan.md).
