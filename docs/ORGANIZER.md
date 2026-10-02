# OSA — Mój dzień

## Jeden wynik użytkownika

Użytkownik kończy planowanie z **jedną wybraną pracą TERAZ i konkretnym następnym krokiem**. Skrzynka przechowuje resztę, trzy priorytety ograniczają plan, a tryb skupienia usuwa pozostałe listy z ekranu.

## Dostarczony przepływ

1. Zapis pełnej myśli do 4000 znaków. Wpis trafia do skrzynki.
2. Świadomy wybór maksymalnie trzech priorytetów i jednej bieżącej pracy.
3. Zapis następnego kroku i oszacowanie czasu; budżet ostrzega o przeciążeniu.
4. Jeden trwały blok pracy na osobę, z pauzą/wznowieniem i zegarem serwera.
5. Jawne oznaczenie ukończenia. Timer ani model AI nie poświadczają wyniku.
6. Ręczne domknięcie: ukończone, niedokończone, notatki, przeszkoda i jedna praca na jutro.
7. Narzędzie otwierane z kontekstem pracy. Otwarcie nie zleca wykonania.

Domyślnie Europe/Amsterdam i 90 min. Można wybrać dzień oraz zmienić czas/strefę. Inbox, później i archiwum nie tracą pełnej treści. Raport jest snapshotem; późniejsza edycja pracy nie przepisuje historii.

## Pliki i granice

| Plik | Odpowiedzialność |
| --- | --- |
| apps/control-room/src/Organizer.tsx | Dzień, focus, skrzynka, edycja i domknięcie |
| apps/control-room/src/organizer.css | Osobna powierzchnia pracy, mobile i reduced motion |
| packages/kernel/src/organizer.ts | Prywatny namespace, transitions, wersje i zegar |
| packages/kernel/src/contracts.ts | Wspólne typy API i UI |
| apps/api/src/server.ts | Authenticated GET/POST organizera i paginacja |
| tests/organizer.test.ts | Trwałość, limity, konflikty, snapshoty, izolacja i PostgreSQL |
| scripts/organizer-browser.mjs | Pełny przepływ w prawdziwej przeglądarce |
| docs/API.md | Kontrakt każdej akcji |

Generic entity store przyjmuje nowe kinds bez migracji SQL. SQLite uruchamia lokalny organizer. PostgreSQL przechowuje tę samą strukturę dla wielu procesów. Worker, SDK, istniejące MCP i silniki zachowują swoje kontrakty.

## ChatGPT: proponowany plan pięciu narzędzi

Poniższe mapowanie organizera jest planem kolejnego adaptera ChatGPT, nie deklaracją implementacji dodatkowych narzędzi MCP. Obecne pięć narzędzi infrastruktury opisuje [MCP.md](MCP.md).

| Nazwa | Opis | Wejście | Wyjście |
| --- | --- | --- | --- |
| get_day_plan | Odczytuje osobisty plan i otwarty blok | date? | Snapshot, current task, next step, coverage |
| capture_thought | Zachowuje pełną myśl bez planowania | text, nextStep?, estimateMinutes? | Saved entry i snapshot |
| choose_priorities | Wybiera lub usuwa priorytet i ustawia TERAZ | operation, entryId, planVersion | Plan z najwyżej trzema priorytetami |
| control_work_block | Rozpoczyna, pauzuje, wznawia lub kończy jeden blok | operation, id, versions, minutes? | Persisted block i server time |
| close_day | Zapisuje domknięcie i jedną pracę na jutro | date, planVersion, notes?, blocker?, tomorrowId?, tomorrowVersion? | Immutable closure i tomorrow plan |

Wersja dashboardu potrzebuje React UI: wybór pracy, timer i skrzynka są jej głównym sposobem użytkowania. Pierwszy adapter ChatGPT może udostępnić dane tekstowo; widget React warto dodać po OAuth i publicznym MCP. Serwer MCP pozostaje TypeScript. Istniejący stdio nie jest publiczną aplikacją ChatGPT.

## Auth i deployment

Auth dashboardu: istniejące hashowane tokeny, HttpOnly session, role, Origin i CSRF. Organizer wylicza osobisty namespace z authenticated tenant+subject; kolega z tego samego tenantu nie widzi tych danych. Tożsamość z body jest ignorowana.

Publiczny ChatGPT adapter wymaga HTTPS MCP, OAuth z mapowaniem subject, właściwych scopes i izolacji użytkownika. Widget wymaga osobnego przeglądu CSP, domen oraz stanu autoryzacji. Nie dodano credentiali ani produkcyjnego wdrożenia. Istniejący Docker/Compose i CI służą do sprawdzenia artefaktów. Google/Calendar/Gmail wymagają oddzielnego podłączenia i zgody na zakresy.

## Golden prompts / scenariusze akceptacyjne

