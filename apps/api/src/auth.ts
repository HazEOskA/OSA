import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type {
  Entity,
  Identity,
} from '../../../packages/kernel/src/contracts.js';
import { OsaError } from '../../../packages/kernel/src/contracts.js';
import type { Store } from '../../../packages/store/src/store.js';
interface Session extends Entity {
  identity: Identity;
  tokenHash: string;
  expiresAt: number;
  csrf: string;
  revoked: boolean;
}
export interface IdentityConfig extends Identity {
  tokenHash: string;
}
export class Auth {
  constructor(
    private store: Store,
    private identities: IdentityConfig[],
    private now = () => Date.now(),
  ) {
    if (
      !identities.length ||
      identities.some(
        (i) =>
          !i.tenantId ||
          !i.subject ||
          !['owner', 'builder', 'reader'].includes(i.role) ||
          !/^[a-f0-9]{64}$/.test(i.tokenHash),
      )
    )
      throw new Error(
        'OSA_IDENTITIES_JSON wymaga poprawnych tożsamości i SHA-256 tokenów. Uruchom npm run setup.',
      );
  }
  token(raw: string): Identity | undefined {
    const hash = createHash('sha256').update(raw).digest();
    let identity: Identity | undefined;
    for (const config of this.identities) {
      if (timingSafeEqual(hash, Buffer.from(config.tokenHash, 'hex')))
        identity = {
          tenantId: config.tenantId,
          subject: config.subject,
          role: config.role,
        };
    }
    return identity;
  }
  async login(raw: string) {
    const identity = this.token(raw);
    if (!identity)
      throw new OsaError('UNAUTHORIZED', 'Nieprawidłowy token dostępu.', 401);
    const key = randomBytes(32).toString('base64url'),
      session: Session = {
        id: createHash('sha256').update(key).digest('hex'),
        tenantId: '__auth__',
        createdAt: new Date(this.now()).toISOString(),
        version: 0,
        identity,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: this.now() + 8 * 3600000,
        csrf: randomBytes(24).toString('base64url'),
        revoked: false,
      };
    await this.store.transaction((tx) => tx.put('session', session, 0));
    return { key, session };
  }
  async resolve(req: IncomingMessage) {
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (bearer) {
      const identity = this.token(bearer);
      if (!identity)
        throw new OsaError('UNAUTHORIZED', 'Nieprawidłowy token.', 401);
      return { identity, session: undefined };
    }
    const key = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('osa_session='))
      ?.slice('osa_session='.length);
    if (!key) throw new OsaError('UNAUTHORIZED', 'Zaloguj się do OSA.', 401);
    const session = await this.store.read((tx) =>
      tx.get<Session>(
        '__auth__',
        'session',
        createHash('sha256').update(key).digest('hex'),
      ),
    );
    if (!session || session.revoked || session.expiresAt <= this.now())
      throw new OsaError(
        'UNAUTHORIZED',
        'Sesja wygasła. Zaloguj się ponownie.',
        401,
      );
    // Re-read identity policy so revoked tokens / changed roles apply to sessions immediately.
    const configured = this.identities.find(
      (i) =>
        i.tenantId === session.identity.tenantId &&
        i.subject === session.identity.subject &&
        i.tokenHash === session.tokenHash,
    );
    if (!configured)
      throw new OsaError('UNAUTHORIZED', 'Tożsamość została wyłączona.', 401);
    return {
      identity: {
        tenantId: configured.tenantId,
        subject: configured.subject,
        role: configured.role,
      } as Identity,
      session,
    };
  }
  async logout(session: Session | undefined) {
    if (session)
      await this.store.transaction(async (tx) => {
        const s = await tx.get<Session>('__auth__', 'session', session.id);
        if (s && !s.revoked)
          await tx.put('session', { ...s, revoked: true }, s.version);
      });
  }
}
