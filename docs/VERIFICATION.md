# Weryfikacja OSA infra

Stan lokalny sprawdzony 2026-10-02. CLAIM != PROOF: obecność adaptera nie oznacza wykonania integracji z dostawcą.

| Sprawdzenie                                | Wynik          | Dowód i zakres                                                                                                  |
| ------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------- |
| TypeScript backend + React                 | PASS           | `npm run typecheck`, strict mode                                                                                |
| Build API, worker, SDK, MCP i Control Room | PASS           | `npm run build`; klient 226.88 kB JS, 71.30 kB gzip                                                             |
| Kernel / HTTP / SDK / MCP / auth           | PASS           | `npm run verify`: 16 passed, 0 failed, 1 skipped                                                                |
| SQLite persistence                         | PASS           | ponowne otwarcie magazynu zachowuje dane i kolejkę                                                              |
| Rzeczywista kontrola składni               | PASS           | proces `node --check`, poprawny i błędny kod, exit code, digest i powiązanie run/evidence                       |
| Przeglądarka desktop 1440 × 1000           | PASS           | `npm run test:browser`: rzeczywisty HTTP, sesja, misja, worker, proof, zgoda, raport, reload i logout           |
| Przeglądarka mobile 390 × 844              | PASS           | ten sam test, brak poziomego overflow i działająca nawigacja                                                    |
| PostgreSQL lokalnie                        | NIE WYKONANO   | test pominięty bez `OSA_TEST_DATABASE_URL`; środowisko nie uruchamia serwera jako nieuprzywilejowany użytkownik |
| Docker lokalnie                            | NIE WYKONANO   | brak runtime Docker w środowisku wykonania                                                                      |
| OpenAI / web search / vision               | NIE WYKONANO   | nie skonfigurowano klucza ani modelu; brak konfiguracji jest testowanym błędem joba                             |
| Google, cloud i wysyłka email              | NIE PODŁĄCZONO | stan jawny w API i Control Room                                                                                 |

## Co chronią testy

- Izolacja tenantów, brak zapisu przez readera i kontrola wersji przy zmianie misji.
- Transakcyjny rollback, integrity łańcucha zdarzeń i brak możliwości podniesienia wklejonego artefaktu do executed verification.
- Idempotency, równoległe claimy, wygasły lease, fencing starego workera, anulowanie i ograniczony retry.
- Zamknięcie misji wymaga wszystkich kroków i evidence; wariant „z kontrolą” wymaga rzeczywistej udanej weryfikacji.
- Zgoda ownera dotyczy dokładnego payloadu. Nie uruchamia wysyłki.
- Scheduler ma trwały termin, dedupe między procesami i poprawną strefę IANA.
- Aktywny oznaczony egzamin blokuje analizę kadru i raport pomocniczy.
- HttpOnly session, CSRF, obcy Origin, wylogowanie, rotacja tokenu i zmiana roli.
- Oficjalny klient MCP negocjuje protokół i wywołuje pięć narzędzi przez rzeczywisty backend.

## Odtwarzanie i CI

```
npm ci
npm run setup
npm run verify
npx playwright install chromium
npm run test:browser
```

Test przeglądarki używa osobnej bazy `qa/browser-<pid>.sqlite`. Nie zmienia bazy użytkownika. Screenshoty trafiają do ignorowanego `qa/`; CI przechowuje wyłącznie PNG, nigdy bazę ani tokeny. Lokalny test użył Chromium dostarczonego przez `OSA_QA_CHROMIUM`, ponieważ standardowe pobranie Chromium w tym środowisku nie zakończyło się poprawnie.

Workflow `.github/workflows/ci.yml` uruchamia również rzeczywisty PostgreSQL 18, browser check, build Docker i test Compose: API → PostgreSQL → osobny worker → parser → powiązany evidence. Sam zapis workflow nie jest PASS; wynik należy odczytać z konkretnego run w GitHub Actions.

`npm run test:compose` wymaga już uruchomionego Compose i tokenu z własnego setup. Tworzy jedną misję testową i wykonanie. Nie uruchamiaj go na produkcyjnej bazie.

## Granice proof

Parser sprawdza składnię JavaScript, nie poprawność programu ani bezpieczeństwo całego repo. Hash sprawdza spójność zapisanych danych, nie podpis niezależnego audytora. Raport to snapshot zapisów kernela z jawnym limitem pokrycia, nie automatyczne potwierdzenie produktywności. Metryki i testy obciążeniowe, restore backupu, zdalny MCP/OAuth oraz test rzeczywistego modelu pozostają osobnymi etapami.
