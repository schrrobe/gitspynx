# Implementierungsstand

Plan: [`reverse-engineering/08-implementation-plan.md`](reverse-engineering/08-implementation-plan.md). Diese Datei hält fest, was umgesetzt ist, was offen ist und welche Entscheidungen dabei getroffen wurden. Offene Punkte werden hier abgehakt, sobald sie erledigt sind.

## Stand

Alle Meilensteine **M0–M10** der Roadmap sind umgesetzt (Branch `feat/m0-m1-scaffold-graph`, PR #1). Alle aufgeschobenen Review-Punkte sind abgearbeitet oder unten als Entscheidung bzw. offener Punkt festgehalten.

| Meilenstein | Umfang |
|---|---|
| M0/M1 | Gerüst, typisierte Preload-API, Repo öffnen, Recent, paginierter Graph (SVG je virtualisierter Zeile), Commit-Detail |
| M2 | Status, Stage/Unstage, Diff-View, Commit/Amend |
| M3 | Branches anlegen/wechseln/umbenennen/löschen, Sidebar, native Kontextmenüs |
| M4 | Fetch/Pull/Push, Upstream, ahead/behind |
| M5 | Merge, Rebase, Cherry-Pick, Konflikt-Editor, Continue/Skip/Abort |
| M6 | Stash (Sidebar) |
| M7 | Commit-Suche, Branch-Filter (Hide/Solo) |
| M8 | Tabs, Workspaces, Session |
| M9 | Einstellungen, Themes, Tastenkürzel, Befehlspalette |
| M10 | Interaktiver Rebase, Hunk-/Zeilen-Staging, Undo/Redo, Worktrees, Submodule, Git LFS, Terminal |

## Offene Punkte

### Für ein Release

- [x] **1. Installer und Packaging** – electron-builder (`npm run dist`): dmg/zip (macOS), NSIS (Windows), AppImage/deb (Linux). Der Workflow „Package" baut alle drei und startet die gepackte App mit einem Smoke-Test (`tools/smoke.cjs`: Repo öffnen, Graph, Terminal).
  - [ ] Signierung und Notarisierung – braucht ein Apple-Developer-ID-Zertifikat und ein Windows-Codesigning-Zertifikat (`CSC_LINK`, `APPLE_ID` …); bis dahin unsigniert (macOS: Rechtsklick → Öffnen)
  - [x] Eigenes App-Icon (`build/icon.svg`, als 1024-px-PNG gerendert; electron-builder erzeugt .icns/.ico)
  - [x] Veröffentlichung: ein gepushter Tag `v*` lädt die Installer aller Systeme in einen GitHub-Release-**Entwurf**, der von Hand freigegeben wird
  - [ ] Auto-Update – sinnvoll erst mit Signierung (macOS lässt unsignierte Updates nicht zu) und veröffentlichten Releases
- [x] **2. Windows und Linux** – Unit- und Integrationstests laufen in der CI auf Linux, macOS und Windows; die gepackte App startet auf allen drei (Smoke-Test). Dabei gefunden und behoben: git meldet Windows-Pfade als `C:/…` mit Langnamen, Node als `C:\…` teils mit 8.3-Kurznamen (Worktrees); der macOS-`spawn-helper` von node-pty kommt ohne Ausführungsrecht (Terminal kaputt in sauberen Builds).
  - [ ] Die ausführlichen E2E-Treiber je Meilenstein liefen nur auf macOS
- [x] **3. Echte Remotes** – gegen github.com über HTTPS aus der App geprüft: Push mit Upstream, Fetch mit ahead/behind, Pull eines fremden Commits, Remote-Branch löschen.
  - [ ] SSH gegen GitHub – auf dem Entwicklungsrechner ist kein SSH-Schlüssel bei GitHub hinterlegt
  - [ ] GitLab – kein Zugang vorhanden
- [x] **4. Eigene Passwortabfrage (askpass)** – `GIT_ASKPASS`/`SSH_ASKPASS` zeigen auf ein Skript, das einen kleinen Client mit der App-Laufzeit startet; Frage und Antwort laufen über einen lokalen, per Zufallstoken gesicherten Socket (Windows: Named Pipe). Passwörter und Passphrasen werden verdeckt abgefragt. Geprüft: `git credential` auf allen drei Systemen, E2E in der App gegen einen lokalen HTTP-Server mit Basic-Auth.
  - [ ] SSH-Passphrase und Host-Key-Abfrage nicht E2E geprüft (gleicher Weg über `SSH_ASKPASS`)
  - [ ] In der gepackten Windows-App nicht E2E geprüft
- [x] **5. ESLint** – `npm run lint` (JS/typescript-eslint recommended, Vue essential, keine Formatregeln), läuft in der CI

### Abweichungen vom Plan

- [x] 6. Interaktiver Rebase: Umsortieren per Drag & Drop (↑/↓ für die Tastatur bleiben), Aktion „Bearbeiten" hält nach dem Commit an (Amend, dann „Fortsetzen")
- [x] 7. Großes echtes Repo gemessen: git/git mit 85.545 Commits (bis zu 317 Linien pro Zeile, Graph 158 Spuren breit). Erste Anzeige 1,4 s, „Alle laden" 2,8 s, Scrollen ohne lange Tasks (längster Frame 9,3 ms), Sprung an beliebige Stelle ≤ 20 ms, Suche über alles 26 ms, JS-Heap 99 MB. Dafür optimiert: gerade Spuren kompakt gespeichert und je Farbe als ein Pfad gezeichnet, Layout nur für neu geladene Seiten (vorher 1071 MB Renderer-Speicher, „Alle laden" 6–7 s, Sprünge bis 91 ms).
  - [x] Sehr breite Graphen (git/git: ~2200 px) verdrängten Betreff, Autor und Datum: die Graph-Spalte ist automatisch auf 240 px begrenzt und mit einem Griff verstellbar (Ziehen, ←/→, Doppelklick = automatisch; gespeichert). Ein Knoten in einer abgeschnittenen Spur erscheint als Ring am Rand

