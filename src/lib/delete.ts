import type { Identifier, RaRecord } from 'react-admin';

const PAGE_SIZE = 1000;

interface RelatedDataProvider {
  getList(
    resource: string,
    params: {
      pagination: { page: number; perPage: number };
      sort: { field: string; order: 'ASC' | 'DESC' };
      filter: Record<string, unknown>;
    },
  ): Promise<{ data: RaRecord[]; total?: number }>;
  deleteMany(resource: string, params: { ids: Identifier[] }): Promise<unknown>;
}

interface RelatedLookup {
  remoteResource: string;
  remoteField: string;
  localField: string;
  deleteFunction?: (record: RaRecord) => Promise<unknown>;
}

interface IndirectRelatedLookup extends RelatedLookup {
  viaRemoteField: string;
  viaResource: string;
  viaLocalField: string;
}

const listAllRelated = async (
  dataProvider: RelatedDataProvider,
  remoteResource: string,
  remoteField: string,
  localValue: unknown,
): Promise<RaRecord[]> => {
  const records: RaRecord[] = [];
  for (let page = 1; ; page += 1) {
    const result = await dataProvider.getList(remoteResource, {
      pagination: { page, perPage: PAGE_SIZE },
      sort: { field: 'id', order: 'ASC' },
      filter: { [remoteField]: localValue },
    });
    records.push(...result.data);
    if (result.data.length < PAGE_SIZE || (typeof result.total === 'number' && records.length >= result.total)) {
      return records;
    }
  }
};

const uniqueRecords = (records: RaRecord[]): RaRecord[] => {
  const byId = new Map<string, RaRecord>();
  for (const record of records) {
    if (record.id == null) {
      throw new Error('Related records must contain an id.');
    }
    byId.set(String(record.id), record);
  }
  return [...byId.values()];
};

const deleteRelatedRecords = async (
  dataProvider: RelatedDataProvider,
  lookup: RelatedLookup,
  records: RaRecord[],
): Promise<void> => {
  const unique = uniqueRecords(records);
  if (lookup.deleteFunction) {
    for (const record of unique) {
      await lookup.deleteFunction(record);
    }
    return;
  }
  for (let offset = 0; offset < unique.length; offset += PAGE_SIZE) {
    await dataProvider.deleteMany(lookup.remoteResource, {
      ids: unique.slice(offset, offset + PAGE_SIZE).map((record) => record.id),
    });
  }
};

export async function deleteAllRelated(
  dataProvider: RelatedDataProvider,
  localResource: Record<string, unknown>,
  relatedIndirectLookups: IndirectRelatedLookup[],
  relatedDirectLookups: RelatedLookup[],
): Promise<void> {
  for (const lookup of relatedIndirectLookups) {
    const viaMappings = await listAllRelated(
      dataProvider,
      lookup.viaResource,
      lookup.viaLocalField,
      localResource[lookup.localField],
    );
    const remoteRecords: RaRecord[] = [];
    for (const mapping of viaMappings) {
      remoteRecords.push(
        ...(await listAllRelated(
          dataProvider,
          lookup.remoteResource,
          lookup.remoteField,
          mapping[lookup.viaRemoteField],
        )),
      );
    }
    await deleteRelatedRecords(dataProvider, lookup, remoteRecords);
  }

  for (const lookup of relatedDirectLookups) {
    const records = await listAllRelated(
      dataProvider,
      lookup.remoteResource,
      lookup.remoteField,
      localResource[lookup.localField],
    );
    await deleteRelatedRecords(dataProvider, lookup, records);
  }
}
