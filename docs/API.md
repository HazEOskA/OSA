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
