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
| 6 | Kommentar auf PR, den Agent erstellt hat | `author` | `PullRequest` | `pr_review_comment` | ✅ pro Kommentar (siehe Batch-Handling) | `React to N review comment(s) on your PR #N …` (Inline-Batch) bzw. Einzel-Message (reguläre PR-Konversation) |

Events von unbekannten Akteuren → Warning-Nachricht an konfigurierten Discord-Channel.

**Batch-Handling für Inline-Review-Kommentare (Issue #8):** Ein abgeschickter Review bündelt mehrere Inline-Kommentare unter *einer* Notification. Für den Inline-Fall (`author` + `PullRequest` + `latest_comment_url=null`) holt der Listener daher **alle** Inline-Review-Kommentare (`/pulls/{n}/comments`), filtert pro Kommentar und schickt **einen** Event, der alle offenen Kommentare auflistet. Filterregeln pro Kommentar:
- eigener Bot-Account (`SELF_ACTOR`) → überspringen
- Kommentar in einem **resolved** Review-Thread → überspringen (Resolven = „keine Antwort nötig", via GraphQL `reviewThreads.isResolved`)
- bereits mit unserem 👀 gelockt → überspringen (schon bearbeitet)
- vertrauenswürdiger Autor → für den Batch sammeln
- Fremder → **Warnung + Lock** (verhindert, dass derselbe Fremden-Kommentar bei jedem erneuten Auftauchen des Threads neu gewarnt wird)

Die Notification wird erst als gelesen markiert, wenn alle vertrauenswürdigen Kommentare gelockt und der Batch verschickt ist — so geht kein Kommentar mehr verloren. Reguläre PR-Konversationskommentare (mit `latest_comment_url`) behalten den Einzel-Pfad.

**Happy-Path-Kanalregel:** Jede Event-Message (nicht die Warnung) enthält die Anweisung, ausführlich auf GitHub zu antworten und in Discord gar nichts zu posten. Die Stille wird strukturell erzwungen — `sendEvent` wird für Happy-Path-Events mit `{ deliver: false }` aufgerufen, wodurch `--deliver` beim `openclaw agent`-Aufruf entfällt und der Turn auf der Hauptsession läuft, ohne dass die Antwort automatisch nach Discord zugestellt wird. Nur Warnungen (Fremden-Akteure) werden weiterhin mit `--deliver` verschickt und landen in Discord.

---

## Architektur

- **Polling**: Cron-basiert (~60s, via `run.sh`). Kein Daemon, kein HTTP-Inbound.
- **Trigger-Primitive**: `openclaw agent --session-key <key> --message "<text>"` — synchroner Agent-Turn über das Gateway, unabhängig vom Heartbeat/Active-Hours-Fenster. `--deliver` wird über `sendEvent(text, { deliver })` gesteuert: Default `true` (Warnungen), `false` für Happy-Path-Events (stille Zustellung, siehe Kanalregel oben). (`openclaw system event` wurde verworfen — puffert nur bis zum nächsten Heartbeat-Tick, siehe Issue #1.)
- **Isolierte Session für Warnungen (`sendWarning`)**: Warnungen laufen seit dem Fund vom 2026-07-19 nie mehr auf `agent:main:main`, sondern auf einem fixen, separaten Session-Key (`OPENCLAW_WARN_SESSION_KEY`, Default `agent:main:gh-warnings`) — gleicher Agent (`main`), gleiches Modell, gleiche Tools, aber eigenes leeres Transcript ohne laufenden Task-Kontext. Details siehe „Erledigt"-Eintrag unten und `README.md`.
- **Sticky `reason`-Erkennung**: `assign`/`review_requested` bleibt als `reason` bestehen, solange die Zuweisung/Review-Anfrage aktiv ist — auch für reine Folgekommentare auf demselben Thread. `isActuallyAComment()` unterscheidet über `subject.latest_comment_url` vs. `subject.url`: identisch → echte Zuweisung; unterschiedlich → tatsächlich ein Kommentar.
- **Selbst-Erkennung (`SELF_ACTOR`)**: Kommentare/Reaktionen des eigenen Bot-Accounts werden ignoriert — keine Warnung, kein Re-Trigger, aber Thread wird gelesen. Verhindert die Rückkopplungsschleife, in der jede eigene Antwort eine neue „untrusted actor"-Warnung erzeugt (Fund 2026-07-15).
- **Locking**: Emoji-Reaktion (`eyes`).
  - Echter Kommentar vorhanden → Reaktion auf dem Kommentar (`/issues/comments/{id}/reactions`)
  - Echte Zuweisung/Review-Anfrage (kein Kommentar vorhanden) → Reaktion auf dem Issue/PR selbst (`/issues/{n}/reactions`)
  - Inline-Review-Batch → Reaktion auf *jedem* offenen Inline-Kommentar (`/pulls/comments/{id}/reactions`)
  - Zweiter paralleler Lauf findet Reaktion → bricht ab. Bei Fehler: Reaktion(en) entfernen → nächster Cron-Lauf verarbeitet erneut.
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
| `SELF_ACTOR` | `arostovd` | Eigener Bot-Account. Events aus eigenen Kommentaren werden ignoriert (keine Warnung, kein Re-Trigger), damit sich der Listener nicht selbst füttert |
| `LOCK_REACTION` | `eyes` | Emoji-Reaktion als verteiltes Lock |
| `WARN_CHANNEL` | `null` | Discord-Channel für Third-Party-Warnungen |
| `OPENCLAW_WARN_SESSION_KEY` | `agent:main:gh-warnings` | Session-Key für Fremden-Warnungen — getrennt von `OPENCLAW_SESSION_KEY`, damit Warnungen nie den Task-Kontext einer laufenden Session erben (Fund 2026-07-19) |
| `OPENCLAW_SESSION_KEY` | `agent:main:main` | Session-Key für vertrauenswürdige/Happy-Path-Events |
| `DEBUG` | `false` | `true`/`1` → debug logs + `markThreadRead` wird übersprungen |

**DEBUG-Modus**: `DEBUG=true node src/index.js`  
Im Debug-Modus werden Notifications *nicht* als gelesen markiert → Event bleibt beim nächsten Lauf sichtbar. Reaktionen (Lock) werden trotzdem gesetzt und müssen ggf. manuell entfernt werden.

---

## Offene To-Dos

Verbleibende Arbeit ist als eigene GitHub-Issues getrackt, nicht mehr inline hier:

- [#4](https://github.com/Husterknupp/hotel-metropol-incubator/issues/4) Live-Validierung `review_requested`-Flow + `reason=comment`-Thread-Antworten
- [#5](https://github.com/Husterknupp/hotel-metropol-incubator/issues/5) (Low priority) Flock-Guard gegen überlappende Cron-Läufe
- [#6](https://github.com/Husterknupp/hotel-metropol-incubator/issues/6) Sichtbares Fehler-Signal auf GitHub bei gescheitertem `openclaw agent`-Aufruf — **überschneidet sich mit #7**, sollte zusammengeführt werden
- [#7](https://github.com/Husterknupp/hotel-metropol-incubator/issues/7) Async `sendEvent` (feuern-und-vergessen) + Fehler-Signalisierung + „forwarded/pending"-Reaktion
- [#8](https://github.com/Husterknupp/hotel-metropol-incubator/issues/8) ✅ Batch-Verarbeitung aller Inline-Review-Kommentare — in diesem PR umgesetzt

### ✅ Erledigt

- [x] **Isolierte Session für Fremden-Warnungen** (Fund + Fix 2026-07-19): Auf `party-insights-shenanigans#46` warnte der Listener korrekt vor `coderabbitai[bot]` (untrusted) und schickte nie einen „bitte adressieren"-Auftrag — trotzdem committete der Agent 105 Sekunden nach CodeRabbits Review genau die von ihr benannte Korrektur, weil die (inhaltsleere) Warnung auf derselben Session lief, die gerade mitten in der Arbeit an genau diesem PR steckte. Der laufende Task-Kontext hat zum eigenständigen Nachschauen und Handeln verleitet, nicht die Warnnachricht selbst. Fix: `sendWarning()` in `openclaw-adapter.js` pinnt Warnungen fest auf einen separaten Session-Key (`OPENCLAW_WARN_SESSION_KEY`, Default `agent:main:gh-warnings`) statt `agent:main:main` — gleicher Agent/gleiche Tools, aber kein geteilter Task-Kontext mehr. Löst NICHT die fehlende Tool-Beschränkung (dieselbe Session könnte weiterhin committen, wenn sie es wollte) — das bräuchte einen echten separaten Agenten mit eingeschränktem Toolset, zurückgestellt bis/falls es erneut vorkommt. Regressionstests in `openclaw-adapter.test.js` und `index.test.js`.
- [x] **Lock auf untrauten Inline-Review-Kommentaren** (Fund + Fix 2026-07-17, PR #13): Fremde Inline-Kommentare wurden nur gewarnt, nie gelockt. Da der Notification-Thread bei jeder neuen PR-Aktivität wieder als ungelesen auftaucht, wurde derselbe Fremden-Kommentar mehrfach neu gewarnt (7 Warnungen für 3 echte CodeRabbit-Kommentare auf party-insights-shenanigans#56). `handlePrReviewCommentBatch` lockt jetzt auch Fremden-Kommentare — die Kommentar-ID stammt aus der API und ist niemals angreifer-kontrollierter Text, das Lock ist also risikofrei. Regressionstest aktualisiert.
- [x] **Selbst-Trigger-Schleife behoben** (Fund + Fix 2026-07-15): eigener Bot-Account (`arostovd`) wurde als „untrusted actor" gewarnt → Minuten-Schleife. `SELF_ACTOR`-Erkennung überspringt eigene Events still, markiert Thread aber gelesen. Regressionstest.
- [x] **Batch-Verarbeitung Inline-Review-Kommentare** (Issue #8, Fix 2026-07-15): gebündelter Review verlor alle Kommentare außer dem neuesten. `handlePrReviewCommentBatch` holt alle, filtert pro Autor, lockt jeden, schickt einen Event, markiert Thread erst am Ende gelesen. 8 neue Tests.
- [x] **Happy-Path-Stille strukturell statt modellseitig erzwungen** (Fund + Fix 2026-07-18, PR #14): die ursprüngliche Kanalregel (Zusammenfassung mit Link in Discord) sollte durch vollständige Stille für Happy-Path-Events ersetzt werden. Der erste Versuch bat das Modell, den Turn mit `NO_REPLY` zu beenden — funktionierte nicht zuverlässig, da die Direktsession (`agent:main:main`) das Suppression nur bei einer *reinen* Silent-Token-Antwort greifen lässt, nicht wenn das Modell zuvor sichtbaren Text schreibt. Fix: `sendEvent(text, { deliver: false })` lässt `--deliver` beim `openclaw agent`-Aufruf ganz weg, wodurch die Zustellung strukturell entfällt statt von Modell-Compliance abzuhängen. `deliver` defaultet auf `true` (Warnungen bleiben unverändert).
- [x] **Kanalregel in Happy-Path-Messages** (2026-07-15, seit 2026-07-18 durch vollständige Stille ersetzt, siehe Eintrag oben): ausführlich auf GitHub, in Discord nur Zusammenfassung mit Link — spart Tokens.
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
| PR Inline Review Comment — einzeln (`author` + `latest_comment_url=null`) | ✅ validiert | GitHub setzt `latest_comment_url=null`; `/pulls/{n}/comments` funktioniert live |
| PR Inline Review Comment — gebündelter Review (mehrere Kommentare, Issue #8) | 🟡 Unit-getestet | Batch-Handling umgesetzt + 8 Tests; Live-Validierung mit echtem Multi-Kommentar-Review steht noch aus |
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
- Issue #7 (Async `sendEvent` + Fehler-Signal + Ack-Reaktion): https://github.com/Husterknupp/hotel-metropol-incubator/issues/7
- Issue #8 (Batch-Verarbeitung Inline-Review-Kommentare): https://github.com/Husterknupp/hotel-metropol-incubator/issues/8
