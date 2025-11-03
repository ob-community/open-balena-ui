import React from 'react';
import { Grid, Button, Dialog, DialogTitle, DialogContent, ButtonProps } from '@mui/material';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import ListIcon from '@mui/icons-material/List';
import Tooltip from '@mui/material/Tooltip';
import DeviceServices from './DeviceServices';

export const DeviceServicesButton: React.FC<ButtonProps & { label?: string; device: any }> = ({
  label,
  device,
  ...props
}) => {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Tooltip title='Device Services'>
        <Button aria-label='services' onClick={() => setOpen(true)} {...props}>
          <ListIcon />
          {label ? <span style={{ paddingLeft: '4px' }}>{label}</span> : ''}
        </Button>
      </Tooltip>
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby='form-dialog-title'>
        <DialogTitle id='form-dialog-title'>
          <DialogTitle id='form-dialog-title'>
            <Grid container style={{ justifyContent: 'space-between' }}>
              Device Services
              <IconButton aria-label='close' onClick={() => setOpen(false)} size='large'>
                <CloseIcon />
              </IconButton>
            </Grid>
          </DialogTitle>
        </DialogTitle>
        <DialogContent>
          <DeviceServices device={device} />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default DeviceServicesButton;
