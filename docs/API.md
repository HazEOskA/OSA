# API OSA v1

Wszystkie endpointy `/api/*` poza loginem wymagają tożsamości. Bearer token jest hashowany i porównywany stałoczasowo; browser używa HttpOnly session. Mutacje sesyjne wymagają `X-OSA-CSRF`, a podany Origin musi odpowiadać `OSA_PUBLIC_URL`.

Błąd: `{ error: { code, message, requestId } }`. JSON input jest walidowany i limitowany. Tożsamość i tenant wynikają z backendowego auth, nigdy z body.

| Method / path                    | Wejście / rezultat                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| POST /api/auth/login             | token → identity + csrf; Set-Cookie                                                   |
| GET /api/auth/me                 | identity + csrf                                                                       |
| POST /api/auth/logout            | revoke current session                                                                |
| GET /api/bootstrap               | report + approvals + schedules + learning + integration status                        |
| GET /api/missions?cursor=&limit= | Page<Mission>                                                                         |
| GET /api/missions/:id            | Mission                                                                               |
| POST /api/missions               | title, description?                                                                   |
| PATCH /api/missions/:id          | version, addStep?, stepId?/done?, title?, description?, status?, requireVerification? |
| GET /api/runs                    | paginated runs                                                                        |
| GET /api/runs/:id                | execution state, attempt, result/error                                                |
| POST /api/runs                   | engine, input, idempotencyKey, missionId? → queued Run                                |
| POST /api/runs/:id/cancel        | cancel; embedded worker abort signal; other worker observes heartbeat                 |
| POST /api/runs/:id/retry         | explicit retry only from failed                                                       |
| GET /api/evidence                | paginated evidence                                                                    |
| POST /api/evidence               | content, missionId? → user-artifact only                                              |
| GET /api/evidence/:id/verify     | integrity, binding, executionVerified                                                 |
| GET /api/approvals               | approval inbox                                                                        |
| POST /api/approvals              | action, payload                                                                       |
| POST /api/approvals/:id/decide   | decision, payloadDigest; owner only                                                   |
| GET /api/schedules               | schedules                                                                             |
| POST /api/schedules              | title, hour, minute, timezone; owner only                                             |
| PATCH /api/schedules/:id         | enabled boolean; owner only                                                           |
| POST /api/learning               | title, exam?                                                                          |
| POST /api/learning/:id/observe   | text → observation                                                                    |
| POST /api/learning/:id/finish    | enqueue report; active exam blocked                                                   |
| POST /api/learning/:id/frame     | transient JPEG base64 + context; active exam blocked; image not persisted             |
| POST /api/focus                  | title, seconds (client-declared measurement)                                          |
| GET /api/report                  | kernel snapshot + coverage; date? is snapshot label                                   |
| GET /api/events?after=           | event page + chain/page-integrity result                                              |
| GET /api/metrics                 | private counts/coverage                                                               |
| GET /health/live                 | process alive                                                                         |
| GET /health/ready                | store query succeeded                                                                 |

Reader cannot write. Builder can run engines and update missions; owner can decide approvals and schedules. Version conflicts return 409. The same idempotency key returns the same run if request digest matches; changed input returns 409.

Types: `packages/kernel/src/contracts.ts`. SDK: `packages/sdk/src/index.ts` (`OsaClient`).


## Osobisty organizer

Namespace wylicza serwer z pary authenticated tenantId + subject. Body nie wybiera użytkownika.
Reader ma odczyt własnego organizera. POST zachowuje dotychczasowe kontrole Origin, CSRF, rozmiaru body i limitu wywołań.

- GET /api/organizer?date=YYYY-MM-DD → OrganizerSnapshot; bez date: dzień w strefie użytkownika.
- GET /api/organizer/inbox?status=inbox|later|done|archived&cursor=... → Page<OrganizerEntry>.
- POST /api/organizer → nowy OrganizerSnapshot po zatwierdzonej transakcji; body zawiera action oraz opcjonalne date.
- Konflikt wersji: 409 VERSION_CONFLICT. Należy odczytać widok i świadomie ponowić akcję.
- Snapshot ma ostatnie 200 wpisów/bloków i 30 planów/domknięć oraz coverage. Priorytety, ukończenia dnia, bloki dnia, aktywny blok i plan na jutro są pobierane osobno po id.
- Pełną skrzynkę można przejść kursorem. Strona może nie zawierać dopasowanych wpisów, lecz mieć nextCursor; należy czytać dalej.

| action | Wejście poza action/date | Efekt |
| --- | --- | --- |
| capture | text (1–4000 znaków), nextStep?, estimateMinutes? | Pełny zapis w inbox; bez automatycznego planowania |
| edit | id, version wpisu, text?, nextStep?, estimateMinutes? | Wersjonowana edycja aktywnego wpisu |
| move | id, version wpisu, status (inbox/later/archived), planVersion gdy jest priorytetem | Zmiana listy; archiwum zachowuje treść i wcześniejszy stan |
| restore | id, version wpisu, planVersion gdy wymagane | Przywrócenie z archiwum |
| priority.add/remove | id, version planu | Najwyżej trzy priorytety; pierwszy wybrany staje się TERAZ |
| select | id, version planu | Wybór jednej aktywnej pracy spośród priorytetów |
| settings | version planu, availableMinutes (0–720), timezone?, settingsVersion gdy zmienia timezone | Budżet dnia i strefa IANA |
| complete | id, version wpisu | Oznaczenie ukończenia; wymaga zakończenia jego bloku |
| block.start | id wybranej pracy, version planu, settingsVersion, minutes (1–180) | Jeden blok na osobę; wymaga nextStep |
| block.pause/resume/finish | id bloku, version bloku, note? dla finish | Zegar serwera i trwały stan; finish nie oznacza automatycznie ukończenia zadania |
| close | version planu, notes?, blocker?, tomorrowId?, tomorrowVersion gdy jest tomorrowId | Niezmienny snapshot i atomowe przeniesienie jednej pracy na jutro |

Domknięty plan odrzuca ponowne close oraz start/zmianę priorytetów. Capture pozostaje dostępne. Blok sprzed północy można zakończyć następnego dnia. Limit bezpieczeństwa wynosi 200 ukończeń i 200 bloków na dzień; przekroczenie zwraca DAY_LIMIT zamiast obcinać raport.

### Raport osobistego dnia

- `POST /api/organizer`: `{ action: "report.generate", date? }` — zapisuje immutable snapshot, zachowuje otwarty dzień i zwraca aktualny OrganizerSnapshot.
- `GET /api/organizer/reports?cursor=...` — prywatny Page<OrganizerReport>.
- OrganizerSnapshot zawiera `reports` oraz `coverage.reportsHaveMore`; OrganizerDay.reportId przypina najnowszy raport wybranego dnia.
- Właściciel raportu pochodzi wyłącznie z uwierzytelnionej tożsamości. Zwykłe raporty projektu nie ujawniają jego treści.
