import LockIcon from '@mui/icons-material/Lock';
import SaveIcon from '@mui/icons-material/Save';
import { Button, Dialog, DialogContent, DialogTitle } from '@mui/material';
import type { ButtonProps, SxProps, Theme } from '@mui/material';
import React from 'react';
import { PasswordInput, useDataProvider, useNotify, useRecordContext, SimpleForm } from 'react-admin';
import type { RaRecord } from 'react-admin';
import PasswordChecklist from 'react-password-checklist';
import Row from '../ui/Row';
import type { OpenBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';
import { isPasswordWithinBcryptLimit, maxPasswordBytes } from '../lib/passwordPolicy';

type ChangePasswordButtonProps = ButtonProps;

type ChangePasswordFormValues = {
  new_password: string;
};

const buildSx = (sx?: SxProps<Theme>): SxProps<Theme> => {
  if (!sx) {
    return { mb: '20px' };
  }

  if (Array.isArray(sx)) {
    return [...sx, { mb: '20px' }];
  }

  return { ...sx, mb: '20px' };
};

export const ChangePasswordButton: React.FC<ChangePasswordButtonProps> = ({ sx, ...buttonProps }) => {
  const [open, setOpen] = React.useState(false);
  const [newPassword, setPassword] = React.useState('');
  const [passwordChecklistValid, setPasswordChecklistValid] = React.useState(false);
  const isPasswordValid = passwordChecklistValid && isPasswordWithinBcryptLimit(newPassword);
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();
  const notify = useNotify();
  const record = useRecordContext<RaRecord>();
  const requestController = React.useRef<AbortController | undefined>(undefined);

  React.useEffect(
    () => () => {
      requestController.current?.abort();
    },
    [],
  );

  const handleClose = () => {
    requestController.current?.abort();
    requestController.current = undefined;
    setOpen(false);
  };

  const handleSubmit = async (values: Record<string, unknown>) => {
    const formValues = values as ChangePasswordFormValues;
    const { new_password } = formValues;

    if (!record) {
      notify('Error: Unable to change password without a record', { type: 'error' });
      return;
    }

    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      await dataProvider.changePassword({ userId: record.id, password: new_password, signal: controller.signal });

      handleClose();
      notify('Password successfully changed', { type: 'success' });
    } catch (error) {
      if (!controller.signal.aborted) {
        notify('Error: Unable to change password', { type: 'error' });
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = undefined;
      }
    }
  };

  return (
    <>
      <Button
        {...buttonProps}
        onClick={() => {
          setPassword('');
          setOpen(true);
        }}
        color={buttonProps.color ?? 'inherit'}
        variant={buttonProps.variant ?? 'outlined'}
        sx={buildSx(sx)}
      >
        <LockIcon style={{ marginRight: '4px' }} /> Change Password
      </Button>

      <Dialog open={open} onClose={handleClose} aria-labelledby='form-dialog-title'>
        <DialogTitle id='form-dialog-title'>Change Password</DialogTitle>

        <DialogContent>
          <SimpleForm onSubmit={handleSubmit} toolbar={false} mode='onBlur' reValidateMode='onBlur'>
            <Row>
              <PasswordInput
                variant='outlined'
                size='large'
                name='new_password'
                source='new_password'
                placeholder='Enter new password'
                validate={maxPasswordBytes}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button
                variant='contained'
                color='primary'
                type='submit'
                sx={{ ml: '20px', mt: '19px' }}
                disabled={!isPasswordValid}
              >
                <SaveIcon sx={{ mr: '8px' }} /> Save
              </Button>
            </Row>
            <PasswordChecklist
              rules={['minLength', 'specialChar', 'number', 'capitalAndLowercase']}
              minLength={8}
              value={newPassword}
              onChange={setPasswordChecklistValid}
            />
          </SimpleForm>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ChangePasswordButton;
