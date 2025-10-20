import { Box, LinearProgress, Tooltip } from '@mui/material';
import * as React from 'react';
import { useRecordContext } from 'react-admin';

const LinearProgressWithLabel = (props) => {
  return (
    <Box sx={{ mb: 2.75, mx: '10px', display: 'flex', alignItems: 'center' }} style={props.style}>
      <Box sx={{ flex: 1, minWidth: '3em' }}>{props.label}</Box>
      <Box sx={{ flex: 10, minWidth: '12em', mr: 1, ml: 2 }}>
        <LinearProgress variant='determinate' color='secondary' {...props} />
      </Box>
      <Box sx={{ flex: 1, minWidth: '3em' }}>
        <Tooltip placement='top' arrow={true} title={props.tooltip}>
          {props.displayValue ? props.displayValue + props.displayUnits : Math.round(props.value) + '%'}
        </Tooltip>
      </Box>
    </Box>
  );
};

const UsageWidget = () => {
  const record = useRecordContext();

  if (!record) return null;

  return (
    <>
      <Box style={{ display: 'flex', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, margin: '10px 0' }}>
          <LinearProgressWithLabel label='CPU' value={isFinite(record['cpu usage']) ? record['cpu usage'] : 0} />

          <LinearProgressWithLabel
            style={{ marginBottom: '0' }}
            label='Temp'
            value={isFinite(record['cpu temp']) ? (record['cpu temp'] / 90) * 100 : 0}
            displayValue={isFinite(record['cpu temp']) ? record['cpu temp'] : 0}
            displayUnits='&deg;C'
          />
        </div>

        <div style={{ flex: 1, margin: '10px 0' }}>
          <LinearProgressWithLabel
            label='SD'
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
