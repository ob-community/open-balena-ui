import { Box } from '@mui/material';
import * as React from 'react';
import { useRecordContext } from 'react-admin';
import { DeviceEnvVarList } from '../../components/deviceEnvVar';

const EnvVarsWidget = () => {
  return (
    <Box sx={{
      px: '15px',
      '.RaList-noResults': {
        height: 'auto',
        paddingBottom: '30px'
      }
    }}>
      <DeviceEnvVarList />
    </Box>
  );
};

export default EnvVarsWidget;
