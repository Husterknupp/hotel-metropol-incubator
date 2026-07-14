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

- **Polling**: Cron-basiert (~60s, via `run.sh`). Kein Daemon, kein HTTP-Inbound.
- **Trigger-Primitive**: `openclaw agent --session-key <key> --message "<text>" --deliver` — synchroner Agent-Turn über das Gateway, unabhängig vom Heartbeat/Active-Hours-Fenster. (`openclaw system event` wurde verworfen — puffert nur bis zum nächsten Heartbeat-Tick, siehe Issue #1.)
- **Sticky `reason`-Erkennung**: `assign`/`review_requested` bleibt als `reason` bestehen, solange die Zuweisung/Review-Anfrage aktiv ist — auch für reine Folgekommentare auf demselben Thread. `isActuallyAComment()` unterscheidet über `subject.latest_comment_url` vs. `subject.url`: identisch → echte Zuweisung; unterschiedlich → tatsächlich ein Kommentar.
- **Locking**: Emoji-Reaktion (`eyes`).
  - Echter Kommentar vorhanden → Reaktion auf dem Kommentar (`/issues/comments/{id}/reactions`)
  - Echte Zuweisung/Review-Anfrage (kein Kommentar vorhanden) → Reaktion auf dem Issue/PR selbst (`/issues/{n}/reactions`)
  - Zweiter paralleler Lauf findet Reaktion → bricht ab. Bei Fehler: Reaktion entfernen → nächster Cron-Lauf verarbeitet erneut.
- **Actor-Auflösung**: GitHub Notifications API liefert kein `actor`-Feld. Wir folgen URLs:
  - `mention`/`comment` → `latest_comment_url` → `.user.login`
  - `author` + `latest_comment_url` gesetzt → `latest_comment_url` → `.user.login`
  - `author` + `PullRequest` + `latest_comment_url=null` → `/pulls/{n}/comments` (letzter Inline-Diff-Kommentar) → `.user.login`
  - `assign`/`review_requested`, tatsächlich ein Kommentar (`isActuallyAComment`) → `latest_comment_url` → `.user.login`
  - `assign`/`review_requested`, echte Zuweisung → `subject.url` (Issue/PR-Ersteller) → `.user.login`
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

Verbleibende Arbeit ist als eigene GitHub-Issues getrackt, nicht mehr inline hier:

- [#4](https://github.com/Husterknupp/hotel-metropol-incubator/issues/4) Live-Validierung `review_requested`-Flow + `reason=comment`-Thread-Antworten
- [#5](https://github.com/Husterknupp/hotel-metropol-incubator/issues/5) (Low priority) Flock-Guard gegen überlappende Cron-Läufe
- [#6](https://github.com/Husterknupp/hotel-metropol-incubator/issues/6) Sichtbares Fehler-Signal auf GitHub bei gescheitertem `openclaw agent`-Aufruf

### ✅ Erledigt

- [x] `subject.actor.login` → Actor muss aus URL nachgeladen werden (`resolveActor`)
- [x] Cron PATH-Fix (`run.sh` Wrapper mit korrektem PATH)
- [x] Trigger-Primitive: `openclaw system event` verworfen (puffert nur bis zum nächsten Heartbeat) → `openclaw agent --session-key ... --deliver` (synchroner Turn, live validiert 2026-07-14)
- [x] Lock-Erwerb in allen `run`-Tests verifiziert
- [x] `DEBUG`-Flag: `markThreadRead` im Debug-Modus übersprungen
- [x] PR Inline Review Comment (`author` + `latest_comment_url=null`) live validiert; Fallback via `/pulls/{n}/comments` + `/pulls/comments/{id}/reactions`
- [x] `reason=assign` ohne Type-Guard (gilt für Issue und PullRequest)
- [x] `author` + `Issue` → `comment` (war vorher `unknown`)
- [x] `buildEventMessage` für `issue`: `subject.type` in Message (`Work on Issue/PullRequest #N`)
- [x] **Sticky `reason=assign`/`review_requested` bei Folgekommentaren** (Fund 2026-07-14, live A/B-Test): `classifyNotification` + `resolveActor` unterscheiden jetzt via `isActuallyAComment()` zwischen echter Zuweisung und Folgekommentar auf einem bereits zugewiesenen Thread.
- [x] **Lock bei `assign`/`review_requested` ohne echten Kommentar** (Fund + Fix 2026-07-14): `acquireLock` hat bei echten Zuweisungen fälschlich die Issue/PR-Nummer als Kommentar-ID behandelt → 404 gegen die reale API, Event ging verloren. Fix: Reaktion auf dem Issue/PR selbst (`/issues/{n}/reactions`) statt auf einem nicht existenten Kommentar. 3 Regressionstests, 40/40 grün.

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
| @-Mention (`mention`) | ✅ validiert | Kommentar mit @-Ping → binnen einer Minute abgeholt, auf GitHub reagiert (siehe party-insights-shenanigans#50) |
| Issue-Zuweisung, echte Erstzuweisung (`assign`) | ✅ validiert | Live A/B-Test 2026-07-14 (unassign + reassign vs. Folgekommentar); Lock-Fix bestätigt über Regressionstests |
| Folgekommentar auf zugewiesenem Issue (sticky `reason=assign`) | ✅ validiert | Live bestätigt 2026-07-14: Kommentar auf Issue #1 wurde korrekt als `comment`, nicht als `issue` klassifiziert |
| Thread-Antwort (`reason=comment`) | ⬜ offen | Noch nicht eindeutig live von obigem Fall unterschieden bestätigt — siehe [#4](https://github.com/Husterknupp/hotel-metropol-incubator/issues/4) |
| PR Review Request (`review_requested`) | ⬜ offen | Noch kein echter Review-Request live getestet — siehe [#4](https://github.com/Husterknupp/hotel-metropol-incubator/issues/4) |

---

## Quellen

- Issue #1 (Ursprungs-Feature-Request): https://github.com/Husterknupp/hotel-metropol-incubator/issues/1
- PR #2 (geschlossen): https://github.com/Husterknupp/hotel-metropol-incubator/pull/2
- PR #3 (aktueller MVP-Stand): https://github.com/Husterknupp/hotel-metropol-incubator/pull/3
- Issue #4 (Live-Validierung `review_requested` + `reason=comment`): https://github.com/Husterknupp/hotel-metropol-incubator/issues/4
- Issue #5 (Flock-Guard, low priority): https://github.com/Husterknupp/hotel-metropol-incubator/issues/5
- Issue #6 (Fehler-Sichtbarkeit auf GitHub): https://github.com/Husterknupp/hotel-metropol-incubator/issues/6
