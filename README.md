# gitspynx

Eigenständige Git-Desktop-App (geplant: Electron · TypeScript · Vue 3 · Pinia · Vite).

Aktueller Stand: **Analyse- und Planungsphase**. Noch kein App-Code.

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
