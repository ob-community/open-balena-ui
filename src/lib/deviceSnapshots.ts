import type { ResourceRecord } from '../types/resource';

type DeviceSnapshot = { record: ResourceRecord; requestedAt: number; request: number };
const owners = new WeakMap<ResourceRecord, DeviceSnapshots>();

// A cached row may be applied long after its request resolved. Resolve it again
// against the same provider's list and row requests at the point of the write.
export const latestDeviceSnapshot = (record: ResourceRecord) => owners.get(record)?.get(record.id);

export class DeviceSnapshots {
  private request = 0;
  private snapshots = new Map<string, DeviceSnapshot>();

  begin() {
    return { request: ++this.request, requestedAt: Date.now() };
  }

  get(id: ResourceRecord['id']) {
    return this.snapshots.get(String(id));
  }

  reconcile<RecordType extends ResourceRecord>(
    records: RecordType[],
    request: { request: number; requestedAt: number },
  ): RecordType[] {
    return records.map((record) => {
      const previous = this.get(record.id);
      if (previous && previous.request > request.request) return previous.record as RecordType;
      this.snapshots.set(String(record.id), { record, ...request });
      owners.set(record, this);
      return record;
    });
  }
}
