import { randomBytes } from 'node:crypto';
import sshKey from 'micro-key-producer/ssh.js';
import type { RemoteIdentity } from './auth';

interface KeyEntry {
  privateKey: string;
  publicKey: string;
  recordId: number;
  token: string;
  refs: number;
  timer?: NodeJS.Timeout;
}

export interface KeyLease {
  privateKey: string;
  release(): void;
}

export const generateEd25519SshKey = (): { privateKey: string; publicKey: string } => {
  const { privateKey, publicKey } = sshKey(randomBytes(32), 'open-balena-ui');
  return { privateKey, publicKey };
};

export class UserSshKeyManager {
  private readonly entries = new Map<number, Promise<KeyEntry>>();
  private readonly titlePrefix = 'open-balena-ui-ephemeral';
  private shuttingDown = false;

  public constructor(
    private readonly postgrestUrl: string,
    private readonly idleTtlMs: number,
  ) {}

  public async acquire(identity: RemoteIdentity): Promise<KeyLease> {
    if (this.shuttingDown) throw new Error('Remote access is shutting down.');
    let pending = this.entries.get(identity.userId);
    if (!pending) {
      pending = this.create(identity);
      this.entries.set(identity.userId, pending);
      pending.catch(() => this.entries.delete(identity.userId));
    }
    const entry = await pending;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.token = identity.token;
    entry.refs += 1;
    let released = false;
    return {
      privateKey: entry.privateKey,
      release: () => {
        if (released) return;
        released = true;
        entry.refs = Math.max(0, entry.refs - 1);
        if (entry.refs === 0) {
          this.scheduleRemoval(identity.userId, entry, this.idleTtlMs);
        }
      },
    };
  }

  public async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const entries = await Promise.allSettled(this.entries.values());
    const removals = await Promise.allSettled(
      entries.flatMap((result) => (result.status === 'fulfilled' ? [this.deleteRecord(result.value)] : [])),
    );
    for (const removal of removals) {
      if (removal.status === 'rejected') {
        console.error('Unable to remove an ephemeral SSH key during shutdown:', removal.reason);
      }
    }
    this.entries.clear();
  }

  private async create(identity: RemoteIdentity): Promise<KeyEntry> {
    await this.cleanupOrphans(identity);
    const key = generateEd25519SshKey();
    const response = await fetch(`${this.postgrestUrl}/${encodeURIComponent('user-has-public key')}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${identity.token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        'user': identity.userId,
        'title': `${this.titlePrefix}-${Date.now()}-${randomBytes(8).toString('hex')}`,
        'public key': key.publicKey,
      }),
    });
    if (!response.ok) throw new Error('Unable to register the temporary SSH key.');
    const body = (await response.json()) as unknown;
    const record = Array.isArray(body) ? body[0] : body;
    const recordId = Number(record && typeof record === 'object' ? (record as Record<string, unknown>).id : undefined);
    if (!Number.isSafeInteger(recordId) || recordId <= 0)
      throw new Error('SSH key registration returned no identifier.');
    return { ...key, recordId, token: identity.token, refs: 0 };
  }

  private async remove(userId: number, entry: KeyEntry): Promise<void> {
    if (entry.refs !== 0) return;
    const current = this.entries.get(userId);
    if (!current || (await current) !== entry) return;
    try {
      await this.deleteRecord(entry);
      this.entries.delete(userId);
    } catch (error) {
      console.error('Unable to remove an idle ephemeral SSH key; cleanup will be retried:', error);
      this.scheduleRemoval(userId, entry, Math.min(Math.max(this.idleTtlMs, 1_000), 60_000));
    }
  }

  private scheduleRemoval(userId: number, entry: KeyEntry, delay: number): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.remove(userId, entry), delay);
    entry.timer.unref();
  }

  private async cleanupOrphans(identity: RemoteIdentity): Promise<void> {
    const query = new URLSearchParams({
      user: `eq.${identity.userId}`,
      title: `like.${this.titlePrefix}-*`,
      select: 'id,title',
    });
    const authorization = ['Bearer', identity.token].join(' ');
    const response = await fetch(
      `${this.postgrestUrl}/${encodeURIComponent('user-has-public key')}?${query.toString()}`,
      { headers: { Authorization: authorization, Accept: 'application/json' } },
    );
    if (!response.ok) throw new Error('Unable to inspect previous temporary SSH keys.');
    const records = (await response.json()) as Array<Record<string, unknown>>;
    const cutoff = Date.now() - Math.max(this.idleTtlMs * 2, 60 * 60 * 1000);
    for (const record of records) {
      const id = Number(record.id);
      const title = typeof record.title === 'string' ? record.title : '';
      const createdAt = Number(title.split('-')[4]);
      if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(createdAt) || createdAt > cutoff) continue;
      const deleteQuery = new URLSearchParams({ id: `eq.${id}`, user: `eq.${identity.userId}` });
      const deletion = await fetch(
        `${this.postgrestUrl}/${encodeURIComponent('user-has-public key')}?${deleteQuery.toString()}`,
        {
          method: 'DELETE',
          headers: { Authorization: authorization, Prefer: 'return=minimal' },
        },
      );
      if (!deletion.ok && deletion.status !== 404) {
        throw new Error('Unable to remove a previous temporary SSH key.');
      }
    }
  }

  private async deleteRecord(entry: KeyEntry): Promise<void> {
    if (entry.timer) clearTimeout(entry.timer);
    const query = new URLSearchParams({ id: `eq.${entry.recordId}` });
    const response = await fetch(
      `${this.postgrestUrl}/${encodeURIComponent('user-has-public key')}?${query.toString()}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${entry.token}`, Prefer: 'return=minimal' } },
    );
    if (!response.ok && response.status !== 404) throw new Error('Unable to remove the temporary SSH key.');
  }
}