### Kleinere Punkte

- [x] 8. Die Basis eines Stashs bleibt im Graph, auch wenn kein Branch sie mehr erreicht
- [x] 9. Zeilenauswahl über mehrere Hunks (Shift-Klick) und per Tastatur (↑/↓, Shift, Leertaste, Enter); gestagt wird Hunk für Hunk von unten. Dabei behoben: ein externer Commit/Reset/Checkout ließ den offenen Diff veraltet stehen, und eine ältere Diff-Antwort konnte eine neuere überschreiben
- [x] 10. `rebase.updateRefs=true`: der interaktive Rebase setzt die `update-ref`-Zeilen selbst (nicht für den aktuellen Branch und nicht für Branches in anderen Worktrees)
- [x] 11. Merge rückgängig stellt unbeteiligte gestagte Änderungen nach `reset --keep` wieder her
- [x] 12. Von git übersprungene Submodule (`update = none`) werden in einem Hinweis genannt
- [x] 13. Terminal-Ausgabe wird gebündelt (wenige ms, höchstens 64K Zeichen je Nachricht); kommt das Fenster nicht hinterher (> 512K unbestätigte Zeichen), wird die Shell pausiert, bis es aufgeholt hat. Gemessen: 2 Mio. Zeilen in 1,3 s ohne Ruckler
- [x] 14. Submodule in initialisierten Submodulen werden (eingerückt) gelistet und lassen sich gezielt initialisieren; git läuft dafür im übergeordneten Submodul
- [x] 15. „Git LFS: Muster tracken…" ist nur aktiv, wenn git-lfs installiert ist
- [x] 16. Eingebettete Repos ohne `.gitmodules`-Eintrag erscheinen als „nicht in .gitmodules" (öffnen ja, aktualisieren nein); der Index wird dafür nur nach einer Änderung neu gelesen
- [x] 17. Ein nach Konflikten mit „Fortsetzen" beendeter Rebase ist per Klick rückgängig zu machen (zurück auf den Stand vor dem Rebase)
- [x] 18. Fehler einer Hintergrund-Operation gehen nicht mehr verloren: roter Punkt am Tab (Meldung im Tooltip), die Meldung erscheint beim Zurückwechseln
- [x] 19. Der Watcher startet nach einem Dateisystem-Fehler selbst neu (bis zu fünfmal)
- [x] 20. Fetch, Pull, Push und Submodul-Updates laufen mit `--progress`; zwei Minuten ohne Ausgabe gelten als hängende Verbindung (auch bei SSH), Zeit in einem Passwort-Dialog zählt nicht. Große Übertragungen werden nicht mehr nach 2 bzw. 10 Minuten abgebrochen
- [x] 21. Große Historien (git/git, 85.545 Commits): Neuladen behält alles Geladene (vorher auf 50.000 gekürzt) und baut eine unveränderte Historie nicht neu auf (längstes Frame 250 → 42 ms); die letzten drei Repos bleiben im Speicher, der Tabwechsel zurück zeigt sie in 57 ms mit Scrollposition (vorher ~450 ms und nur die ersten 2.000 Commits); der Diff ist virtualisiert (100.000 Zeilen in 0,5 s, vorher Abbruch nach 5.000). Layout und Suche bleiben im UI-Thread, gemessen unkritisch

