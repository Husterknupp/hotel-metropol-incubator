# gh-event-listener — Feature Tracking

> Zentrales Dokument für Feature-Beschreibung, Architektur, offene To-Dos und Debug-Prozess.  
> Konsolidiert: Issue #1, PR #2 (geschlossen), PR #3 (aktiv).

---

## Feature-Beschreibung

Das Script pollt die GitHub Notifications API und triggert den OpenClaw-Agenten bei relevanten Events — ähnlich dem GitHub Copilot Flow.

### Use Cases

| # | Trigger | `reason` | `subject.type` | Klassifikation | TRUSTED_ACTOR Check | Agent-Nachricht |
|---|---------|----------|----------------|----------------|---------------------|-----------------|
| 1 | @-Mention in Kommentar | `mention` | egal | `comment` | ✅ via `latest_comment_url` | `React to Husterknupp's GitHub comment (repo XYZ)` |
| 2 | Antwort auf Thread wo Agent schon kommentiert | `comment` | egal | `comment` | ✅ via `latest_comment_url` | `React to Husterknupp's GitHub comment (repo XYZ)` |
| 3 | Issue/PR wird dem Agenten assigned | `assign` | Issue oder PullRequest | `issue` | ✅ via `subject.url` | `Work on Issue/PullRequest #N (repo XYZ)` |
| 4 | Agent wird als PR-Reviewer assigned | `review_requested` | PullRequest | `pr` | ❌ (GitHub enforced — nur Repo-Member) | `Review PR #N (repo XYZ)` |
| 5 | Kommentar auf Issue, das Agent erstellt hat | `author` | `Issue` | `comment` | ✅ via `latest_comment_url` | `React to Husterknupp's GitHub comment (repo XYZ)` |
| 6 | Kommentar auf PR, den Agent erstellt hat | `author` | `PullRequest` | `pr_review_comment` | ✅ via `latest_comment_url` oder PR review comments Fallback | `React to a review comment on your PR #N (repo XYZ). Do not @-mention anyone.` |

Events von unbekannten Akteuren → Warning-Nachricht an konfigurierten Discord-Channel.

---

## Architektur

- **Polling**: Cron-basiert (~60s). Kein Daemon, kein HTTP-Inbound.
- **Locking**: Emoji-Reaktion (`eyes`) auf dem Kommentar. Zweiter paralleler Lauf findet Reaktion → bricht ab. Bei Fehler: Reaktion entfernen → nächster Cron-Lauf verarbeitet erneut.
- **Actor-Auflösung**: GitHub Notifications API liefert kein `actor`-Feld. Wir folgen URLs:
  - `mention`/`comment`/`author` → `latest_comment_url` → `.user.login`
  - `author` + `PullRequest` + `latest_comment_url=null` → `/pulls/{n}/comments` (letzter Inline-Diff-Kommentar) → `.user.login`
  - `assign`/`review_requested` → `subject.url` (Issue/PR) → `.user.login`
- **Adapter-Module**: `gh-adapter.js` (gh CLI), `openclaw-adapter.js`
- **Log-Kategorien**: `no_op` / `comment` / `issue` / `pr` / `pr_review_comment` / `error`

---

## Konfiguration

| Env-Variable | Default | Beschreibung |
|---|---|---|
| `TRUSTED_ACTOR` | `Husterknupp` | GitHub-Username, dessen Events verarbeitet werden |
| `LOCK_REACTION` | `eyes` | Emoji-Reaktion als verteiltes Lock |
| `WARN_CHANNEL` | `null` | Discord-Channel für Third-Party-Warnungen |
| `DEBUG` | `false` | `true`/`1` → debug logs + `markThreadRead` wird übersprungen |

**DEBUG-Modus**: `DEBUG=true node src/index.js`  
Im Debug-Modus werden Notifications *nicht* als gelesen markiert → Event bleibt beim nächsten Lauf sichtbar. Reaktionen (Lock) werden trotzdem gesetzt und müssen ggf. manuell entfernt werden.

---

## Offene To-Dos

### 🔴 Kritisch / Ungeklärt

- [ ] **Lock bei `review_requested`**: Kein `latest_comment_url`, kein Review-Kommentar vorhanden → `acquireLock` gibt `null` zurück → Event wird nicht verarbeitet. Lock-Target für diesen Case fehlt noch.

### 🟡 Ausstehend

- [ ] **Lock bei `assign`**: Analog zu `review_requested` — kein Kommentar-URL verfügbar. Lock-Target definieren (Issue/PR selbst via separatem Endpoint?).

- [ ] **`reason=comment` live validieren**: Tritt erst auf wenn Agent selbst kommentiert hat. Erst nach erstem erfolgreichen `comment`-Flow testbar.

### ✅ Erledigt

- [x] `subject.actor.login` → Actor muss aus URL nachgeladen werden (`resolveActor`)
- [x] Cron PATH-Fix (`run.sh` Wrapper mit korrektem PATH)
- [x] `openclaw system event --mode now` (lowercase)
- [x] Lock-Erwerb in allen `run`-Tests verifiziert
- [x] `DEBUG`-Flag: `markThreadRead` im Debug-Modus übersprungen
- [x] PR Inline Review Comment (`author` + `latest_comment_url=null`) live validiert; Fallback via `/pulls/{n}/comments` + `/pulls/comments/{id}/reactions`
- [x] `reason=comment` → `comment` Klassifikation (Thread-Antworten)
- [x] `reason=assign` ohne Type-Guard (gilt für Issue und PullRequest)
- [x] `author` + `Issue` → `comment` (war vorher `unknown`)
- [x] `buildEventMessage` für `issue`: `subject.type` in Message (`Work on Issue/PullRequest #N`)

---

## Debug-Prozess: Use-Case-Walkthrough

Für jedes Szenario:
1. Benjamin erstellt echtes GitHub-Event
2. Raw API-Response prüfen: `gh api notifications | python3 -c "import json,sys; [print(json.dumps(n, indent=2)) for n in json.load(sys.stdin)]"`
3. Script gegen live-API testen: `node -e "process.env.DEBUG='true'; require('./src/index').run();"`
4. Code anpassen falls nötig
5. Testcases nachziehen (reale API-Shapes als Fixtures)

## Szenario-Status (Validierung gegen echte API)

| Szenario | Status | Befund |
|----------|--------|--------|
| PR Inline Review Comment (`author` + `latest_comment_url=null`) | ✅ validiert | GitHub setzt `latest_comment_url=null`; Fallback via `/pulls/{n}/comments` funktioniert live |
| @-Mention (`mention`) | ⬜ offen | Test geplant |
| Thread-Antwort (`comment`) | ⬜ offen | Test nach erster Agenten-Antwort möglich |
| Issue/PR Assignment (`assign`) | ⬜ offen | — |
| PR Review Request (`review_requested`) | ⬜ offen | — |

---

## Quellen

- Issue #1: https://github.com/Husterknupp/hotel-metropol-incubator/issues/1
- PR #2 (geschlossen): https://github.com/Husterknupp/hotel-metropol-incubator/pull/2
- PR #3 (aktiv): https://github.com/Husterknupp/hotel-metropol-incubator/pull/3
