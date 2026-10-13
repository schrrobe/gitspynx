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

- [ ] **1. Installer und Packaging** – kein electron-builder, keine signierte App
- [ ] **2. Windows und Linux** – nur auf macOS getestet
- [ ] **3. Echte Remotes** – Push/Pull per SSH und HTTPS nur gegen lokale Remotes getestet, nicht gegen GitHub/GitLab
- [ ] **4. Eigene Passwortabfrage (askpass)** – HTTPS ohne Credential-Helper und SSH-Schlüssel mit Passphrase außerhalb des Agents scheitern mit der git-Meldung
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
- Credentials über den Credential-Helper bzw. SSH-Agent von git (`GIT_TERMINAL_PROMPT=0`); siehe offener Punkt 4
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
```

CI (GitHub Actions) führt Tests, Typprüfung und ESLint bei jedem Push aus. Die E2E-Treiber (Playwright `_electron`) für M1–M10 wurden während der Entwicklung lokal ausgeführt und sind noch nicht Teil des Repos.
