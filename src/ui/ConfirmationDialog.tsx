import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import React, { useState } from 'react';

export interface ConfirmationDialogProps {
  open?: boolean;
  title: React.ReactNode;
  content: React.ReactNode;
  onClose?: () => void;
  onConfirm?: () => Promise<void> | void;
  confirmButtonText?: React.ReactNode;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  open = true,
  title,
  content,
  onClose,
  onConfirm,
  confirmButtonText,
}) => {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <Dialog open={open} onClose={isLoading ? undefined : onClose}>
      <DialogTitle>{title}</DialogTitle>

      <DialogContent>
        <DialogContentText>{content}</DialogContentText>
      </DialogContent>

      <DialogActions className='custom'>
        <Button variant='outlined' onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>

        <Button
          variant='contained'
          disabled={isLoading}
          onClick={async () => {
            try {
              setIsLoading(true);
              await onConfirm?.();
            } finally {
              onClose?.();
              setIsLoading(false);
            }
          }}
        >
          {isLoading ? <CircularProgress size={24} sx={{ color: 'white' }} /> : confirmButtonText || 'Confirm'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