### Weitere offene Punkte

- [x] 22. SSH-Passphrase über die eigene Abfrage: Test mit `ssh-add` und eigenem `ssh-agent` (gleicher `SSH_ASKPASS`-Weg wie ssh beim Git-Transfer; ein echter Push über SSH bleibt mangels Server ungetestet; auf Windows übersprungen)
- [x] 23. Passwortabfrage in der gepackten App: der Smoke-Test holt auf Linux, macOS und Windows von einem lokalen, passwortgeschützten HTTP-Remote
- [x] 24. `git revert` aus dem Kontextmenü eines Commits (auch für den neuesten), mit Undo; Konflikte über die Operationsleiste
- [x] 25. Hunk oder markierte Zeilen im Arbeitsverzeichnis verwerfen (mit Rückfrage; Index unberührt)
- [x] 26. Inhaltssuche: Suchleiste schaltet auf „Code (Änderungen)" um (`git log -S`, `re:` für `-G`); bis 5 min, eine neue Suche bricht die alte ab; Partial Clones werden abgelehnt. git/git (82k Commits): 17 s Text, 36 s Regex. Dabei „Alle laden" ohne commit-graph von 35 s auf 2,6 s beschleunigt (große Seiten)
- [x] 27. Terminal: Höhe per Griff (gespeichert), mehrere Shells je Repo (Leiste mit +, ×)
- [x] 28. Worktrees sperren, entsperren und verschieben (Ziel im Speichern-Dialog von main)
- [x] 29. Submodule hinzufügen (URL/Pfad geprüft), entfernen (nicht bei lokalen Änderungen) und URLs synchronisieren
- [x] 30. E2E: neun Szenarien in `e2e/` (Playwright), Workflow „E2E" auf Linux, macOS und Windows
- [ ] 31. AltGr unter Windows – nur an einem echten Windows-Rechner prüfbar. Prüfung: deutsches Layout, in Einstellungen → Tastenkürzel ein Feld anklicken und AltGr+Q drücken: es muss „@" erscheinen (nicht „Ctrl+Alt+@"); danach Strg+Alt+K (linke Tasten) drücken: es muss „Ctrl+Alt+K" erscheinen

### Bewusst in Kauf genommen

- AltGr: falls Chromium auf AltGr-Layouts auch echtes Ctrl+Alt als AltGr meldet, würden Kürzel wie Ctrl+Alt+X dort als X gelesen (nicht geprüft)
- Kein `git revert` aus der Oberfläche, keine Inhaltssuche (`git log -S/-G`), kein „Hunk verwerfen", keine Worktree-Sperre/-Verschiebung, Submodule ohne add/remove/sync, Terminal mit fester Höhe und einer Shell je Repo

## Entscheidungen

Kurzfassung; jede Entscheidung mit Begründung und Kosten im Ledger (`.superpowers/sdd/08-implementation-plan/progress.md`, lokal).

