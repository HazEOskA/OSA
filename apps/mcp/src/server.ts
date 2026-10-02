import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { OsaClient } from '../../../packages/sdk/src/index.js';
const result = (data: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});
export function createMcp(client: OsaClient) {
  const server = new McpServer({
    name: 'osa-infrastructure',
    version: '0.1.0',
  });
  server.registerTool(
    'list_missions',
    {
      title: 'Lista misji OSA',
      description:
        'Odczytaj jedną stronę misji przypisanych do swojej tożsamości. Zwraca kursor następnej strony.',
      inputSchema: { cursor: z.string().optional() },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cursor }) =>
      result(
        (await client.listMissions(cursor)) as unknown as Record<
          string,
          unknown
        >,
      ),
  );
  server.registerTool(
    'get_mission',
    {
      title: 'Szczegóły misji OSA',
      description:
        'Odczytaj cel, stan i kroki jednej autoryzowanej misji. Nie wykonuje zmian.',
      inputSchema: { missionId: z.string().uuid() },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ missionId }) =>
      result(
        (await client.getMission(missionId)) as unknown as Record<
          string,
          unknown
        >,
      ),
  );
  server.registerTool(
    'draft_mission_plan',
    {
      title: 'Szkic planu misji',
      description:
        'Przygotuj strukturalny szkic planu bez zapisu, wykonania lub publikacji. Wymaga dopracowania do konkretnego projektu.',
      inputSchema: {
        goal: z.string().min(1).max(4000),
        context: z.string().max(6000).optional(),
        constraints: z.array(z.string()).max(20).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ goal, context, constraints }) =>
      result({
        goal,
        context: context || '',
        constraints: constraints || [],
        status: 'draft',
        steps: [
          { title: 'Odczytaj target i zbierz evidence', action: 'read' },
          { title: 'Przygotuj zmianę w zakresie celu', action: 'plan' },
          {
            title: 'Wykonaj tylko zatwierdzone działania',
            action: 'approval_required',
          },
          { title: 'Sprawdź rezultat i zapisz dowód', action: 'verify' },
        ],
        mutationsPerformed: false,
      }),
  );
  server.registerTool(
    'generate_prompt',
    {
      title: 'OSA Prompt God',
      description:
        'Zleć generowanie gotowego promptu do trwałej kolejki OSA. Zwraca wykonanie i jego status; nie uruchamia opisywanych w promptcie działań.',
      inputSchema: {
        goal: z.string().min(1).max(16000),
        missionId: z.string().uuid().optional(),
        idempotencyKey: z.string().max(160).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ goal, missionId, idempotencyKey }) =>
      result(
        (await client.enqueue(
          'prompt',
          { context: goal },
          idempotencyKey || randomUUID(),
          missionId,
        )) as unknown as Record<string, unknown>,
      ),
  );
  server.registerTool(
    'get_daily_report',
    {
      title: 'Raport OSA',
      description:
        'Odczytaj raport danych kernela, dowody, blokery i następne kroki. Zwraca zakres pokrycia; nie udaje niezależnej weryfikacji ukończenia.',
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ date }) =>
      result((await client.getReport(date)) as Record<string, unknown>),
  );
  server.registerResource(
    'architecture',
    'osa://architecture',
    { title: 'Kontrakty OSA', mimeType: 'text/plain' },
    async () => ({
      contents: [
        {
          uri: 'osa://architecture',
          text: 'OSA: Identity → Mission → Execution → Evidence. Zgody są związane z digestem payloadu. API jest wspólne dla Control Room, SDK i MCP. CLAIM != PROOF.',
        },
      ],
    }),
  );
  return server;
}
