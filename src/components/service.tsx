import * as React from 'react';
import { Datagrid, List, ReferenceField, SearchInput, TextField } from 'react-admin';

const searchFilters = [<SearchInput key='search' source='service name@ilike' alwaysOn />];

export const ServiceList: React.FC = () => {
  return (
    <List filters={searchFilters}>
      <Datagrid size='medium' bulkActionButtons={false} rowClick={false}>
        <TextField source='id' />
        <TextField label='Name' source='service name' />
        <ReferenceField label='Fleet' source='application' reference='application'>
          <TextField source='app name' />
        </ReferenceField>
      </Datagrid>
    </List>
  );
};

const service = {
  list: ServiceList,
};

export default service;
