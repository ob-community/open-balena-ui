import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import { Box } from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';
import { TextInput, useDataProvider, useRecordContext } from 'react-admin';
import DualListBox from 'react-dual-listbox';
import { useFormContext } from 'react-hook-form';

const StyledDualListBox = styled(DualListBox)({
  'fontSize': '12px',
  '& .rdl-move': {
    border: 'none',
  },
  '& .rdl-control': {
    fontSize: '12px',
  },
});

const decode = {
  'actor eq @__ACTOR_ID': 'self',
  'id eq @__ACTOR_ID': 'self',
  'is_of__actor eq @__ACTOR_ID': 'self',
  'application/canAccess()': 'app accessible',
  'device/any(d:d/actor eq @__ACTOR_ID)': 'device accessible',
  'device/canAccess()': 'device accessible',
  'describes__device/canAccess()': 'device accessible',
  'service_install/canAccess()': 'service accessible',
  'service_install/any(si:si/device/any(d:d/actor eq @__ACTOR_ID))': 'service accessible',
  'service/canAccess()': 'service accessible',
  'image/any(i:i/is_a_build_of__service/any(s:s/application/any(a:a/depends_on__application/any(da:da/owns__device/any(d:d/actor eq @__ACTOR_ID)) or a/owns__device/any(d:d/is_managed_by__device/any(md:md/actor eq @__ACTOR_ID)))))':
    'image accessible',
  'device/any(d:d/actor eq @__ACTOR_ID or d/is_managed_by__device/any(md:md/actor eq @__ACTOR_ID)) and installs__image/any(i:i/image__is_part_of__release/any(ipr:ipr/is_part_of__release/any(r:r/belongs_to__application/any(a:a/owns__device/any(d:d/actor eq @__ACTOR_ID) or a/is_public eq true or a/is_host eq true))))':
    'device accessible',
  'image/canAccess()': 'image accessible',
  'device/any(d:d/actor eq @__ACTOR_ID or d/belongs_to__application/any(a:a/depends_on__application/any(da:da/owns__device/any(d:d/actor eq @__ACTOR_ID))))':
    'device accessible',
  'is_part_of__release/canAccess()': 'release accessible',
  'release_image/canAccess()': 'release accessible',
  'release/canAccess()': 'release accessible',
  'user/any(u:u/actor eq @__ACTOR_ID)': 'user accessible',
  'application/canAccess() or service_install/canAccess()': 'app accessible',
  "service_type eq 'vpn'": 'vpn',
  'should_be_running_on__device/canAccess() or belongs_to__application/canAccess()': 'device or app accessible',
  'device/any(d:d/actor eq @__ACTOR_ID or d/is_managed_by__device/any(md:md/actor eq @__ACTOR_ID))':
    'device accessible',
  'image_install/canAccess() or image__is_part_of__release/canAccess()': 'image accessible',
  'owns__device/canAccess() or depends_on__application/canAccess(1) or ((is_host eq true or is_public eq true) and is_for__device_type/any(dt:dt/describes__device/canAccess()))':
    'device accessible',
  'belongs_to__application/any(a:a/actor eq @__ACTOR_ID)': 'app accessible',
  'is_managed_by__device/canAccess(1) or belongs_to__application/any(a:a/depends_on__application/any(da:da/owns__device/any(d:d/actor eq @__ACTOR_ID)))':
    'app accessible',
  'belongs_to__application/any(a:a/depends_on__application/any(da:da/owns__device/any(d:d/actor eq @__ACTOR_ID)))':
    'app accessible',
};

export const ManagePermissions = (props) => {
  const [loaded, setLoaded] = React.useState({ all: false, selected: false });
  const [allPermissions, setAllPermissions] = React.useState([]);
  const [selectedPermissions, setSelectedPermissions] = React.useState([]);
  const dataProvider = useDataProvider();
  const record = useRecordContext();
  const { setValue } = useFormContext();

  const onChangeHandler = (arrayOfSelected) => {
    setSelectedPermissions(arrayOfSelected);
    setValue(props.source, arrayOfSelected, { shouldDirty: true });
  };

  React.useEffect(() => {
    if (!loaded.all) {
      dataProvider
        .getList('permission', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: {},
        })
        .then((permissions) => {
          let permissionOpts = [];
          permissions.data.forEach((x) => {
            const arr = x.name.split('.');
            var resource = arr[0] === 'resin' ? arr[1] : arr[0];
            var type = (arr[0] === 'resin' ? arr[2].split('?')[0] : arr[1] ? arr[1].split('?')[0] : 'full') || 'full';
            var opts = arr[0] === 'resin' ? arr[2].split('?')[1] : arr[1] ? arr[1].split('?')[1] : undefined;
            opts = decode[opts] ? decode[opts] : opts;
            var resourceIdx = permissionOpts.findIndex((x) => x.label === resource);
            if (resourceIdx === -1) {
              permissionOpts.push({
                label: resource,
                options: [{ label: type + (opts ? ` (${opts})` : ``), value: x.id }],
              });
            } else {
              permissionOpts[resourceIdx].options.push({ label: type + (opts ? ` (${opts})` : ``), value: x.id });
            }
          });
          setAllPermissions(permissionOpts);
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
          const selectedIds = existingMappings.data.map((x) => x.permission);
          setSelectedPermissions(selectedIds);
          loaded.selected = true;
          setLoaded(loaded);
        });
    }
  }, [props, dataProvider, setLoaded, loaded, setAllPermissions, setSelectedPermissions]);

  if (!(loaded.all && loaded.selected)) return null;

  return (
    <Box sx={{ width: '800px' }}>
      <strong style={{ margin: '40px 0 10px', display: 'block' }}>Permissions</strong>

      <StyledDualListBox
        options={allPermissions}
        selected={selectedPermissions}
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
        defaultValue={selectedPermissions}
        style={{ display: 'none' }}
      />
    </Box>
  );
};

export default ManagePermissions;
