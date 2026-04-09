# gh-event-listener — Feature Tracking

> Zentrales Dokument für Feature-Beschreibung, Architektur, offene To-Dos und Debug-Prozess.  
> Konsolidiert: Issue #1, PR #2 (geschlossen), PR #3 (aktiv).

---

## Feature-Beschreibung

Das Script pollt die GitHub Notifications API und triggert den OpenClaw-Agenten bei relevanten Events — ähnlich dem GitHub Copilot Flow.

### Use Cases

| # | Trigger | `reason` in API | Klassifikation | Agent-Nachricht |
|---|---------|-----------------|----------------|-----------------|
| 1 | @-Mention in Kommentar | `mention` | `comment` | `React to Husterknupp's GitHub comment (repo XYZ)` |
| 2 | Issue wird dem Agenten assigned | `assign` + `type=Issue` | `issue` | `Work on issue #N (repo XYZ)` |
| 3 | Agent wird als PR-Reviewer assigned | `review_requested` + `type=PullRequest` | `pr` | `Review PR #N (repo XYZ)` |
| 4 | Kommentar auf eigenem PR (als Autor) | `author` + `type=PullRequest` + `latest_comment_url` | `pr_review_comment` | `React to a review comment on your PR #N (repo XYZ). Do not @-mention anyone.` |

Events von unbekannten Akteuren → Warning-Nachricht an konfigurierten Discord-Channel.

---

## Architektur

- **Polling**: Cron-basiert (~60s). Kein Daemon, kein HTTP-Inbound.
- **Locking**: Emoji-Reaktion (`eyes`) auf dem Kommentar. Zweiter paralleler Lauf findet Reaktion → bricht ab. Bei Fehler: Reaktion entfernen → nächster Cron-Lauf verarbeitet erneut.
- **Actor-Auflösung**: GitHub Notifications API liefert kein `actor`-Feld. Wir folgen URLs:
  - `mention`/`author` → `latest_comment_url` → `.user.login`
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

- [ ] **Use-Case-Validierung gegen echte API-Responses** (laufendes Debugging):
  - Aktuelle Notification: `reason=author`, `latest_comment_url=null` → klassifiziert als `unknown`
  - Frage: Wann setzt GitHub `latest_comment_url`? Nur bei neuen Review-Kommentaren? Bei PR-Aktivitäten (CI, Push) ist es `null`.
  - Frage: Wie sieht eine echte `review_requested`-Notification aus? Was ist der `actor`-Auflösungsweg?

### 🟡 Ausstehend

- [ ] **Lock bei `assign`/`review_requested`**: Kein `latest_comment_url` verfügbar → `acquireLock` gibt `null` zurück → Event wird nicht verarbeitet. Brauchen wir ein alternatives Lock-Target (z.B. Issue/PR selbst)?
  - Aktuelles Verhalten: `log("no_op", "Already locked or no comment URL: ...")`  
  - Gewünschtes Verhalten: TBD nach Use-Case-Validierung

- [ ] **`getActorFromUrl` mit `--jq`**: `ghJson` mit `--jq '.user.login'` parst den String als JSON — funktioniert, weil gh eine gültige JSON-Antwort (mit Quotes) zurückgibt. Verhalten validieren.

- [ ] **Cron-Setup dokumentieren**: `run.sh` ist vorhanden, crontab-Eintrag noch nicht final getestet in leerer Umgebung.

### ✅ Erledigt

- [x] `subject.actor.login` → Actor muss aus URL nachgeladen werden (`resolveActor`)
- [x] Cron PATH-Fix (`run.sh` Wrapper mit korrektem PATH)
- [x] `openclaw system event --mode now` (lowercase)
- [x] Lock-Erwerb in allen `run`-Tests verifiziert
- [x] `DEBUG`-Flag: `markThreadRead` im Debug-Modus übersprungen

---

## Debug-Prozess: Use-Case-Walkthrough

Für jedes Szenario:
1. Benjamin erstellt echtes GitHub-Event
2. Raw API-Response prüfen: `gh api notifications | python3 -c "import json,sys; [print(json.dumps(n, indent=2)) for n in json.load(sys.stdin)]"`
3. Script gegen live-API testen: `DEBUG=true node src/index.js`
4. Code anpassen falls nötig
5. Testcases nachziehen (reale API-Shapes als Fixtures)

### Szenario-Status

| Szenario | Status | Befund |
|----------|--------|--------|
| PR Review Comment (`author` + `latest_comment_url`) | 🔄 in Arbeit | `latest_comment_url=null` bei PR-Aktivität ohne Review-Comment |
| @-Mention in Issue/PR-Kommentar | ⬜ offen | — |
| Issue Assignment | ⬜ offen | — |
| PR Review Request | ⬜ offen | — |

---

## Quellen

- Issue #1: https://github.com/Husterknupp/hotel-metropol-incubator/issues/1
- PR #2 (geschlossen): https://github.com/Husterknupp/hotel-metropol-incubator/pull/2
- PR #3 (aktiv): https://github.com/Husterknupp/hotel-metropol-incubator/pull/3
