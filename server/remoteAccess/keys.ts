import { randomBytes } from 'node:crypto';
import sshKey from 'micro-key-producer/ssh.js';
import type { RemoteIdentity } from './auth';

interface KeyEntry {
  privateKey: string;
  publicKey: string;
  recordId: number;
  token: string;
  refs: number;
  removing?: boolean;
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
  private readonly entries = new Map<number, KeyEntry>();
  private readonly operations = new Map<number, Promise<void>>();
  private readonly titlePrefix = 'open-balena-ui-ephemeral';
  private shuttingDown = false;
  private shutdownPromise?: Promise<void>;

  public constructor(
    private readonly postgrestUrl: string,
    private readonly idleTtlMs: number,
    private readonly connectTimeoutMs = 15_000,
  ) {}

  public async acquire(identity: RemoteIdentity, signal?: AbortSignal): Promise<KeyLease> {
    if (signal?.aborted) throw new Error('Remote key acquisition aborted.');
    if (this.shuttingDown) throw new Error('Remote access is shutting down.');
    const acquisition = this.serialize(identity.userId, async () => {
      if (signal?.aborted) throw new Error('Remote key acquisition aborted.');
      if (this.shuttingDown) throw new Error('Remote access is shutting down.');
      let entry = this.entries.get(identity.userId);
      if (entry?.removing) {
        // A failed DELETE may have reached the API: never lease that key again.
        entry.token = identity.token;
        try {
          await this.deleteRecord(entry);
        } catch (error) {
          if (!this.shuttingDown) {
            this.scheduleRemoval(identity.userId, entry, Math.min(Math.max(this.idleTtlMs, 1_000), 60_000));
          }
          throw error;
        }
        this.entries.delete(identity.userId);
        entry = undefined;
      }
      if (!entry) {
        entry = await this.create(identity);
        this.entries.set(identity.userId, entry);
      }
      if (this.shuttingDown) throw new Error('Remote access is shutting down.');
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.token = identity.token;
      entry.refs += 1;
      const leasedEntry = entry;
      let released = false;
      return {
        privateKey: entry.privateKey,
        release: () => {
          if (released) return;
          released = true;
          leasedEntry.refs = Math.max(0, leasedEntry.refs - 1);
          if (leasedEntry.refs === 0 && !this.shuttingDown) {
            this.scheduleRemoval(identity.userId, leasedEntry, this.idleTtlMs);
          }
        },
      };
    });
    return new Promise<KeyLease>((resolve, reject) => {
      const abort = (): void => reject(new Error('Remote key acquisition aborted.'));
      signal?.addEventListener('abort', abort, { once: true });
      void acquisition.then(
        (lease) => {
          signal?.removeEventListener('abort', abort);
          if (signal?.aborted) {
            // Registration is shared work; cancellation only relinquishes this caller's reference.
            lease.release();
            abort();
          } else resolve(lease);
        },
        (error: unknown) => {
          signal?.removeEventListener('abort', abort);
          reject(error);
        },
      );
      if (signal?.aborted) abort();
    });
  }

