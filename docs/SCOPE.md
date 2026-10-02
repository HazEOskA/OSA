# Zakres i granice wydania OSA infra

| Wymaganie                 | Implementacja                                              | Granica                                                     |
| ------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| Własna infrastruktura     | kernel/API/store/runtime/SDK w tym repo                    | brak production deploy                                      |
| Control Room              | React podłączony do własnego API                           | testowane desktop i mobile osobno                           |
| Prompt God                | lokalny gotowy prompt z goal/scope/policy/verify           | deterministyczny generator kontraktu, nie LLM               |
| Profile                   | public URL reader + model prompt do bio i projektów        | własne fakty użytkownika, credentials modelu wymagane       |
| Lead Engine               | model, opcjonalne web search, cytowania, fit               | brak CRM i automatycznego enrichmentu danych kontaktowych   |
| Global research           | opt-in web search i public source reader                   | runtime modelu wymagany, output draft                       |
| Mailing                   | draft, followupy, hash-bound approval                      | wysyłka pozostaje niedostępna bez transportu                |
| Opportunity Radar         | wyszukiwanie/model ranking na żądanie                      | cykliczne odkrywanie ofert to rozszerzenie schedulera       |
| Review                    | model analysis P0–P3 + oddzielny rzeczywisty parser        | bez dowolnego wykonania kodu i bez repo sync                |
| Akademia                  | kod → przepływ / ćwiczenia / odpowiedź do oceny            | LLM wymagany; brak school tenancy produktu                  |
| Labs                      | eksperyment, dostarczone wyniki, proof-linked run          | benchmark wykonuje człowiek lub przyszły allowlisted runner |
| Certyfikat                | sesja/obserwacje/frame/report job                          | nie jest akredytowanym certyfikatem; exam guard             |
| Raport wieczorny          | trwały harmonogram i worker                                | worker musi działać; snapshot ma coverage                   |
| Time orchestration        | timer, persisted sessions, report                          | brak Google Calendar sync                                   |
| Google / clouds           | config boundaries, Docker/Compose, cloud hosting artifacts | niepodłączone bez wybranych scopes/provider/credentiali     |
| OpenAI Developer Platform | własny Responses adapter i link do oficjalnego panelu      | API key/model konfiguracja właściciela                      |
| Docs / SDK / MCP          | własne kontrakty, HTTP client i pięć narzędzi stdio        | brak zdalnego OAuth ChatGPT publikowanego produktu          |
| Framework szkół / landing | może używać tych samych kontraktów                         | osobne produkty nie są dostarczone jako gotowe              |
| Shell / laptop            | wspólny UI/API, focus mode                                 | system i host adapter odłożone zgodnie z ustaleniem         |

## Otwarte decyzje i ryzyka

- Docelowy tenant provisioning / OIDC i bezpieczne przechowywanie sekretów.
- Dostawca chmury, domena/TLS, monitoring, backup/restore i retencja.
- Zakres Google OAuth i faktyczny transport poczty z recipient-specific approvals.
- Model, budżet, web-search support i przetwarzanie danych przez providera.
- Kontrakty konkretnego istniejącego frameworka i kompatybilność z jego wersją (nie wskazano repo konsumenta).
- Trwałe storage jest zaimplementowane; throughput, disaster recovery i compliance nie są dowiedzione samym kodem.
- Dotychczasowa aplikacja AppDeploy pozostaje oddzielna; nowy kod jej nie importuje ani nie wykonuje ukrytej migracji danych.
