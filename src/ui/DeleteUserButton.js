import DeleteIcon from '@mui/icons-material/Delete';
import { Button } from '@mui/material';
import React from 'react';
import { useNotify, useRecordContext, useRedirect } from 'react-admin';
import { useDeleteUser, useDeleteUserBulk } from '../lib/user';
import { ConfirmationDialog } from './ConfirmationDialog';

export const DeleteUserButton = (props) => {
  const [open, setOpen] = React.useState(false);
  const notify = useNotify();
  const redirect = useRedirect();
  const deleteUser = useDeleteUser();
  const deleteUserBulk = useDeleteUserBulk();
  const record = useRecordContext();

  const handleSubmit = async (values) => {
    if (props.selectedIds) {
      await deleteUserBulk(props.selectedIds);
    } else {
      await deleteUser(record);
    }
    setOpen(false);
    notify('User(s) successfully deleted', { type: 'success' });
    redirect(props.redirect);
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant={props.variant || 'contained'}
        color='error'
        size={props.size}
        sx={props.sx}
      >
        <DeleteIcon sx={{ mr: '4px' }} size={props.size} /> {props.children}
      </Button>

      <ConfirmationDialog
        open={open}
        title='Delete User(s)'
        content='Note: this action will be irreversible'
        onConfirm={handleSubmit}
        onClose={() => setOpen(false)}
      />
    </>
  );
};

export default DeleteUserButton;
