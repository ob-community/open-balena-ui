export async function deleteAllRelated(dataProvider, localResource, relatedIndirectLookups, relatedDirectLookups) {
  await Promise.all(
    relatedIndirectLookups.map((x) => {
      return dataProvider
        .getList(x.viaResource, {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { [x.viaLocalField]: localResource[x.localField] },
        })
        .then((existingIndirectMappings) => {
          return Promise.all(
            existingIndirectMappings.data.map((y) => {
              return dataProvider
                .getList(x.remoteResource, {
                  pagination: { page: 1, perPage: 1000 },
                  sort: { field: 'id', order: 'ASC' },
                  filter: { [x.remoteField]: y[x.viaRemoteField] },
                })
                .then((existingMappings) => {
                  if (existingMappings.data.length > 0) {
                    return x.deleteFunction
                      ? Promise.all(existingMappings.data.map((z) => x.deleteFunction(z)))
                      : dataProvider.deleteMany(x.remoteResource, { ids: existingMappings.data.map((z) => z.id) });
                  }
                });
            }),
          );
        });
    }),
  );
  await Promise.all(
    relatedDirectLookups.map((x) => {
      return dataProvider
        .getList(x.remoteResource, {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { [x.remoteField]: localResource[x.localField] },
        })
        .then((existingMappings) => {
          if (existingMappings.data.length > 0) {
            dataProvider.deleteMany(x.remoteResource, { ids: existingMappings.data.map((y) => y.id) });
          }
        });
    }),
  );
}
