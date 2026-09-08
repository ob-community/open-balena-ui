import { Box, LinearProgress, Tooltip } from '@mui/material';
import * as React from 'react';
import { LinearProgressProps, useRecordContext } from 'react-admin';
import { isDeviceOnline } from '../../lib/deviceStatus';

const LinearProgressWithLabel: React.FC<
  LinearProgressProps & {
    label?: React.ReactNode;
    tooltip?: string;
    value?: number;
    displayValue?: number;
    displayUnits?: string;
    offline?: boolean;
  }
> = ({ label, tooltip, displayValue, displayUnits, style, value, offline = false, ...progressProps }) => {
  const valueLabel = offline
    ? '—'
    : displayValue !== undefined
      ? `${displayValue}${displayUnits ?? ''}`
      : `${Math.round(value ?? 0)}%`;

  return (
    <Box sx={{ mb: 2.75, mx: '10px', display: 'flex', alignItems: 'center' }} style={style}>
      <Box sx={{ flex: 1, minWidth: '3em' }}>{label}</Box>
      <Box sx={{ flex: 10, minWidth: '12em', mr: 1, ml: 2 }}>
        <LinearProgress variant='determinate' color='secondary' value={offline ? 0 : value} {...progressProps} />
      </Box>
      <Box sx={{ flex: 1, minWidth: '3em' }}>
        <Tooltip placement='top' arrow={true} title={offline ? 'Unavailable while the device is offline' : tooltip}>
          <span>{valueLabel}</span>
        </Tooltip>
      </Box>
    </Box>
  );
};

const UsageWidget = () => {
  const record = useRecordContext();

  if (!record) return null;

  const offline = !isDeviceOnline(record);

  return (
    <>
      <Box style={{ display: 'flex', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, margin: '10px 0' }}>
          <LinearProgressWithLabel
            label='CPU'
            offline={offline}
            value={isFinite(record['cpu usage']) ? record['cpu usage'] : 0}
          />

          <LinearProgressWithLabel
            style={{ marginBottom: '0' }}
            label='Temp'
            offline={offline}
            value={isFinite(record['cpu temp']) ? (record['cpu temp'] / 90) * 100 : 0}
            displayValue={isFinite(record['cpu temp']) ? record['cpu temp'] : undefined}
            displayUnits='°C'
          />
        </div>

        <div style={{ flex: 1, margin: '10px 0' }}>
          <LinearProgressWithLabel
            label='SD'
            offline={offline}
            value={
              isFinite(record['storage usage'] / record['storage total'])
                ? (record['storage usage'] / record['storage total']) * 100
                : 0
            }
            tooltip={
              isFinite(record['storage usage'] / record['storage total'])
                ? `Usage: ${record['storage usage']} MB of ${record['storage total']} MB`
                : ''
            }
          />

          <LinearProgressWithLabel
            style={{ marginBottom: '0' }}
            label='RAM'
            offline={offline}
            value={
              isFinite(record['memory usage'] / record['memory total'])
                ? (record['memory usage'] / record['memory total']) * 100
                : 0
            }
            tooltip={
              isFinite(record['memory usage'] / record['memory total'])
                ? `Usage: ${record['memory usage']} MB of ${record['memory total']} MB`
                : ''
            }
          />
        </div>
      </Box>
    </>
  );
};

export default UsageWidget;
