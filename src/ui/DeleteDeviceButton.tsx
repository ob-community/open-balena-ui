import DeleteIcon from '@mui/icons-material/Delete';
import { Button, ButtonProps, Tooltip } from '@mui/material';
import React, { useState } from 'react';
import { Identifier, useNotify, useRecordContext, useUnselectAll, useRefresh } from 'react-admin';
import { useDeleteDevice, useDeleteDeviceBulk } from '../lib/device';
import { ConfirmationDialog } from './ConfirmationDialog';

interface DeleteDeviceButtonProps {
  selectedIds?: Identifier[];
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  sx?: ButtonProps['sx'];
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export const DeleteDeviceButton: React.FC<DeleteDeviceButtonProps> = ({
  selectedIds,
  variant = 'contained',
  size,
  sx,
  style,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const notify = useNotify();
  const refresh = useRefresh();
  const unselectAll = useUnselectAll('device');
  const deleteDevice = useDeleteDevice();
  const deleteDeviceBulk = useDeleteDeviceBulk();
  const record = useRecordContext<Record<string, unknown>>();

  const handleSubmit = async () => {
    try {
      if (selectedIds?.length) {
        await deleteDeviceBulk(selectedIds);
        unselectAll();
      } else {
        await deleteDevice(record);
      }
      notify('Device(s) successfully deleted', { type: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notify(`Failed to delete device(s): ${message}`, { type: 'error' });
    }
    setOpen(false);
    refresh();
  };

  return (
    <>
      <Tooltip title='Delete'>
        <Button onClick={() => setOpen(true)} variant={variant} color='error' size={size} sx={sx} style={style}>
          <DeleteIcon
            sx={{ mr: '4px' }}
            fontSize={size === 'small' ? 'small' : size === 'large' ? 'large' : 'medium'}
          />{' '}
          {children}
        </Button>
      </Tooltip>

      <ConfirmationDialog
        open={open}
        title='Delete Device(s)'
        content='Note: this action will be irreversible'
        onConfirm={handleSubmit}
        onClose={() => setOpen(false)}
        confirmButtonText='Delete'
      />
    </>
  );
};

export default DeleteDeviceButton;
