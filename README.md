# OSA — infrastruktura pod framework

[![OSA verification](https://github.com/HazEOskA/OSA/actions/workflows/ci.yml/badge.svg)](https://github.com/HazEOskA/OSA/actions/workflows/ci.yml)

Własny kernel, API, trwały runtime i Control Room. Jeden przepływ: **cel → wykonanie → dowód → raport**. React UI, TypeScript SDK i MCP używają tego samego backendu.

## Uruchom

```
npm ci
npm run setup
npm run verify
npm start
```

Otwórz `http://127.0.0.1:3000`; prywatny token jest w `data/access-token.txt`. Node 24+. Setup niczego nie nadpisuje.

## W tym wydaniu

- Kernel: Identity, Mission, Execution, Approval, Evidence i Event.
- Auth własnej infrastruktury: role owner/builder/reader, prywatne tenanty, HttpOnly session, CSRF, hashed tokens.
- SQLite lokalnie i adapter PostgreSQL, atomowe transakcje, wersjonowanie.
- Worker: trwała kolejka, idempotency, lease/heartbeat, fencing, retry/backoff, cancellation.
- Scheduler raportu wieczornego: godzina, strefa IANA, trwały termin i dedupe.
- Evidence: digest, run binding, odróżnienie deklaracji od draftu AI i wykonanej kontroli.
- Wykonany `node --check` w osobnym procesie; wklejony kod jest parsowany, nie uruchamiany.
- OSA Prompt God, Profile, Lead Engine, Global Research, Cold Mailing, Radar, Code Review, Akademia, Labs i Certyfikat.
- Sesje nauki, obserwacje, jawny podgląd okna, pojedynczy kadr na żądanie i raport naprawczy.
- Control Room po polsku: misje, runtime, proof/approval, nauka, rytm i platforma.
- TypeScript SDK i pięć narzędzi MCP na oficjalnym SDK.
- Docker/Compose, CI z PostgreSQL, dokumentacja i testy.

Silniki generatywne wymagają własnego klucza i modelu. Brak konfiguracji kończy job jawnym błędem; wynik nie jest udawany. Google, chmura i wysyłka email pozostają niepodłączone bez credentiali. Nie wykonano produkcyjnego wdrożenia ani publikacji ChatGPT app.

## Struktura

```
apps/api/             auth, HTTP, statyczny Control Room
apps/control-room/    React / TypeScript
apps/mcp/             serwer stdio
packages/kernel/      kontrakty, polityki, transitions
packages/store/       SQLite / PostgreSQL
packages/runtime/     worker / scheduler
packages/engines/      rejestr i adaptery wykonania
packages/adapters/     OpenAI / public sources
packages/sdk/          klient frameworka
infra/                kontenery
scripts/              bezpieczny lokalny setup
tests/                kernel / HTTP / MCP / Postgres
docs/                 architektura, API, MCP, operacje, proof
```

Dokumentacja: [architektura](docs/ARCHITECTURE.md), [operacje](docs/OPERATIONS.md), [MCP i golden prompts](docs/MCP.md), [API](docs/API.md), [weryfikacja](docs/VERIFICATION.md).

`npm run worker` — osobny proces; `npm run mcp` — transport lokalny. Cloud-ready oznacza artefakty do własnego hostingu; nie deklaruje production readiness, akredytacji certyfikatu ani wykonania nieuruchomionych testów.
