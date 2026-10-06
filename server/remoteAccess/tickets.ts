import { createHash, randomBytes } from 'node:crypto';
import type { RemoteIdentity } from './auth';

export interface RemoteTicket {
  identity: RemoteIdentity;
  deviceUuid: string;
  origin: string;
  expiresAt: number;
}

export class TicketLimitError extends Error {
  public constructor() {
    super('Too many pending terminal tickets. Connect or wait for existing tickets to expire.');
    this.name = 'TicketLimitError';
  }
}

export class TicketStore {
  private readonly tickets = new Map<string, RemoteTicket>();
  private readonly ticketsByUser = new Map<number, number>();
  private timer?: NodeJS.Timeout;
  private readonly maxPerUser: number;
  private readonly maxTotal: number;

  public constructor(
    private readonly ttlMs: number,
    limits: { maxPerUser?: number; maxTotal?: number } = {},
  ) {
    this.maxPerUser = limits.maxPerUser ?? 8;
    this.maxTotal = limits.maxTotal ?? 1024;
    if (![ttlMs, this.maxPerUser, this.maxTotal].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Ticket lifetime and pending ticket limits must be positive safe integers.');
    }
  }

  public get size(): number {
    return this.tickets.size;
  }

  public issue(identity: RemoteIdentity, deviceUuid: string, origin: string): { ticket: string; expiresAt: number } {
    this.prune();
    const userTickets = this.ticketsByUser.get(identity.userId) ?? 0;
    if (userTickets >= this.maxPerUser || this.tickets.size >= this.maxTotal) throw new TicketLimitError();
    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.ttlMs;
    this.tickets.set(this.digest(ticket), { identity, deviceUuid, origin, expiresAt });
    this.ticketsByUser.set(identity.userId, userTickets + 1);
    this.schedulePrune();
    return { ticket, expiresAt };
  }

  public consume(ticket: string, origin: string): RemoteTicket | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return undefined;
    const key = this.digest(ticket);
    const value = this.tickets.get(key);
    if (value) this.remove(key, value);
    if (!value || value.expiresAt <= Date.now() || value.origin !== origin) return undefined;
    return value;
  }

  public clear(): void {
    this.tickets.clear();
    this.ticketsByUser.clear();
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, value] of this.tickets) if (value.expiresAt <= now) this.remove(key, value);
  }

  private remove(key: string, value: RemoteTicket): void {
    this.tickets.delete(key);
    const remaining = (this.ticketsByUser.get(value.identity.userId) ?? 1) - 1;
    if (remaining > 0) this.ticketsByUser.set(value.identity.userId, remaining);
    else this.ticketsByUser.delete(value.identity.userId);
    if (!this.tickets.size) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private schedulePrune(): void {
    if (this.timer || !this.tickets.size) return;
    let expiresAt = Infinity;
    for (const value of this.tickets.values()) expiresAt = Math.min(expiresAt, value.expiresAt);
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.prune();
        this.schedulePrune();
      },
      Math.min(2_147_483_647, Math.max(1, expiresAt - Date.now())),
    );
    this.timer.unref();
  }

  private digest(ticket: string): string {
    return createHash('sha256').update(ticket).digest('base64url');
  }
}
