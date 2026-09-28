import { Box, Tooltip } from '@mui/material';
import dateFormat from 'dateformat';
import React from 'react';

export const formatElapsedDuration = (referenceDate: Date): string => {
  const elapsedMilliseconds = Math.max(0, Date.now() - referenceDate.getTime());
  const elapsedDays = Math.floor(elapsedMilliseconds / 86400000);
  if (elapsedDays >= 1) return `${elapsedDays} ${elapsedDays === 1 ? 'day' : 'days'}`;

  const elapsedHours = Math.floor(elapsedMilliseconds / 3600000);
  if (elapsedHours >= 1) return `${elapsedHours} ${elapsedHours === 1 ? 'hour' : 'hours'}`;

  const elapsedMinutes = Math.floor(elapsedMilliseconds / 60000);
  return `${elapsedMinutes} ${elapsedMinutes === 1 ? 'minute' : 'minutes'}`;
};

const ConnectionLastConnected: React.FC<{ connected: boolean; timestamp: unknown }> = ({ connected, timestamp }) => {
  const referenceDate = new Date(String(timestamp ?? ''));
  if (Number.isNaN(referenceDate.getTime())) return connected ? 'Connected' : 'Never connected';
  const duration = formatElapsedDuration(referenceDate);

  return (
    <Tooltip placement='top' arrow title={`Last connected ${dateFormat(referenceDate)}`}>
      <Box component='span' sx={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: '0.35em' }}>
        {connected ? (
          <>
            <Box component='span' sx={{ whiteSpace: 'nowrap' }}>
              Connected
            </Box>
            <Box component='span' sx={{ whiteSpace: 'nowrap' }}>
              (for {duration})
            </Box>
          </>
        ) : (
          <Box component='span' sx={{ whiteSpace: 'nowrap' }}>
            {duration} ago
          </Box>
        )}
      </Box>
    </Tooltip>
  );
};

export default ConnectionLastConnected;
