import { Box } from '@mui/material';
import * as React from 'react';
import { DeviceServiceVarList } from '../../components/deviceServiceVar';

const ServiceVarsWidget = () => {
  return (
    <Box sx={{
      px: '15px',
      '.RaList-noResults': {
        height: 'auto',
        paddingBottom: '30px'
      }
    }}>
      <DeviceServiceVarList />
    </Box>
  );
};

export default ServiceVarsWidget;
