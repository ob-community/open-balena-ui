import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import { Box } from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';
import { TextInput, useDataProvider, useRecordContext } from 'react-admin';
import DualListBox from 'react-dual-listbox';
import 'react-dual-listbox/lib/react-dual-listbox.css';
import { useFormContext } from 'react-hook-form';

const StyledDualListBox = styled(DualListBox)({
  'fontSize': '12px',
  'marginTop': '10px',
  '& .rdl-move': {
    border: 'none',
  },
  '& .rdl-control': {
    fontSize: '11px',
  },
});

export const ManageOrganizations = (props) => {
  const [loaded, setLoaded] = React.useState({ all: false, selected: false });
  const [allOrganizations, setAllOrganizations] = React.useState([]);
  const [selectedOrganizations, setSelectedOrganizations] = React.useState([]);
  const dataProvider = useDataProvider();
  const record = useRecordContext();
  const { setValue } = useFormContext();

  const onChangeHandler = (arrayOfSelected) => {
    setSelectedOrganizations(arrayOfSelected);
    setValue(props.source, arrayOfSelected, { shouldDirty: true });
  };

  React.useEffect(() => {
    if (!loaded.all) {
      dataProvider
        .getList('organization', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: {},
        })
        .then((organizations) => {
          const organizationOpts = organizations.data.map((x) => ({ label: x.name, value: x.id }));
          setAllOrganizations(organizationOpts);
          loaded.all = true;
          setLoaded(loaded);
        });
    }
    if (!loaded.selected && record) {
      dataProvider
        .getList(props.reference, {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { [props.target]: record.id },
        })
        .then((existingMappings) => {
          const selectedIds = existingMappings.data.map((x) => x['is member of-organization']);
          setSelectedOrganizations(selectedIds);
          loaded.selected = true;
          setLoaded(loaded);
        });
    }
  }, [props, dataProvider, setLoaded, loaded, setAllOrganizations, setSelectedOrganizations]);

  if (!(loaded.all && loaded.selected)) return null;

  return (
    <Box sx={{ width: '800px' }}>
      <strong>Organizations</strong>

      <StyledDualListBox
        options={allOrganizations}
        selected={selectedOrganizations}
        onChange={onChangeHandler}
        showHeaderLabels
        icons={{
          moveToAvailable: <KeyboardArrowLeftIcon />,
          moveAllToAvailable: <KeyboardDoubleArrowLeftIcon />,
          moveToSelected: <KeyboardArrowRightIcon />,
          moveAllToSelected: <KeyboardDoubleArrowRightIcon />,
        }}
      />

      <TextInput
        source={props.source}
        defaultValue={selectedOrganizations}
        style={{ display: 'none' }}
      />
    </Box>
  );
};

export default ManageOrganizations;
