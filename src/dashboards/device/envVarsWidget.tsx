import { Box } from '@mui/material';
import * as React from 'react';
import { DeviceEnvVarList } from '../../components/deviceEnvVar';

const EnvVarsWidget: React.FC = () => {
  return (
    <Box
      sx={{
        'px': '15px',
        '.RaList-noResults': {
          height: 'auto',
          paddingBottom: '30px',
        },
      }}
    >
      <DeviceEnvVarList />
    </Box>
  );
};

export default EnvVarsWidget;
