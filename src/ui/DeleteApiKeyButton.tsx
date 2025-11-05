import DeleteIcon from '@mui/icons-material/Delete';
import { Button, ButtonProps } from '@mui/material';
import React, { useState } from 'react';
import { Identifier, useNotify, useRecordContext, useUnselectAll, useRefresh } from 'react-admin';
import { useDeleteApiKey, useDeleteApiKeyBulk } from '../lib/apiKey';
import { ConfirmationDialog } from './ConfirmationDialog';

interface DeleteApiKeyButtonProps {
  selectedIds?: Identifier[];
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  sx?: ButtonProps['sx'];
  children?: React.ReactNode;
}

export const DeleteApiKeyButton: React.FC<DeleteApiKeyButtonProps> = ({
  selectedIds,
  variant = 'contained',
  size,
  sx,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const notify = useNotify();
  const refresh = useRefresh();
  const unselectAll = useUnselectAll('api key');
  const deleteApiKey = useDeleteApiKey();
  const deleteApiKeyBulk = useDeleteApiKeyBulk();
  const record = useRecordContext<Record<string, unknown>>();

  const handleSubmit = async () => {
    try {
      if (selectedIds?.length) {
        await deleteApiKeyBulk(selectedIds);
        unselectAll();
      } else {
        await deleteApiKey(record);
      }
      notify('API Key(s) successfully deleted', { type: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notify(`Failed to delete API Key(s): ${message}`, { type: 'error' });
    }
    setOpen(false);
    refresh();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} variant={variant} color='error' size={size} sx={sx}>
        <DeleteIcon sx={{ mr: '4px' }} fontSize={size === 'small' ? 'small' : size === 'large' ? 'large' : 'medium'} />{' '}
        {children}
      </Button>

      <ConfirmationDialog
        open={open}
        title='Delete API Key(s)'
        content='Note: this action will be irreversible'
        onConfirm={handleSubmit}
        onClose={() => setOpen(false)}
        confirmButtonText='Delete'
      />
    </>
  );
};

export default DeleteApiKeyButton;
