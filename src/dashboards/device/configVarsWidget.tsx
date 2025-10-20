import { Box } from '@mui/material';
import * as React from 'react';
import { DeviceConfigVarList } from '../../components/deviceConfigVar';

const ConfigVarsWidget = () => {
  return (
    <Box sx={{
      px: '15px',
      '.RaList-noResults': {
        height: 'auto',
        paddingBottom: '30px'
      }
    }}>
      <DeviceConfigVarList />
    </Box>
  );
};

export default ConfigVarsWidget;
