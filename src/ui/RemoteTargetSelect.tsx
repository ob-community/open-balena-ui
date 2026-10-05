import { FormControl, InputLabel, MenuItem, Select, type SxProps, type Theme } from '@mui/material';
import React from 'react';
import type { RemoteTarget } from '../lib/builtInRemoteAccess';
import { ServiceBadge } from './ServiceBadge';

export const RemoteTargetSelect: React.FC<{
  targets: RemoteTarget[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  label?: string;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}> = ({ targets, value, onChange, ariaLabel, label, disabled, sx }) => {
  const id = React.useId();
  return (
    <FormControl size='small' disabled={disabled} sx={sx}>
      {label && <InputLabel id={id}>{label}</InputLabel>}
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        label={label}
        labelId={label ? id : undefined}
        inputProps={{ 'aria-label': ariaLabel }}
        MenuProps={{ sx: { zIndex: 1500 } }}
      >
        {targets.map((target) => (
          <MenuItem key={target.id} value={target.id}>
            <ServiceBadge name={target.label} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};
