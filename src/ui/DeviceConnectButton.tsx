import React from 'react';
import { Grid, Button, Dialog, DialogTitle, DialogContent } from '@mui/material';
import type { ButtonProps, SxProps, Theme } from '@mui/material';
import IconButton from '@mui/material/IconButton';
import ConnectIcon from '@mui/icons-material/Sensors';
import CloseIcon from '@mui/icons-material/Close';
import Tooltip from '@mui/material/Tooltip';
import DeviceConnect from './DeviceConnect';
import { useRecordContext } from 'react-admin';
import type { ResourceRecord } from '../types/resource';

const styles: {
  dialog: SxProps<Theme>;
  dialogContent: SxProps<Theme>;
} = {
  dialog: {
    'width': '100%',
    'maxWidth': 'none',
    '& .MuiPaper-root': {
      maxWidth: 'none',
      width: '100%',
      height: '80vh',
    },
  },
  dialogContent: {
    maxWidth: 'none',
    display: 'flex',
    flexDirection: 'column',
  },
};

interface DeviceConnectButtonProps extends Omit<ButtonProps, 'children' | 'onClick'> {
  record?: ResourceRecord;
  connectIcon?: React.ReactNode;
  connectIconTooltip?: React.ReactNode;
  label?: React.ReactNode;
}

export const DeviceConnectButton: React.FC<DeviceConnectButtonProps> = ({
  record: recordProp,
  connectIcon,
  connectIconTooltip = 'Connect',
  label,
  ...buttonProps
}) => {
  const [open, setOpen] = React.useState(false);
  const contextRecord = useRecordContext<ResourceRecord>();
  const record = contextRecord ?? recordProp;
  const icon = connectIcon ?? <ConnectIcon />;

  const handleClose = () => {
    setOpen(false);
  };

  if (!record) {
    return null;
  }

  return (
    <>
      <Tooltip title={connectIconTooltip}>
        <Button aria-label='connect' onClick={() => setOpen(true)} startIcon={icon} {...buttonProps}>
          {label ?? null}
        </Button>
      </Tooltip>
      <Dialog open={open} onClose={handleClose} sx={styles.dialog}>
        <DialogTitle id='form-dialog-title'>
          <Grid container sx={{ justifyContent: 'space-between' }}>
            {record['device name']} ({record['uuid'].substring(0, 8)})
            <IconButton onClick={() => setOpen(false)} size='large'>
              <CloseIcon />
            </IconButton>
          </Grid>
        </DialogTitle>
        <DialogContent sx={styles.dialogContent}>
          <DeviceConnect record={record} />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default DeviceConnectButton;
