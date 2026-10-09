import { Alert, Box, LinearProgress, Typography } from '@mui/material';
import React from 'react';
import { getDeviceOsUpdateProgress } from '../lib/deviceUpdateProgress';
import type { ResourceRecord } from '../types/resource';

export const DeviceOsUpdateProgress: React.FC<{ device: ResourceRecord }> = ({ device }) => {
  const update = getDeviceOsUpdateProgress(device);
  if (!update) return null;
  const severity = update.status === 'failed' ? 'error' : update.status === 'complete' ? 'success' : 'info';
  return (
    <Alert severity={severity} sx={{ mt: 1 }}>
      <Typography variant='body2'>Host OS update</Typography>
      <Typography variant='body2'>
        {update.stage}
        {update.progress !== undefined ? ` (${update.progress}%)` : ''}
      </Typography>
      {update.progress !== undefined || update.status === 'active' ? (
        <Box sx={{ mt: 1 }}>
          <LinearProgress
            aria-label='Host OS update progress'
            variant={update.progress === undefined ? 'indeterminate' : 'determinate'}
            value={update.progress}
            color={severity === 'error' ? 'error' : severity === 'success' ? 'success' : 'primary'}
          />
        </Box>
      ) : null}
      <Typography variant='caption'>Stage-based progress, not image download percentage.</Typography>
    </Alert>
  );
};
