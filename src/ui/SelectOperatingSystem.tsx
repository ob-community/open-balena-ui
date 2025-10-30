import React from 'react';
import { SelectInput, useDataProvider, useRecordContext } from 'react-admin';
import type { DataProvider, SelectInputProps } from 'react-admin';
import type { ResourceRecord } from '../types/resource';

interface OperatingSystemOption {
  id: number;
  name: string;
}

type SelectOperatingSystemProps = SelectInputProps;

export const SelectOperatingSystem: React.FC<SelectOperatingSystemProps> = (props) => {
  const record = useRecordContext<ResourceRecord>();
  const [isLoading, setIsLoading] = React.useState(true);
  const [availableOperatingSystems, setAvailableOperatingSystems] = React.useState<OperatingSystemOption[]>([]);
  const dataProvider = useDataProvider<DataProvider>();

  React.useEffect(() => {
    if (!record) {
      setIsLoading(false);
      setAvailableOperatingSystems([]);
      return;
    }

    setIsLoading(true);

    const fetchOperatingSystems = async () => {
      try {
        const operatingSystems = await dataProvider.getList<ResourceRecord>('application', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { 'is of-class': 'app', 'is host': 1, 'is for-device type': record['is of-device type'] },
        });

        const options: OperatingSystemOption[] = [];

        for (const operatingSystem of operatingSystems.data) {
          const releases = await dataProvider.getList<ResourceRecord>('release', {
            pagination: { page: 1, perPage: 1000 },
            sort: { field: 'id', order: 'ASC' },
            filter: { 'belongs to-application': operatingSystem.id },
          });

          for (const operatingSystemRelease of releases.data) {
            const releaseTags = await dataProvider.getList<ResourceRecord>('release tag', {
              pagination: { page: 1, perPage: 1000 },
              sort: { field: 'id', order: 'ASC' },
              filter: { 'release': operatingSystemRelease.id, 'tag key': 'version' },
            });

            const versionTag = releaseTags.data[0]?.value;
            if (versionTag) {
              const releaseId =
                typeof operatingSystemRelease.id === 'number'
                  ? operatingSystemRelease.id
                  : Number(operatingSystemRelease.id);

              if (!Number.isNaN(releaseId)) {
                options.push({
                  id: releaseId,
                  name: versionTag,
                });
              }
            }
          }
        }

        setAvailableOperatingSystems(options);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchOperatingSystems();
  }, [dataProvider, record]);

  if (isLoading) {
    return null;
  }

  return <SelectInput choices={availableOperatingSystems} {...props} />;
};

export default SelectOperatingSystem;
