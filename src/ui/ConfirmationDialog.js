import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle } from '@mui/material';
import React from 'react';

export const ConfirmationDialog = ({ open = true, title, message, onClose, onConfirm, confirmText, destructive }) => {
  const [isLoading, setIsLoading] = React.useState(false);

  return (
    <Dialog open={open} onClose={isLoading ? undefined : onClose}>
      <DialogTitle>{title}</DialogTitle>

      <DialogContent>
        {!!message && <p style={{ marginTop: '0' }}>{message}</p>}

        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
          }}
        >
          <Button variant='outlined' onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>

          <Button
            variant='contained'
            color={destructive ? 'error' : 'primary'}
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
            {isLoading ? <CircularProgress size={24} sx={{ color: 'white' }} /> : confirmText || 'Confirm'}
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
};
