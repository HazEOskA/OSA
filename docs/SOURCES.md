# Źródła techniczne

Odczytane przy implementacji 2026-10-02:

- OpenAI Responses / text: https://developers.openai.com/api/docs/guides/text
- MCP TypeScript SDK v1: https://ts.sdk.modelcontextprotocol.io/server
- PostgreSQL SELECT / locking semantics: https://www.postgresql.org/docs/current/sql-select.html

SDK MCP i pakiety są przypięte przez package-lock.json. Adapter OpenAI używa publicznego endpointu Responses, jawnych inputs i parsed output_text blocks. Postgres v1 używa transakcyjnego advisory locka dla krótkich mutacji; nie deklaruje niezrealizowanego użycia SKIP LOCKED.
