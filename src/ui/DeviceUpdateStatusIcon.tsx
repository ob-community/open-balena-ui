import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import SyncIcon from '@mui/icons-material/Sync';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import React from 'react';

type DeviceUpdateStatus = 'outdated' | 'updating';

interface DeviceUpdateStatusIconProps extends SvgIconProps {
  status: DeviceUpdateStatus;
}

const DeviceUpdateStatusIcon: React.FC<DeviceUpdateStatusIconProps> = ({ status, ...props }) =>
  status === 'updating' ? <SyncIcon {...props} /> : <SystemUpdateAltIcon {...props} />;

export type { DeviceUpdateStatus };
export default DeviceUpdateStatusIcon;
