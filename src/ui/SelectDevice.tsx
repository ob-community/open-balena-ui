import React from 'react';
import { AutocompleteInput, useDataProvider, useRecordContext } from 'react-admin';
import type { AutocompleteInputProps, DataProvider } from 'react-admin';
import type { ResourceRecord } from '../types/resource';

type SelectDeviceProps = AutocompleteInputProps;

export const SelectDevice: React.FC<SelectDeviceProps> = (props) => {
  const [isLoading, setIsLoading] = React.useState(true);
  const [availableDevices, setAvailableDevices] = React.useState<ResourceRecord[]>([]);
  const dataProvider = useDataProvider<DataProvider>();
  const record = useRecordContext<ResourceRecord>();

  React.useEffect(() => {
    if (!isLoading) {
      return;
    }

    const fetchDevices = async () => {
      try {
        const devices = await dataProvider.getList<ResourceRecord>('device', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'device name', order: 'ASC' },
          filter: {},
        });

        if (record?.['service install']) {
          const serviceInstall = await dataProvider.getOne<ResourceRecord>('service install', {
            id: record['service install'],
          });

          if (serviceInstall.data?.device) {
            (record as Record<string, unknown>).device = serviceInstall.data.device;
          }
        }

        setAvailableDevices(devices.data);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchDevices();
  }, [dataProvider, isLoading, record]);

  if (isLoading) {
    return null;
  }

  return (
    <AutocompleteInput
      choices={availableDevices}
      optionText='device name'
      optionValue='id'
      sx={{ mt: '8px', mb: '4px' }}
      {...props}
    />
  );
};

export default SelectDevice;
