import type {
  Mission,
  Run,
  Evidence,
  Page,
} from '../../kernel/src/contracts.js';
export class OsaClient {
  constructor(
    readonly baseUrl: string,
    private token: string,
  ) {}
  async request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await fetch(this.baseUrl.replace(/\/$/, '') + path, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + this.token,
        'Content-Type': 'application/json',
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(30000),
    });
    const data = (await response.json()) as T & {
      error?: { code: string; message: string };
    };
    if (!response.ok)
      throw new Error(data.error?.code + ': ' + data.error?.message);
    return data;
  }
  listMissions(cursor?: string) {
    return this.request<Page<Mission>>(
      '/api/missions' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
    );
  }
  getMission(id: string) {
    return this.request<Mission>('/api/missions/' + encodeURIComponent(id));
  }
  createMission(title: string, description = '') {
    return this.request<Mission>('/api/missions', {
      method: 'POST',
      body: { title, description },
    });
  }
  enqueue(
    engine: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
    missionId?: string,
  ) {
    return this.request<Run>('/api/runs', {
      method: 'POST',
      body: { engine, input, idempotencyKey, missionId },
    });
  }
  getRun(id: string) {
    return this.request<Run>('/api/runs/' + encodeURIComponent(id));
  }
  cancelRun(id: string) {
    return this.request<Run>(
      '/api/runs/' + encodeURIComponent(id) + '/cancel',
      { method: 'POST', body: {} },
    );
  }
  verifyEvidence(id: string) {
    return this.request<{
      evidence: Evidence;
      integrity: boolean;
      binding: boolean;
      executionVerified: boolean;
    }>('/api/evidence/' + encodeURIComponent(id) + '/verify');
  }
  getReport(date?: string) {
    return this.request(
      '/api/report' + (date ? '?date=' + encodeURIComponent(date) : ''),
    );
  }
}
