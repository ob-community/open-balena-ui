import * as React from 'react';
import {
  BooleanField,
  ChipField,
  Datagrid,
  DateField,
  FunctionField,
  List,
  ReferenceField,
  ReferenceManyCount,
  ReferenceManyField,
  SearchInput,
  SingleFieldList,
  TextField,
  Toolbar,
  useDataProvider,
  useListContext,
} from 'react-admin';
import type { FunctionFieldProps, RaRecord } from 'react-admin';
import DeleteReleaseButton from '../ui/DeleteReleaseButton';
import SemVerTextField from '../ui/SemVerTextField';

const releaseFilters = [<SearchInput source='status@ilike' alwaysOn />];

type BooleanBinaryFieldProps = Omit<FunctionFieldProps<RaRecord>, 'render'>;

const BooleanBinaryField: React.FC<BooleanBinaryFieldProps> = ({ source = 'enabled', ...props }) => (
  <FunctionField
    {...props}
    source={source}
    render={(record: RaRecord) => {
      const rawValue = record[source];
      const enabled = rawValue === 1 || rawValue === true;

      return <BooleanField source='enabled' record={{ ...record, enabled }} />;
    }}
  />
);

const TagChipField: React.FC = (props) => {
  return (
    <FunctionField
      {...props}
      render={(record) => (
        <ChipField source='tag' record={{ ...record, tag: `${record['tag key']}: ${record['value']}` }} />
      )}
    />
  );
};

// Bulk action buttons do not receive the selection as a prop in react-admin 5; read it from the
// list context (as the device list does), otherwise the bulk Delete button never enables.
const ReleaseBulkActionButtons: React.FC = () => {
  const { selectedIds } = useListContext();
  return (
    <DeleteReleaseButton size='small' context={useDataProvider()} selectedIds={selectedIds} redirect={false}>
      Delete
    </DeleteReleaseButton>
  );
};

export const ReleaseList: React.FC = () => {
  return (
    <List filters={releaseFilters} sort={{ field: 'version', order: 'DESC' }}>
      <Datagrid size='medium' rowClick={false} bulkActionButtons={<ReleaseBulkActionButtons />}>
        <ReferenceField label='Fleet' source='belongs to-application' reference='application' sortable={false}>
          <TextField source='app name' />
        </ReferenceField>
        <ReferenceField
          label='Host'
          source='belongs to-application'
          reference='application'
          sortable={false}
          link={false}
        >
          <BooleanBinaryField source='is host' />
        </ReferenceField>
        <SemVerTextField label='Version' sortable sortBy='version' />
        <DateField label='Date' source='created at' />
        <ReferenceManyCount
          label='Devices'
          source='id'
          reference='device'
          target='is running-release'
          link={false}
          sortable={true}
        />

        <TextField label='Status' source='status' />

        <ReferenceManyField label='Tags' source='id' reference='release tag' target='release'>
          <SingleFieldList linkType={false}>
            <TagChipField />
          </SingleFieldList>
        </ReferenceManyField>

        <Toolbar>
          <DeleteReleaseButton variant='outlined' size='small' context={useDataProvider()} redirect={false} />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

const release = {
  list: ReleaseList,
};

export default release;
