import * as React from 'react';
import {
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  FunctionField,
  List,
  ReferenceField,
  ReferenceInput,
  SelectInput,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
  required,
  useShowContext,
} from 'react-admin';
import type { ListProps } from 'react-admin';
import CopyChip from '../ui/CopyChip';
import Row from '../ui/Row';

export const DeviceTagList = () => {
  let listProps: Partial<ListProps> = {
    title: 'Device Tags',
  };

  try {
    const showContext = useShowContext();
    if (showContext?.record?.id != null) {
      listProps = {
        ...listProps,
        resource: 'device tag',
        filter: { device: showContext.record.id },
      };
    }
  } catch (error) {}

  return (
    <List {...listProps}>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='Device' source='device' reference='device' target='id'>
          <TextField source='device name' />
        </ReferenceField>

        <TextField label='Name' source='tag key' />

        <FunctionField
          label='Value'
          render={(record: { value?: string }) => {
            const value = record.value ?? '';
            const truncated = value.length > 40 ? `${value.slice(0, 40)}...` : value;

            return <CopyChip title={value} label={truncated} />;
          }}
        />

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='optimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const DeviceTagCreate: React.FC = () => (
  <Create title='Create Device Tag' redirect='list'>
    <SimpleForm>
      <ReferenceInput
        source='device'
        reference='device'
        target='id'
        perPage={1000}
        sort={{ field: 'device name', order: 'ASC' }}
      >
        <SelectInput optionText='device name' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <Row>
        <TextInput label='Name' source='tag key' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Create>
);

export const DeviceTagEdit: React.FC = () => (
  <Edit title='Edit Device Tag'>
    <SimpleForm>
      <ReferenceInput
        source='device'
        reference='device'
        target='id'
        perPage={1000}
        sort={{ field: 'device name', order: 'ASC' }}
      >
        <SelectInput optionText='device name' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <Row>
        <TextInput label='Name' source='tag key' validate={required()} size='large' />
        <TextInput label='Value' source='value' validate={required()} size='large' />
      </Row>
    </SimpleForm>
  </Edit>
);

const deviceTag = {
  list: DeviceTagList,
  create: DeviceTagCreate,
  edit: DeviceTagEdit,
};

export default deviceTag;
