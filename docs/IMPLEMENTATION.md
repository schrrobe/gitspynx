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
  - [ ] Eigenes App-Icon (derzeit das Electron-Icon)
  - [ ] Veröffentlichung als GitHub-Release und Auto-Update (derzeit nur Workflow-Artefakte)
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

- [ ] 6. Interaktiver Rebase: Umsortieren per ↑/↓ statt Drag & Drop, keine „edit"-Aktion
- [ ] 7. Akzeptanz „100k-Commit-Repo scrollt flüssig" nur über Benchmarks (Layout von 150k Commits in 58 ms), nicht an einem echten Repo gemessen

### Kleinere Punkte

- [ ] 8. Commits, die nur über die Basis eines Stashs erreichbar sind, fehlen im Graph
- [ ] 9. Zeilenauswahl im Diff nur per Maus; Shift-Klick in einen anderen Hunk verwirft die Auswahl
- [ ] 10. `rebase.updateRefs=true`: die `update-ref`-Zeilen gehen beim interaktiven Rebase verloren
- [ ] 11. Merge rückgängig (`reset --keep`) nimmt auch unbeteiligte gestagte Änderungen aus dem Index
- [ ] 12. `submodule.<name>.update=none` gibt keine Rückmeldung
- [ ] 13. Keine Drosselung/Bündelung sehr großer Terminal-Ausgaben
- [ ] 14. Später hinzugekommene verschachtelte Submodule lassen sich nicht aus der Oberfläche initialisieren
- [ ] 15. „Git LFS: Muster tracken…" ist auch ohne git-lfs klickbar (klare Fehlermeldung)

### Bewusst in Kauf genommen

- Eingebettete Repos ohne `.gitmodules`-Eintrag erscheinen nicht als Submodule
- Ein nach Konflikten mit „Fortsetzen" beendeter Rebase ist nicht per Klick rückgängig zu machen (Reflog hat ihn)
- Fehler in einem Hintergrund-Tab erscheinen erst beim Wechsel dorthin
- Nach einem Dateisystem-Fehler startet der Watcher erst beim nächsten Neuladen/Tabwechsel neu
- Eine hängende SSH-Übertragung wird erst nach 30 Minuten abgebrochen
- Große Historien: inaktive Tabs laden beim Wechsel neu, Diffs zeigen höchstens 5000 Zeilen, Graph-Layout und Suche laufen im UI-Thread
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
npm run dist        # Installer für das eigene System nach dist/
node tools/smoke.cjs <gepackte App>   # Smoke-Test der gepackten App
```

CI (GitHub Actions) führt Tests, Typprüfung und ESLint bei jedem Push auf Linux, macOS und Windows aus; der Workflow „Package" baut bei jedem PR die Installer aller drei Systeme und startet sie mit dem Smoke-Test. Die E2E-Treiber (Playwright `_electron`) für M1–M10 wurden während der Entwicklung lokal ausgeführt und sind noch nicht Teil des Repos.
