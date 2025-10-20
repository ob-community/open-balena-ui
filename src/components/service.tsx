import * as React from 'react';
import { Datagrid, List, ReferenceField, TextField } from 'react-admin';

export const ServiceList = () => {
  return (
    <List>
      <Datagrid size='medium' bulkActionButtons={false} rowClick={false}>
        <TextField source='id' />
        <TextField label='Name' source='service name' />
        <ReferenceField label='Fleet' source='application' reference='application' target='id'>
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
