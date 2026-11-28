import DeleteIcon from '@mui/icons-material/Delete';
import { Button, ButtonProps } from '@mui/material';
import React, { useEffect, useState } from 'react';
import {
  DataProvider,
  Identifier,
  useNotify,
  useRecordContext,
  useRedirect,
  useRefresh,
  useResourceContext,
  useUnselectAll,
} from 'react-admin';
import { useDeleteRelease, useDeleteReleaseBulk } from '../lib/release';
import { runReleaseDelete } from '../lib/releaseDeleteFlow';
import versions from '../versions';
import environment from '../lib/reactAppEnv';
import { ConfirmationDialog } from './ConfirmationDialog';

const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);

interface DeleteReleaseButtonProps {
  selectedIds?: Identifier[];
  context: DataProvider;
  /** Where to go after a successful delete ('list' by default); false stays on the current page. */
  redirect?: string | false;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  sx?: ButtonProps['sx'];
  children?: React.ReactNode;
  color?: ButtonProps['color'];
}

export const DeleteReleaseButton: React.FC<DeleteReleaseButtonProps> = ({
  selectedIds,
  context,
  redirect: redirectTo = 'list',
  variant = 'contained',
  size,
  sx,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const notify = useNotify();
  const redirect = useRedirect();
  const refresh = useRefresh();
  // react-admin's redirect() needs the resource name for 'list'/'show'/... targets; without it, it
  // throws "Cannot create a link without a resource" after an otherwise successful delete.
  const resource = useResourceContext() ?? 'release';
  const unselectAll = useUnselectAll(resource);
  const deleteRelease = useDeleteRelease();
  const deleteReleaseBulk = useDeleteReleaseBulk();
  const [disabled, setDisabled] = useState(true);
  const record = useRecordContext<Record<string, unknown>>();

  const handleSubmit = async () => {
    const isBulk = Boolean(selectedIds?.length);
    await runReleaseDelete({
      performDelete: () => (isBulk ? deleteReleaseBulk(selectedIds!) : deleteRelease(record)),
      notifySuccess: () => notify('Release(s) successfully deleted', { type: 'success' }),
      notifyFailure: (message) => notify(`Failed to delete release(s): ${message}`, { type: 'error' }),
      afterSuccess: [
        ...(isBulk ? [() => unselectAll()] : []),
        () => refresh(),
        ...(redirectTo ? [() => redirect(redirectTo, resource)] : []),
      ],
    });
    setOpen(false);
  };

  const recordId = (record as { id?: Identifier } | undefined)?.id;

  useEffect(() => {
    const canDeleteRelease = async (releaseId: Identifier) => {
      const releaseLookups = [
        { resource: 'device', field: `#is running-release,${isPinnedOnRelease},should be operated by-release@eq` },
        { resource: 'application', field: 'should be running-release' },
      ] as const;
      let count = 0;
      await Promise.all(
        releaseLookups.map(async (lookup) => {
          const result = await context.getList(lookup.resource, {
            pagination: { page: 1, perPage: 1000 },
            sort: { field: 'id', order: 'ASC' },
            filter: { [lookup.field]: releaseId },
          });
          count += result.data.length;
        }),
      );
      return count === 0;
    };

    if (selectedIds?.length) {
      Promise.all(selectedIds.map((id) => canDeleteRelease(id))).then((canDeleteResults) =>
        setDisabled(!canDeleteResults.every(Boolean)),
      );
    } else if (recordId != null) {
      canDeleteRelease(recordId).then((canDelete) => setDisabled(!canDelete));
    } else {
      setDisabled(true);
    }
  }, [context, recordId, selectedIds]);

  return (
    <>
      <Button onClick={() => setOpen(true)} variant={variant} color='error' size={size} sx={sx} disabled={disabled}>
        <DeleteIcon sx={{ mr: '4px' }} fontSize={size === 'small' ? 'small' : size === 'large' ? 'large' : 'medium'} />{' '}
        {children}
      </Button>

      <ConfirmationDialog
        open={open}
        title='Delete Release(s)'
        content='Note: this action will be irreversible'
        onConfirm={handleSubmit}
        onClose={() => setOpen(false)}
        confirmButtonText='Delete'
      />
    </>
  );
};

export default DeleteReleaseButton;
