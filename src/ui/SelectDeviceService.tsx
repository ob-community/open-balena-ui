import React from 'react';
import { SelectInput, useDataProvider } from 'react-admin';

export const SelectDeviceService = (props) => {
  const [loaded, setLoaded] = React.useState(null);
  const [availableServices, setAvailableServices] = React.useState([]);
  const dataProvider = useDataProvider();

  React.useEffect(() => {
    if (!props.device) {
      return;
    }

    if (loaded === null) {
      setLoaded(false);
      dataProvider
        .getList('service install', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { device: props.device },
        })
        .then((serviceInstalls) => {
          var serviceOpts = [];
          Promise.all(
            serviceInstalls.data.map((serviceInstall) =>
              dataProvider
                .getList('service', {
                  pagination: { page: 1, perPage: 1000 },
                  sort: { field: 'id', order: 'ASC' },
                  filter: { id: serviceInstall['installs-service'] },
                })
                .then((services) =>
                  dataProvider
                    .getList('application', {
                      pagination: { page: 1, perPage: 1000 },
                      sort: { field: 'id', order: 'ASC' },
                      filter: { id: services.data[0].application },
                    })
                    .then((applications) => {
                      serviceOpts.push({
                        name: `${applications.data[0]['app name']}: ${services.data[0]['service name']}`,
                        id: serviceInstall.id,
                      });
                    }),
                ),
            ),
          ).then(() => {
            setAvailableServices(serviceOpts);
            setLoaded(true);
          });
        });
    }
  }, [props, dataProvider, loaded, setLoaded, availableServices, setAvailableServices]);

  if (!loaded) return null;

  if (availableServices.length === 0) {
    availableServices.push({ id: 0, name: '(No services installed)', disabled: true });
  }

  return <SelectInput choices={availableServices} {...props} />;
};

export default SelectDeviceService;
