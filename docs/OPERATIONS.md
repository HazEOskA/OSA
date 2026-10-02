# Uruchamianie i eksploatacja

## Lokalnie — własny Node i SQLite

```
npm ci
npm run setup
npm run verify
npm start
```

Adres: `http://127.0.0.1:3000`. Token z `data/access-token.txt` wklej do logowania; nie publikuj go. Setup generuje losowy token i przechowuje w konfiguracji jego hash. Nigdy nie nadpisuje istniejącej konfiguracji.

API uruchamia embedded worker domyślnie. `OSA_EMBEDDED_WORKER=false` i `npm run worker` rozdzielają procesy. Oba muszą używać tego samego magazynu. Node 24 jest wymagany ze względu na wbudowane SQLite.

## PostgreSQL i kontenery

Po setup ustaw lokalnie `OSA_POSTGRES_PASSWORD` (losowy sekret base64url, bez znaków specjalnych URL; nie commituje się go). Compose binduje API tylko do loopback, a baza nie ma publicznego portu:

```
docker compose --env-file .env -f infra/compose.yml up --build
```

Obraz jest budowany wieloetapowo i działa jako użytkownik node. API i worker korzystają z jednego PostgreSQL. Własny reverse proxy / ingress ma zapewnić TLS i poprawny `OSA_PUBLIC_URL`. Nie wykonano produkcyjnego deployu ani konfiguracji dostawcy chmury.

`/health/live`: proces API; `/health/ready`: zapytanie do magazynu. Endpointy /api wymagają tożsamości, metryki są prywatne. Logi błędów zawierają request ID i kod, nie token ani wejście użytkownika. Osobny worker potwierdzaj przez wykonanie kontrolnego joba; readiness API nie potwierdza jego działania.

Rotacja tokenu: zmień `tokenHash` w `OSA_IDENTITIES_JSON`, uruchom procesy z nową konfiguracją i ustaw nowy token klientom SDK/MCP. Sesje związane ze starym hashem przestają działać. Zmiana konfiguracji wymaga restartu; panel rotacji i OIDC nie są częścią v1.

## Modele i integracje

Prompt God (lokalny generator kontraktu), raporty i parser działają bez modelu. Silniki generatywne wymagają `OSA_AI_PROVIDER=openai`, `OPENAI_API_KEY` i `OPENAI_MODEL`. Model wybiera właściciel; w repo nie zapisujemy sekretu ani domyślnego płatnego modelu. `store:false` wyłącza przechowywanie response jako zasobu API; nie jest deklaracją zerowej retencji dostawcy.

Global Research / Leads / Radar mają opt-in `webSearch` i źródła cytowań zwrócone przez Responses API. Profile Engine może odczytać publiczną stronę przez własny adapter HTTPS. Reader pinowuje publiczny adres IPv4, ogranicza rozmiar/timeout i ponownie sprawdza przekierowania; IPv6-only strony są obecnie odrzucane.

Google Calendar/Drive/Gmail, dostawca cloud oraz faktyczna wysyłka email wymagają osobnych credentiali i zakresów. Obecny mailing przygotowuje draft i może trafić do approval inbox. Zgoda nie oznacza wysłania przez niepodłączony adapter.

## Backup, recovery, limits

SQLite: backup na zatrzymanym procesie lub przez SQLite backup API; zachowaj bazę z WAL/SHM spójnie. PostgreSQL: `pg_dump`, zaszyfrowane storage, okresowy restore test na osobnej instancji. Sekrety backupuje się osobno z kontrolą dostępu.

Run przy utracie workera wraca do claimu po lease. Retry ma backoff i 3 próby; po wyczerpaniu failed pozostaje trwałe. Ręczne ponowienie jest jawną akcją. Nie czyść tabel, aby „naprawić” status.

V1 limituje listy do 200, wejście joba do 96 KB, source do 1 MB, sesje nauki do 100 obserwacji. Retencja, cleanup sesji, DPA, tenant provisioning, token rotation UI, centralny rate limiting, OIDC i wydajność pod obciążeniem wymagają osobnego rollout planu.

## Browser learning i shell

Udostępnienie okna jest wyborem użytkownika. Nie ma ukrytego monitorowania. Kadr jest wysyłany wyłącznie po kliknięciu, nie zapisuje się jako obraz w trwałych danych OSA; tekst analizy jest obserwacją AI, a nie faktem o wiedzy użytkownika. Backend blokuje analizę aktywnego oznaczonego egzaminu.

Shell v1 plan: ta sama statyczna aplikacja + OSA API/worker na loopback. Host capability adapter dopiero po wyborze systemu i pomiarach RAM/CPU sprzętu. Nie instalujemy systemu operacyjnego i nie formatujemy laptopa.
