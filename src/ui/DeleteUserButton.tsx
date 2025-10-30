import DeleteIcon from '@mui/icons-material/Delete';
import { Button, ButtonProps } from '@mui/material';
import React, { useState } from 'react';
import { Identifier, useNotify, useRecordContext, useRedirect } from 'react-admin';
import { useDeleteUser, useDeleteUserBulk } from '../lib/user';
import { ConfirmationDialog } from './ConfirmationDialog';

interface DeleteUserButtonProps {
  selectedIds?: Identifier[];
  redirect?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  sx?: ButtonProps['sx'];
  children?: React.ReactNode;
}

export const DeleteUserButton: React.FC<DeleteUserButtonProps> = ({
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
  const deleteUser = useDeleteUser();
  const deleteUserBulk = useDeleteUserBulk();
  const record = useRecordContext<Record<string, unknown>>();

  const handleSubmit = async () => {
    try {
      if (selectedIds?.length) {
        await deleteUserBulk(selectedIds);
      } else {
        await deleteUser(record);
      }
      notify('User(s) successfully deleted', { type: 'success' });
      redirect(redirectTo);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notify(`Failed to delete user(s): ${message}`, { type: 'error' });
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
        title='Delete User(s)'
        content='Note: this action will be irreversible'
        onConfirm={handleSubmit}
        onClose={() => setOpen(false)}
        confirmButtonText='Delete'
      />
    </>
  );
};

export default DeleteUserButton;
