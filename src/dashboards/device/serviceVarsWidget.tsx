import { Box } from '@mui/material';
import * as React from 'react';
import { useRecordContext } from 'react-admin';
import { DeviceServiceVarListForDevice } from '../../components/deviceServiceVar';
import type { ResourceRecord } from '../../types/resource';

const ServiceVarsWidget: React.FC = () => {
  const device = useRecordContext<ResourceRecord>();

  if (!device) {
    return null;
  }

  return (
    <Box
      sx={{
        'px': '15px',
        'width': '100%',
        'minWidth': 0,
        'maxWidth': '100%',
        'overflowX': 'auto',
        '.RaList-noResults': {
          height: 'auto',
          paddingBottom: '30px',
        },
      }}
    >
      <DeviceServiceVarListForDevice deviceId={device.id} />
    </Box>
  );
};

export default ServiceVarsWidget;
