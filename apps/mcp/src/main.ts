import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OsaClient } from '../../../packages/sdk/src/index.js';
import { createMcp } from './server.js';
if (!process.env.OSA_MCP_TOKEN)
  throw new Error(
    'OSA_MCP_TOKEN jest wymagany; nie wpisuj go do kodu ani czatu.',
  );
const server = createMcp(
  new OsaClient(
    process.env.OSA_MCP_URL || 'http://127.0.0.1:3000',
    process.env.OSA_MCP_TOKEN,
  ),
);
await server.connect(new StdioServerTransport());