| Prompt | Oczekiwany wynik |
| --- | --- |
| Mam chaos. Zapisz tę myśl, ale niczego nie planuj. | Pełny inbox entry; brak nowego priorytetu/bloku |
| Mam cztery zadania. Na dziś wybieram A, B, C i D. | Najwyżej trzy; czwarte zostaje w skrzynce |
| Teraz chcę zrobić B. | Jedna wybrana praca, bez uruchamiania silnika |
| Mam tylko 40 minut, a plan zajmuje 100. | Widoczne ostrzeżenie; użytkownik decyduje co odłożyć |
| Włącz blok, ale nie wiem od czego zacząć. | NEXT_STEP_REQUIRED i miejsce na konkretny krok |
| Pauza. Wracam po restarcie. | Ten sam zapisany blok, czas pauzy nie dodaje pracy |
| Mam dwie karty; stara karta wznawia stary stan. | 409 VERSION_CONFLICT; bez nadpisania nowego stanu |
| Otwórz review z kontekstem tej pracy. | Formularz zawiera task i nextStep; brak automatycznego run |
| Zarchiwizuj i przywróć moją długą notatkę. | Pełne 4000 znaków zachowane |
| Domknij dzień i zostaw B na jutro. | Immutable report oraz jeden dodany jutrzejszy priorytet |
| Zmień B jutro. | Wczorajszy snapshot pozostaje taki sam |
| Pokaż plan mojego kolegi. | Dane własnego namespace; brak dostępu do cudzych wpisów |

## Testy i otwarte kwestie

CI uruchamia strict TypeScript, build, testy kernela/API/MCP/organizera/PostgreSQL, dawny przepływ infrastruktury i nowy przepływ organizera w Playwright, a następnie Docker/Compose. Zrzuty: pusty dzień, desktop, focus, mobile 390px i domknięcie. Wynik konkretnego run należy sprawdzić w GitHub Actions; historia wcześniejszych testów infrastruktury nie jest dowodem nowego UI.

Nie ma lokalnej kolejki offline: formularz zachowuje niezapisany tekst po błędzie, a zmiana wymaga odpowiedzi serwera. Należy rozważyć szyfrowany eksport/backup danych oraz retencję przed hostingiem dla wielu użytkowników. Historia jest paginowana i ma jawne coverage; nie jest udawana jako kompletna. Native shell na lekkim laptopie pozostaje następnym etapem, po pomiarach pamięci, startu i uprawnień hosta.

## Wspólna przestrzeń i osobisty raport

Organizera nie odmontowuje przejście do projektu, narzędzia, sesji nauki lub platformy. Formularze modułów otwierają się w pracowni na tym samym ekranie; prywatny plan, szkic skrzynki i zegar pozostają aktywne. Narzędzia są dostępne także bez wybranej pracy. Samo ich otwarcie niczego nie zleca.

`report.generate` zapisuje osobisty snapshot bez zamykania dnia. Snapshot przechowuje ukończone wpisy, otwarte priorytety, czas z bloków, konkretny następny krok oraz istniejące notatki domknięcia. Późniejsza edycja wpisu nie zmienia raportu. Raport uwzględniający otwarty blok wyraźnie zaznacza chwilę pomiaru.

Nowe harmonogramy zapisują `ownerSubject` z uwierzytelnionej tożsamości. Kernel wiąże `requestedBy` i `trigger` z rzeczywistym wywołaniem; body nie wybiera właściciela. Worker generuje raport w prywatnym namespace tej osoby. Wspólny wynik `daily-report` i evidence nie zawierają tekstu prywatnych zadań. Starszy harmonogram bez znanego właściciela nadal tworzy raport projektu, lecz nie przypisuje osobistego raportu przypadkowemu użytkownikowi.

`GET /api/organizer/reports?cursor=...` udostępnia paginowaną historię prywatnych raportów. Snapshot zawiera ostatnie 30 oraz przypięty raport wybranego dnia; coverage sygnalizuje dalszą historię.

## Launcher

`Uruchom-OSA.cmd` używa dołączonego `runtime/node.exe` w pakiecie Windows lub Node.js 24+ w repo. Nie nadpisuje istniejącej konfiguracji, nie zatrzymuje obcego procesu na porcie i nie zmienia konfiguracji Codex/Windows. Proces API działa na loopback; dane pozostają w instalacji aplikacji.

Lokalny credential jest przekazywany w fragmencie adresu wyłącznie na loopback i usuwany z historii przed pierwszym żądaniem. Nie trafia do query string, storage przeglądarki ani logu HTTP. Autoryzacja nadal korzysta z dotychczasowej sesji HttpOnly i CSRF. Nie jest to publiczny mechanizm OAuth.

CI Windows sprawdza rzeczywisty pierwszy start oraz ponowny start gotowego pakietu z jego własnym runtime. Dystrybucja zawiera licencję Node.js i zależności produkcyjne; nie zawiera .env, danych, tokenów ani zrzutów z testów.
