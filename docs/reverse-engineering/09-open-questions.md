# 09 – Offene Fragen & Grenzen

## Bewusste Grenzen dieser Analyse

| Grenze | Grund |
|---|---|
| Keine Laufzeitbeobachtung, keine Screenshots | Ein Start von GitKraken würde das Konto und die privaten Repos des Nutzers laden; Screenshots könnten private Inhalte ins Repo bringen. Braucht Freigabe **und** ein Test-Repo ohne private Inhalte (z. B. frisch geklontes öffentliches Repo, separates Profil). |
| `~/.gitkraken` nicht gelesen | Enthält Tokens/Profildaten. Speicherstruktur nur statisch aus dem Code abgeleitet (02). |
| Native Binaries nicht disassembliert | `nodegit.node` (`commitWalk`), `rust-socket-bridge`, `gk` (Go) – für den Plan nicht nötig. |
| Keine Source-Maps | Komponentennamen sind minifiziert; Rekonstruktion über Saga-Namen, CSS-Klassen, i18n-Keys, `.d.ts` von `@gitkraken/gitkraken-components`. |

## Offene Fragen

| # | Frage | Bereich | Wie klären |
|---|---|---|---|
| 1 | Default von `gitBinaryEnabled` (und ob er serverseitig per Feature-Flag gesetzt wird) | Git | Laufzeit oder Settings-Defaults im Main-Bundle weiter verfolgen |
| 2 | Wie Credentials auf Platte gespeichert sind (Format von `secFile`, Rolle von Keychain/`safeStorage`) | Speicher | Lazy-Chunks vollständig durchsuchen (`migrateFileSec`) |
| 3 | Ablauf von Merge/Pull im Binary-Modus (`_gitMergeSaga` nicht zu Ende verfolgt) | Git | gezielte Trace von `_gitMergeSaga` |
| 4 | Lane-/Spaltenalgorithmus in `@gitkraken/gitkraken-components/dist/index.js` | Graph | Für gitspynx **nicht nötig** – eigener Algorithmus (08); nur Verhalten vergleichen |
| 5 | Rolle von `gkcli/gk` (Go 1.25.7) gegenüber dem Git-Backend | CLI | Binary-Strings / `gk --help` in Sandbox |
| 6 | Herkunft der Feature-Flags (`userFeatures`) | Konfig | Laufzeit |
| 7 | Zuordnung UI-Komponente → Saga (nur Stichproben) | UI | Laufzeit-Trace mit `capture_electron_scenario` |
| 8 | Standardbreiten der Panels | UI | Laufzeit / CSS-Default-Werte |
| 9 | Wo kompilierte Theme-Farben als CSS-Variablen gesetzt werden | Themes | Trace von `evaluateThemeObjectToColors` in den Renderer |
| 10 | Mehrdeutige Menü-Accelerators (Tabs, Panels, Fuzzy-Finder) | Shortcuts | Laufzeit |
| 11 | Ob `.git`-Events einen vollständigen Graph-Reload auslösen | Datenfluss | Trace `worktreeRefreshSaga`/`workDirRefreshSaga` |
| 12 | Schema-Namen der `protocol.*`-Registrierungen | Electron | gezielter Grep in `main-all` |
| 13 | Nutzung von Jotai im Haupt-Renderer (kein Treffer im Bundle) | State | Grep nach Atom-Mustern statt Paketname |
| 14 | Ergebnis der REA-Graph-Analyse (`analyze_javascript_application`) – siehe 11-evidence-index.md | Methode | – |

## Nächster sinnvoller Schritt

Für den Bau von gitspynx ist keine der offenen Fragen blockierend. Empfohlen: mit M0/M1 aus [08-implementation-plan.md](08-implementation-plan.md) beginnen und Laufzeit-Vergleiche (Frage 7, 8, 10) nur bei Bedarf und mit Test-Repo nachholen.
