import React from 'react';
import { SelectInput, useDataProvider } from 'react-admin';
import type { DataProvider, Identifier, SelectInputProps } from 'react-admin';
import type { ResourceRecord } from '../types/resource';

interface SelectDeviceServiceProps extends SelectInputProps {
  device?: Identifier;
}

interface ServiceOption {
  id: Identifier;
  name: string;
  disabled?: boolean;
}

export const SelectDeviceService: React.FC<SelectDeviceServiceProps> = ({ device, ...rest }) => {
  const [isLoading, setIsLoading] = React.useState(true);
  const [availableServices, setAvailableServices] = React.useState<ServiceOption[]>([]);
  const dataProvider = useDataProvider<DataProvider>();

  React.useEffect(() => {
    if (!device) {
      setAvailableServices([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const fetchServices = async () => {
      try {
        const serviceInstalls = await dataProvider.getList<ResourceRecord>('service install', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { device },
        });

        const serviceOptions: ServiceOption[] = [];

        for (const serviceInstall of serviceInstalls.data) {
          const services = await dataProvider.getList<ResourceRecord>('service', {
            pagination: { page: 1, perPage: 1000 },
            sort: { field: 'id', order: 'ASC' },
            filter: { id: serviceInstall['installs-service'] },
          });

          const serviceRecord = services.data[0];
          if (!serviceRecord) {
            continue;
          }

          const applications = await dataProvider.getList<ResourceRecord>('application', {
            pagination: { page: 1, perPage: 1000 },
            sort: { field: 'id', order: 'ASC' },
            filter: { id: serviceRecord.application },
          });

          const applicationRecord = applications.data[0];
          const serviceName = serviceRecord['service name'];
          const appName = applicationRecord?.['app name'];

          serviceOptions.push({
            id: serviceInstall.id,
            name: `${appName ?? 'Unknown'}: ${serviceName ?? 'Unknown'}`,
          });
        }

        setAvailableServices(serviceOptions);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchServices();
  }, [dataProvider, device]);

  if (isLoading) {
    return null;
  }

  const choices = availableServices.length
    ? availableServices
    : [{ id: 0, name: '(No services installed)', disabled: true }];

  return <SelectInput choices={choices} {...rest} />;
};

export default SelectDeviceService;
