import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SqliteStore } from '../packages/store/src/sqlite.js';
import { Kernel } from '../packages/kernel/src/service.js';
import { createApi } from '../apps/api/src/server.js';
import { OsaClient } from '../packages/sdk/src/index.js';
import { createMcp } from '../apps/mcp/src/server.js';
test('official MCP client negotiates server and calls tenant-scoped tools through real HTTP', async () => {
  const token = 'mcp-fixture',
    store = new SqliteStore(':memory:'),
    kernel = new Kernel(store);
  const api = createApi(kernel, {
    publicUrl: 'http://127.0.0.1:3000',
    identities: [
      {
        tenantId: 'mcp-tenant',
        subject: 'mcp-user',
        role: 'owner',
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
    ],
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const address = api.address();
  if (!address || typeof address === 'string') throw Error('address');
  const http = new OsaClient('http://127.0.0.1:' + address.port, token);
  const mission = await http.createMission('MCP mission');
  const mcp = createMcp(http),
    client = new Client({ name: 'osa-test-client', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([mcp.connect(a), client.connect(b)]);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 5);
    assert.ok(tools.tools.every((t) => t.description));
    const list = await client.callTool({
      name: 'list_missions',
      arguments: {},
    });
    assert.match(JSON.stringify(list), /MCP mission/);
    const detail = await client.callTool({
      name: 'get_mission',
      arguments: { missionId: mission.id },
    });
    assert.match(JSON.stringify(detail), /MCP mission/);
    const plan = await client.callTool({
      name: 'draft_mission_plan',
      arguments: { goal: 'Read this function' },
    });
    assert.match(JSON.stringify(plan), /mutationsPerformed/);
    const run = await client.callTool({
      name: 'generate_prompt',
      arguments: { goal: 'Review safely', idempotencyKey: 'mcp-prompt' },
    });
    assert.match(JSON.stringify(run), /queued/);
    const report = await client.callTool({
      name: 'get_daily_report',
      arguments: {},
    });
    assert.match(JSON.stringify(report), /coverage/);
  } finally {
    await client.close();
    await mcp.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await store.close();
  }
});
