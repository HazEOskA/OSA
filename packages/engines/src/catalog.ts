export const catalog = [
  {
    id: 'prompt',
    title: 'Prompt God',
    area: 'Twórz',
    description: 'Gotowy prompt agenta z celem, zakresem i dowodem.',
    input: 'Cel, repo / kontekst, dozwolone akcje, rezultat i walidacja…',
    instruction:
      'Zwróć gotowy prompt agenta, nie lekcję promptowania. Cel, zakres, polityki, kroki, testy i warunek zakończenia.',
  },
  {
    id: 'profile',
    title: 'Profile Engine',
    area: 'Tożsamość',
    description: 'Strona → bio, projekty i wskazówki.',
    input: 'Twoje fakty, projekty, odbiorca i docelowa strona…',
    instruction:
      'Bio krótkie/długie, nagłówki, opisy istniejących projektów tylko z faktów użytkownika, wskazówki i checklistę publikacji. Nowe projekty oznacz PROPOZYCJA. Nie przypisuj osiągnięć strony docelowej użytkownikowi.',
  },
  {
    id: 'leads',
    title: 'Lead Engine',
    area: 'Rynek',
    description: 'Firmy, sygnały, źródła, dopasowanie.',
    input: 'Oferta, ICP, rynek, firmy lub sygnały…',
    instruction:
      'Dla leadów podaj firmę, źródło, sygnał potrzeby, fit 0–5, brakujące informacje i krok. Nie wymyślaj kontaktów, emaili, stanowisk ani sygnałów. Wnioski odróżnij od źródeł.',
  },
  {
    id: 'research',
    title: 'Global Research',
    area: 'Rynek',
    description: 'Źródła, porównanie, wnioski i niepewności.',
    input: 'Pytanie, zakres badania, decyzja do podjęcia…',
    instruction:
      'Research z datami i źródłami: fakty, rozbieżności, wnioski jawnie jako interpretacja, ograniczenia i kolejne kroki. Bez źródeł nie udawaj bieżącego wyszukiwania.',
  },
  {
    id: 'mail',
    title: 'Cold Mailing',
    area: 'Rynek',
    description: 'Draft, follow-upy i osobna zgoda na akcję.',
    input: 'Odbiorca, oferta, sprawdzony powód kontaktu, ton i CTA…',
    instruction:
      'Przygotuj temat, krótki draft i dwa follow-upy z checklistą. Nie wysyłaj wiadomości. Nie wymyślaj relacji ani faktów. Oznacz DRAFT / NIE WYSŁANO.',
  },
  {
    id: 'radar',
    title: 'Opportunity Radar',
    area: 'Rynek',
    description: 'Oferty, bounty, RFP i plan zgłoszenia.',
    input: 'Umiejętności, dostępny czas, budżet i zakres szans…',
    instruction:
      'Dla płatnych ofert, bounty i RFP podaj źródło, dopasowanie, termin jeśli źródło podaje, wymagania i następny krok. Nie przedstawiaj wygasłych lub niezweryfikowanych ofert jako aktywnych.',
  },
  {
    id: 'review',
    title: 'Code Review',
    area: 'Kod',
    description: 'Review na wywołanie, P0–P3 z dowodem.',
    input: 'Diff / plik z nazwą, numery linii, kontekst i ryzyka…',
    instruction:
      'Review P0–P3, plik/linia/cytat, scenariusz błędu, propozycja poprawki i test regresji. Nie twierdź, że wykonałeś testy. Nie wymuszaj usterek w poprawnym kodzie.',
  },
  {
    id: 'academy',
    title: 'Akademia Czytania Kodu',
    area: 'Nauka',
    description: 'Przepływ, funkcje, zależności, ćwiczenia.',
    input: 'Kod, pytanie, opcjonalnie własna odpowiedź…',
    instruction:
      'Wyjaśnij przepływ wejście → funkcje → zależności → wynik; diagram Mermaid, ćwiczenia i pytania. Sprawdź podaną odpowiedź ucznia z konkretnym dowodem, podaj test naprawczy. Nie oceniaj wiedzy z pauz.',
  },
  {
    id: 'labs',
    title: 'OSA Labs',
    area: 'Kod',
    description: 'Eksperyment, benchmark i powtarzalny dowód.',
    input: 'Hipoteza, baseline, metryka, środowisko i dostarczone wyniki…',
    instruction:
      'Hipoteza, baseline, zmienne, procedura, metryka, kryterium sukcesu, komendy i format dowodu. Nie udawaj wykonanego eksperymentu. Wyniki analizuj tylko jeśli podano.',
  },
  {
    id: 'certificate',
    title: 'OSA Certyfikat',
    area: 'Nauka',
    description: 'Sesja, obserwacje, błędy i kolejne ćwiczenia.',
    input: 'Temat nauki, obserwowane odpowiedzi, konkretne trudności…',
    instruction:
      'Raport nauki: obserwowane fakty, błędy z dowodem, hipotezy oznaczone, ćwiczenia naprawcze i następne kroki. Nie oceniaj z pauz. Nie rozwiązuj trwającego ocenianego egzaminu i nie wystawiaj fikcyjnej akredytacji.',
  },
  {
    id: 'verify-syntax',
    title: 'Weryfikacja składni',
    area: 'Proof',
    description: 'Rzeczywisty node --check, bez wykonania wklejonego kodu.',
    input: 'Kod JavaScript do sprawdzenia składni…',
    instruction: '',
  },
  {
    id: 'daily-report',
    title: 'Raport wieczorny',
    area: 'Rytm',
    description: 'Trwały raport z danych kernela i harmonogramu.',
    input: 'Opcjonalny kontekst raportu…',
    instruction: '',
  },
] as const;
