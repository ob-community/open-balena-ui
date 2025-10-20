import dateFormat from 'dateformat';
import * as React from 'react';
import { Datagrid, FunctionField, List, ReferenceField, TextField } from 'react-admin';
import SemVerChip from '../ui/SemVerChip';

export const ImageList = () => {
  return (
    <List>
      <Datagrid bulkActionButtons={false} rowClick={false} size='medium'>
        <TextField label='ID' source='id' />

        <ReferenceField label='Service' source='is a build of-service' reference='service' target='id'>
          <TextField source='service name' />
        </ReferenceField>

        <ReferenceField
          label='Release Rev.'
          source='id'
          reference='image-is part of-release'
          target='image'
          link={false}
        >
          <ReferenceField
            source='is part of-release'
            reference='release'
            target='id'
            link={(record, reference) => `/${reference}/${record['is part of-release']}`}
          >
            <SemVerChip />
          </ReferenceField>
        </ReferenceField>

        <FunctionField
          label='Size'
          render={(record) => `${Math.round((record['image size'] / 1000000) * 10) / 10}mb`}
        />

        <TextField label='Status' source='status' />

        <FunctionField label='Push Date' render={(record) => `${dateFormat(new Date(record['push timestamp']))}`} />
      </Datagrid>
    </List>
  );
};

const image = {
  list: ImageList,
};

export default image;
