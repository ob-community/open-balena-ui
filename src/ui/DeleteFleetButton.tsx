import DeleteIcon from '@mui/icons-material/Delete';
import { Button, ButtonProps } from '@mui/material';
import React, { useState } from 'react';
import { Identifier, useNotify, useRecordContext, useRedirect } from 'react-admin';
import { useDeleteFleet, useDeleteFleetBulk } from '../lib/fleet';
import { ConfirmationDialog } from './ConfirmationDialog';

interface DeleteFleetButtonProps {
  selectedIds?: Identifier[];
  redirect?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  sx?: ButtonProps['sx'];
  children?: React.ReactNode;
}

export const DeleteFleetButton: React.FC<DeleteFleetButtonProps> = ({
  selectedIds,
  redirect: redirectTo = 'list',
  variant = 'contained',
  size,
  sx,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const notify = useNotify();
  const redirect = useRedirect();
  const deleteFleet = useDeleteFleet();
  const deleteFleetBulk = useDeleteFleetBulk();
  const record = useRecordContext<Record<string, unknown>>();

  const handleSubmit = async () => {
    try {
      if (selectedIds?.length) {
        await deleteFleetBulk(selectedIds);
      } else {
        await deleteFleet(record);
      }
      notify('Fleet(s) successfully deleted', { type: 'success' });
      redirect(redirectTo);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notify(`Failed to delete fleet(s): ${message}`, { type: 'error' });
    }
    setOpen(false);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} variant={variant} color='error' size={size} sx={sx}>
        <DeleteIcon sx={{ mr: '4px' }} fontSize={size === 'small' ? 'small' : size === 'large' ? 'large' : 'medium'} />{' '}
        {children}
      </Button>

      <ConfirmationDialog
        open={open}
        title='Delete Fleet(s)'
        content='Note: this action will be irreversible'
        onConfirm={handleSubmit}
        onClose={() => setOpen(false)}
        confirmButtonText='Delete'
      />
    </>
  );
};

export default DeleteFleetButton;
