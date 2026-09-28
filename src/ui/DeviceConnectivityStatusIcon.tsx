import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { Tooltip } from '@mui/material';
import dateFormat from 'dateformat';
import React from 'react';

type DeviceConnectivityRecord = Record<string, unknown>;

export const VpnStatusIcon: React.FC<{ record: DeviceConnectivityRecord }> = ({ record }) => {
  const connected = record['is connected to vpn'] === true;
  const changedAt = new Date(String(record['last vpn event'] ?? ''));
  const title = Number.isNaN(changedAt.getTime())
    ? `VPN ${connected ? 'connected' : 'disconnected'}`
    : `VPN state changed ${dateFormat(changedAt)}`;

  return (
    <Tooltip title={title} placement='top' arrow>
      <span style={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', lineHeight: 0 }}>
        {connected ? (
          <CheckCircleIcon color='success' aria-label='Connected' />
        ) : (
          <CancelIcon color='error' aria-label='Disconnected' />
        )}
      </span>
    </Tooltip>
  );
};

export const HeartbeatStatusIcon: React.FC<{ record: DeviceConnectivityRecord }> = ({ record }) => {
  const online = record['api heartbeat state'] === 'online';
  const changedAt = new Date(String(record['changed api heartbeat state on-date'] ?? ''));
  const title = Number.isNaN(changedAt.getTime())
    ? `Heartbeat ${online ? 'online' : 'offline'}`
    : `Heartbeat state changed ${dateFormat(changedAt)}`;

  return (
    <Tooltip title={title} placement='top' arrow>
      <span style={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', lineHeight: 0 }}>
        {online ? (
          <CheckCircleIcon color='success' aria-label='Online' />
        ) : (
          <CancelIcon color='error' aria-label='Offline' />
        )}
      </span>
    </Tooltip>
  );
};
