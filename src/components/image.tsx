import dateFormat from 'dateformat';
import * as React from 'react';
import {
  Datagrid,
  FunctionField,
  List,
  ReferenceField,
  ReferenceManyField,
  SingleFieldList,
  TextField,
} from 'react-admin';
import SemVerChip from '../ui/SemVerChip';

export const ImageList: React.FC = () => {
  return (
    <List>
      <Datagrid bulkActionButtons={false} rowClick={false} size='medium'>
        <TextField label='ID' source='id' />

        <ReferenceField label='Service' source='is a build of-service' reference='service'>
          <TextField source='service name' />
        </ReferenceField>

        <ReferenceManyField
          label='Release Rev.'
          source='id'
          reference='image-is part of-release'
          target='image'
        >
          <SingleFieldList linkType={false}>
            <ReferenceField
              source='is part of-release'
              reference='release'
              link={(record, reference) => `/${reference}/${record['is part of-release']}`}
            >
              <SemVerChip />
            </ReferenceField>
          </SingleFieldList>
        </ReferenceManyField>

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
