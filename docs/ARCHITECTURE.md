# OSA — własna infrastruktura frameworka

Jeden core outcome: właściciel wybiera konkretny cel, zleca wykonanie i dostaje wynik powiązany z dowodem oraz następnym krokiem.

Control Room jest klientem infrastruktury, nie zamiennikiem kernela. Ten sam kontrakt wykorzystują SDK, MCP i przyszłe produkty szkół. Kod nie importuje AppDeploy, Base44 ani hostowanych SDK builderów.

## Kontrakty

| Obiekt    | Odpowiedzialność                                                                             |
| --------- | -------------------------------------------------------------------------------------------- |
| Identity  | tenant, subject, role; nigdy tenant podany przez klienta zamiast uwierzytelnionej tożsamości |
| Mission   | cel, kroki, stan, wersja; zamknięcie wymaga ukończonych kroków i artefaktu                   |
| Execution | trwałe wejście, idempotency key i digest, kolejka, próby, lease, token workera, wynik        |
| Approval  | konkretna akcja i payload digest; osobna decyzja właściciela                                 |
| Evidence  | pochodzenie, treść, digest, run ID, digest wejścia, rodzaj i werdykt                         |
| Event     | sekwencja per tenant, typ, podmiot, poprzedni hash i hash treści                             |

Ślad hashów wykrywa zmianę danych względem zachowanego łańcucha. Nie jest podpisem z zewnętrznym root of trust i nie chroni przed administratorem przepisującym cały magazyn.

## Granice pakietów

- `packages/kernel`: typy domenowe, polityki i state transitions.
- `packages/store`: port trwałości, SQLite i PostgreSQL z tym samym kontraktem.
- `packages/runtime`: worker, lease, heartbeat, odzyskanie, retry/backoff i scheduler.
- `packages/engines`: registry, Prompt God, raport, rzeczywisty parser oraz silniki z adapterem modelu.
- `packages/adapters`: OpenAI Responses i czytnik stron z walidacją DNS/pinowaniem adresu.
- `packages/sdk`: TypeScript client frameworka.
- `apps/api`: autoryzacja, sesje, CSRF, HTTP i statyczny React Control Room.
- `apps/mcp`: pięć narzędzi na oficjalnym SDK MCP, lokalny transport stdio.
- `apps/control-room`: UI w języku polskim, bez zależności od hostowanego buildera.

## Runtime

Krótka transakcja atomowo claimuje zadanie i zmienia token lease. Wywołanie modelu lub parsera odbywa się poza transakcją. Heartbeat odnawia lease. Zapis wyniku wymaga aktualnego tokenu, stanu running i ważnego lease; stary worker nie może zatwierdzić wyniku po przejęciu zadania. Zapis wyniku i evidence jest atomowy.

To przetwarzanie at-least-once: po utracie lease provider może otrzymać ponowne wywołanie. Idempotency ogranicza duplikaty zgłoszeń; nie jest gwarancją exactly-once kosztów zewnętrznego dostawcy. Rejestr v1 nie zawiera zewnętrznych silników mutujących.

Postgres v1 serializuje krótkie mutacje advisory lockiem, co upraszcza zgodność z SQLite i łańcuch zdarzeń. To świadomy limit throughputu; nie deklarujemy skalowania bez benchmarku. Provider I/O nigdy nie trzyma tego locka. Osobne workery mogą wykonywać różne claimowane zadania równolegle.

Scheduler ma trwałe terminy, strefę IANA i klucz idempotencji per lokalny dzień. Po przerwie coalescuje zaległy termin do jednego wykonania. Worker musi działać; brak działającego procesu nie jest ukrywaną automatyzacją.

## Rodzaje dowodu

`user-artifact` = deklaracja / zapis; `ai-draft` = wynik modelu; `verification` = wykonana kontrola parsera; `report` = agregacja kernela. API od użytkownika nie przyjmuje dowolnego podniesienia rodzaju dowodu do verification. Kontrola składni nie jest testem zachowania kodu ani security audit.

Raporty zawierają zakres pokrycia (maks. 200 obiektów rodzaju), a API udostępnia kursory. Data raportu jest etykietą snapshotu stanu, nie pełnym historycznym replayem wybranego dnia.

## Produkty i framework

Przyszły framework importuje typy i `OsaClient`, używa run ID oraz dowodów, nie backendu konkretnego hostingu. SDK jest wygenerowane w dist wraz z deklaracjami TypeScript. Monorepo nie publikuje jeszcze paczek npm. Osobny produkt szkół, landing oraz lekki shell korzystają z tych samych kontraktów; ich wdrożenie nie jest utożsamiane z tą infrastrukturą.