**Technik**
- vite 7 statt 8 (Peer-Range von electron-vite 5), TypeScript 5.9 statt 7 (vue-tsc), Main/Preload als CJS (sandboxed Preload)
- System-git aus dem PATH statt gebündeltem Binary; der PATH der Login-Shell wird beim Start übernommen (Dock-Start)
- Graph als SVG pro virtualisierter Zeile statt eines Canvas; Lane-Layout im Renderer, erste-Eltern-Kette links
- Eigener Diff-Renderer statt Monaco; Konflikt-Editor mit ours/theirs read-only und editierbarem Ergebnis
- `fs.watch` rekursiv im Main-Prozess statt nativer Watcher-Module
- Einstellungen über eigenen toleranten Parser statt zod; Keymap als Feld in `settings.json`
- Terminal: node-pty (Prebuilds) + xterm.js; jede Shell gehört dem Fenster, das sie gestartet hat

**Sicherheit**
- Renderer sandboxed, `contextIsolation`, keine Node-Integration; alle IPC-Argumente werden im Main-Prozess validiert
- Repos nur nach Auswahl im Dialog, aus der Session oder als von git gemeldete Worktrees/Submodule eines geöffneten Repos
- Revisionen, die als Option gelesen werden könnten, werden abgelehnt; Konfliktdateien nur für ungemergte Pfade und nie durch Symlinks
- Hunk-Staging: der Renderer nennt nur Indizes, der Patch wird im Main-Prozess aus dem aktuellen Diff gebaut
- Interaktiver Rebase: Plan im Main-Prozess validiert, Todo-Datei von main geschrieben
- Force-Push nur mit `--force-with-lease --force-if-includes`

**Oberfläche (an GitKraken angelehnt)**
- Dunkles Blau-Grau als Standard (hell weiterhin wählbar), kräftige Spurfarben; keine Logos oder Markenelemente von GitKraken
- Tabs in der Titelleiste (macOS: neben den Ampel-Knöpfen), Toolbar mit Repo-/Branch-Auswahl, beschrifteten Icons (Undo, Redo, Pull ▾, Push, Branch, Stash, Pop, Terminal), Actions und Search; Fetch liegt wie bei GitKraken im ▾-Menü von Pull
- Linke Leiste mit Filter, einklappbaren Abschnitten und Branch-Bäumen nach Ordnern; Graph mit Spalten BRANCH/TAG · GRAPH · COMMIT MESSAGE (Autor, Datum, SHA zuschaltbar), eingefärbten Zeilen und relativen Zeiten; Suchleiste nur bei Bedarf
- Avatare als Initialen in Farbkreisen statt Gravatar-Bildern: Gravatar würde den Hash jeder Autoren-E-Mail an einen externen Dienst schicken

**Verhalten**
- Credentials zuerst über Credential-Helper und SSH-Agent; fehlt dort etwas, fragt die App selbst (askpass). Gespeichert wird nichts, Speichern bleibt Sache des Credential-Helpers
- Netzwerkoperationen ohne Fortschrittsanzeige, nur Busy-Zustand; Timeouts mit SIGTERM → SIGKILL
- Stashes in der Sidebar statt als Graph-Zeilen; Stash-Button nimmt untracked Dateien mit
- Undo/Redo ist eine App-Historie der in gitspynx ausgeführten Aktionen, jeder Schritt wird vor dem Ausführen gegen den Zustand geprüft
- Nur das aktive Tab ist geladen; ein Watcher für das aktive Repo
- Cmd/Ctrl+W schließt ein Tab (ohne Tabs das Fenster); im Terminal erreichen nur Tab-Wechsel, Palette und Terminal-Umschalter (auf macOS alle Cmd-Kürzel) die App

## Testen

```bash
npm ci
npm test            # Vitest: Unit + Integration gegen temporäre git-Repos
npm run typecheck   # vue-tsc strict
npm run lint        # ESLint
npm run build       # electron-vite
npm run e2e         # E2E-Szenarien gegen die gebaute App (npm run build vorher)
npm run dist        # Installer für das eigene System nach dist/
node tools/smoke.cjs <gepackte App>   # Smoke-Test der gepackten App
```

CI (GitHub Actions) führt Tests, Typprüfung und ESLint bei jedem Push auf Linux, macOS und Windows aus; der Workflow „Package" baut bei jedem PR die Installer aller drei Systeme und startet sie mit dem Smoke-Test. Der Workflow „E2E" führt die Szenarien in `e2e/scenarios` (Playwright `_electron`) bei jedem PR auf allen drei Systemen aus.
