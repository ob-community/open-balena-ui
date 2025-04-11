import DeleteIcon from '@mui/icons-material/Delete';
import { Button } from '@mui/material';
import React from 'react';
import { useNotify, useRecordContext, useRedirect } from 'react-admin';
import { useDeleteFleet, useDeleteFleetBulk } from '../lib/fleet';
import { ConfirmationDialog } from './ConfirmationDialog';

export const DeleteFleetButton = (props) => {
  const [open, setOpen] = React.useState(false);
  const notify = useNotify();
  const redirect = useRedirect();
  const deleteFleet = useDeleteFleet();
  const deleteFleetBulk = useDeleteFleetBulk();
  const record = useRecordContext();

  const handleSubmit = async (values) => {
    if (props.selectedIds) {
      await deleteFleetBulk(props.selectedIds);
    } else {
      await deleteFleet(record);
    }
    setOpen(false);
    notify('Fleet(s) successfully deleted', { type: 'success' });
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
        title='Delete Fleet(s)'
        content='Note: this action will be irreversible'
        onConfirm={handleSubmit}
        onClose={() => setOpen(false)}
      />
    </>
  );
};

export default DeleteFleetButton;
