import { createHash, randomBytes } from 'node:crypto';
import type { RemoteIdentity } from './auth';

export interface RemoteTicket {
  identity: RemoteIdentity;
  deviceUuid: string;
  origin: string;
  expiresAt: number;
}

export class TicketStore {
  private readonly tickets = new Map<string, RemoteTicket>();

  public constructor(private readonly ttlMs: number) {}

  public issue(identity: RemoteIdentity, deviceUuid: string, origin: string): { ticket: string; expiresAt: number } {
    this.prune();
    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.ttlMs;
    this.tickets.set(this.digest(ticket), { identity, deviceUuid, origin, expiresAt });
    return { ticket, expiresAt };
  }

  public consume(ticket: string, origin: string): RemoteTicket | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return undefined;
    const key = this.digest(ticket);
    const value = this.tickets.get(key);
    this.tickets.delete(key);
    if (!value || value.expiresAt < Date.now() || value.origin !== origin) return undefined;
    return value;
  }

  public clear(): void {
    this.tickets.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, value] of this.tickets) if (value.expiresAt < now) this.tickets.delete(key);
  }

  private digest(ticket: string): string {
    return createHash('sha256').update(ticket).digest('base64url');
  }
}