  public shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    const userIds = new Set([...this.entries.keys(), ...this.operations.keys()]);
    this.shutdownPromise = (async () => {
      const removals = await Promise.allSettled(
        [...userIds].map((userId) =>
          this.serialize(userId, async () => {
            const entry = this.entries.get(userId);
            if (entry) await this.deleteRecord(entry);
          }),
        ),
      );
      for (const removal of removals) {
        if (removal.status === 'rejected') {
          console.error('Unable to remove an ephemeral SSH key during shutdown:', removal.reason);
        }
      }
      this.entries.clear();
    })();
    return this.shutdownPromise;
  }

  private serialize<T>(userId: number, operation: () => Promise<T>): Promise<T> {
    const result = (this.operations.get(userId) ?? Promise.resolve()).then(operation);
    const completion = result.then(
      () => {},
      () => {},
    );
    this.operations.set(userId, completion);
    void completion.then(() => {
      if (this.operations.get(userId) === completion) this.operations.delete(userId);
    });
    return result;
  }

  private async create(identity: RemoteIdentity): Promise<KeyEntry> {
    await this.cleanupOrphans(identity);
    const key = generateEd25519SshKey();
    const body = await this.request(
      `${this.postgrestUrl}/${encodeURIComponent('user-has-public key')}`,
      {
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
      },
      async (response) => {
        if (!response.ok) {
          await response.arrayBuffer();
          throw new Error('Unable to register the temporary SSH key.');
        }
        return response.json() as Promise<unknown>;
      },
    );
    const record = Array.isArray(body) ? body[0] : body;
    const recordId = Number(record && typeof record === 'object' ? (record as Record<string, unknown>).id : undefined);
    if (!Number.isSafeInteger(recordId) || recordId <= 0)
      throw new Error('SSH key registration returned no identifier.');
    return { ...key, recordId, token: identity.token, refs: 0 };
  }

  private async remove(userId: number, entry: KeyEntry): Promise<void> {
    await this.serialize(userId, async () => {
      if (this.shuttingDown || entry.refs !== 0 || this.entries.get(userId) !== entry) return;
      entry.removing = true;
      try {
        await this.deleteRecord(entry);
        this.entries.delete(userId);
      } catch (error) {
        console.error('Unable to remove an idle ephemeral SSH key; cleanup will be retried:', error);
        if (!this.shuttingDown) {
          this.scheduleRemoval(userId, entry, Math.min(Math.max(this.idleTtlMs, 1_000), 60_000));
        }
      }
    });
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
    const records = await this.request(
      `${this.postgrestUrl}/${encodeURIComponent('user-has-public key')}?${query.toString()}`,
      { headers: { Authorization: authorization, Accept: 'application/json' } },
      async (response) => {
        if (!response.ok) {
          await response.arrayBuffer();
          throw new Error('Unable to inspect previous temporary SSH keys.');
        }
        return response.json() as Promise<Array<Record<string, unknown>>>;
      },
    );
    const cutoff = Date.now() - Math.max(this.idleTtlMs * 2, 60 * 60 * 1000);
    for (const record of records) {
      const id = Number(record.id);
      const title = typeof record.title === 'string' ? record.title : '';
      const createdAt = Number(title.split('-')[4]);
      if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(createdAt) || createdAt > cutoff) continue;
      const deleteQuery = new URLSearchParams({ id: `eq.${id}`, user: `eq.${identity.userId}` });
      await this.request(
        `${this.postgrestUrl}/${encodeURIComponent('user-has-public key')}?${deleteQuery.toString()}`,
        {
          method: 'DELETE',
          headers: { Authorization: authorization, Prefer: 'return=minimal' },
        },
        async (response) => {
          await response.arrayBuffer();
          if (!response.ok && response.status !== 404) {
            throw new Error('Unable to remove a previous temporary SSH key.');
          }
        },
      );
    }
  }

  private async deleteRecord(entry: KeyEntry): Promise<void> {
    if (entry.timer) clearTimeout(entry.timer);
    const query = new URLSearchParams({ id: `eq.${entry.recordId}` });
    await this.request(
      `${this.postgrestUrl}/${encodeURIComponent('user-has-public key')}?${query.toString()}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${entry.token}`, Prefer: 'return=minimal' } },
      async (response) => {
        await response.arrayBuffer();
        if (!response.ok && response.status !== 404) throw new Error('Unable to remove the temporary SSH key.');
      },
    );
  }

  private async request<T>(url: string, options: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error('Temporary SSH key HTTP operation timed out.');
        reject(error);
        controller.abort(error);
      }, this.connectTimeoutMs);
    });
    try {
      return await Promise.race([fetch(url, { ...options, signal: controller.signal }).then(consume), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}
