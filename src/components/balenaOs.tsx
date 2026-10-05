import SyncIcon from '@mui/icons-material/Sync';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  FormControl,
  LinearProgress,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import * as React from 'react';
import { Title, useDataProvider, useNotify } from 'react-admin';
import semver from 'semver';
import type { BalenaOsSyncMode, OpenBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';

type Catalog = Awaited<ReturnType<OpenBalenaDataProvider['getBalenaOsCatalog']>>;
type SyncStatus = Awaited<ReturnType<OpenBalenaDataProvider['getBalenaOsSyncStatus']>>;

const emptyStatus: SyncStatus = {
  state: 'idle',
  phase: 'Not started',
  processed: 0,
  total: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
};

export const BalenaOsPage: React.FC = () => {
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();
  const notify = useNotify();
  const [catalog, setCatalog] = React.useState<Catalog>();
  const [status, setStatus] = React.useState<SyncStatus>(emptyStatus);
  const [syncMode, setSyncMode] = React.useState<BalenaOsSyncMode>('all');
  const [version, setVersion] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string>();
  const [confirming, setConfirming] = React.useState(false);

  const loadCatalog = React.useCallback(
    async (signal?: AbortSignal) => {
      const nextCatalog = await dataProvider.getBalenaOsCatalog({ signal });
      setCatalog(nextCatalog);
    },
    [dataProvider],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    Promise.all([loadCatalog(controller.signal), dataProvider.getBalenaOsSyncStatus({ signal: controller.signal })])
      .then(([, nextStatus]) => setStatus(nextStatus))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : 'Unable to load the BalenaOS catalog.';
          setLoadError(message);
          notify(message, { type: 'error' });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [dataProvider, loadCatalog, notify]);

  React.useEffect(() => {
    if (status.state !== 'running') return;
    const controller = new AbortController();
    const interval = window.setInterval(() => {
      dataProvider
        .getBalenaOsSyncStatus({ signal: controller.signal })
        .then((nextStatus) => {
          setStatus(nextStatus);
          if (nextStatus.state === 'completed' || nextStatus.state === 'failed') {
            void loadCatalog().catch((error: unknown) => {
              notify(error instanceof Error ? error.message : 'Unable to refresh the BalenaOS catalog.', {
                type: 'error',
              });
            });
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            notify(error instanceof Error ? error.message : 'Unable to refresh synchronization status.', {
              type: 'error',
            });
          }
        });
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [dataProvider, loadCatalog, notify, status.state]);

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Title title='BalenaOS Catalog' />
        <Stack spacing={2}>
          <Typography variant='h4'>BalenaOS Catalog</Typography>
          <Typography color='text.secondary'>Loading local and upstream catalog details…</Typography>
          <LinearProgress aria-label='Loading BalenaOS catalog' />
        </Stack>
      </Box>
    );
  }

  if (loadError) {
    return (
      <Box sx={{ p: 3 }}>
        <Title title='BalenaOS Catalog' />
        <Alert severity='error'>{loadError}</Alert>
      </Box>
    );
  }

  const startSync = async () => {
    if (!balenaOsOrganization) return;
    try {
      await dataProvider.startBalenaOsSync({
        mode: syncMode,
        ...((syncMode === 'newer-and-in-use' || syncMode === 'single') && version.trim()
          ? { version: version.trim() }
          : {}),
      });
      setStatus(await dataProvider.getBalenaOsSyncStatus());
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to start BalenaOS synchronization.', { type: 'error' });
    }
  };

  const progress = status.total > 0 ? Math.min(100, (status.processed / status.total) * 100) : 0;
  const requiresVersion = syncMode === 'newer-and-in-use' || syncMode === 'single';
  const versionError = requiresVersion && semver.valid(version.trim()) == null;
  const balenaOsOrganization = catalog?.organizations.find(({ name }) => name === 'balena_os');
  const syncModeDescription: Record<BalenaOsSyncMode, string> = {
    'all': 'Synchronize every assignable version advertised by each local device type.',
    'latest-and-in-use': 'Synchronize the latest usable version for each device type, plus versions currently in use.',
    'newer-and-in-use':
      'Synchronize versions strictly newer than the threshold, plus versions currently reported by local devices.',
    'in-use': 'Synchronize only versions currently reported by local devices, grouped by device type.',
    'single':
      'Synchronize one semantic version for every compatible device type. Omitting +revN includes matching revisions.',
  };

  return (
    <Box sx={{ p: 3 }}>
      <Title title='BalenaOS Catalog' />
      <Stack spacing={3}>
        <Box>
          <Typography variant='h4' gutterBottom>
            BalenaOS Catalog
          </Typography>
          <Typography color='text.secondary'>
            Synchronize public BalenaOS host applications and their assignable release graph into this open-balena-api
            installation.
          </Typography>
        </Box>

        <Alert severity='warning'>
          Synchronization can create thousands of application, release, service, image, and relationship records. It is
          additive and idempotent; records not present in the upstream catalog are not deleted.
        </Alert>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography color='text.secondary'>Usable catalog versions</Typography>
              <Typography variant='h4'>{loading ? '…' : (catalog?.totals.availableVersions ?? 0)}</Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography color='text.secondary'>Local Host OS applications</Typography>
              <Typography variant='h4'>{loading ? '…' : (catalog?.totals.localApplications ?? 0)}</Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography color='text.secondary'>Assignable local releases</Typography>
              <Typography variant='h4'>{loading ? '…' : (catalog?.totals.localReleases ?? 0)}</Typography>
            </CardContent>
          </Card>
        </Stack>

        <Card>
          <CardContent>
            <Table size='small'>
              <TableHead>
                <TableRow>
                  <TableCell>Device type</TableCell>
                  <TableCell align='right'>Usable versions</TableCell>
                  <TableCell align='right'>Local applications</TableCell>
                  <TableCell align='right'>Local releases</TableCell>
                  <TableCell>Latest available</TableCell>
                  <TableCell>Latest local</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {catalog?.deviceTypes.map((deviceType) => (
                  <TableRow key={deviceType.id}>
                    <TableCell>{deviceType.slug}</TableCell>
                    <TableCell align='right'>{deviceType.availableVersions}</TableCell>
                    <TableCell align='right'>{deviceType.localApplications}</TableCell>
                    <TableCell align='right'>{deviceType.localReleases}</TableCell>
                    <TableCell>{deviceType.latestAvailable ?? 'Unavailable'}</TableCell>
                    <TableCell>{deviceType.latestLocal ?? 'Not synchronized'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Alert severity='info' sx={{ mt: 2 }}>
              Invalidated releases are excluded from catalog counts and version ordering. They are considered only when
              already reported by a device, and remain invalidated so they cannot be selected as another device&apos;s
              target.
            </Alert>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant='h6'>Synchronization</Typography>
              {balenaOsOrganization ? (
                <Alert severity='info'>
                  Catalog records will be synchronized into the required <strong>balena_os</strong> system organization.
                  Host OS releases remain available installation-wide and do not need to share an organization with a
                  device fleet.
                </Alert>
              ) : (
                <Alert severity='error'>
                  Create the <strong>balena_os</strong> system organization through your deployment&apos;s
                  administrative bootstrap and grant the signed-in administrator membership before synchronizing Host OS
                  releases.
                </Alert>
              )}
              <FormControl disabled={status.state === 'running' || loading}>
                <FormLabel>Versions to synchronize</FormLabel>
                <RadioGroup value={syncMode} onChange={(event) => setSyncMode(event.target.value as BalenaOsSyncMode)}>
                  <FormControlLabel value='latest-and-in-use' control={<Radio />} label='Latest + in use' />
                  <FormControlLabel value='newer-and-in-use' control={<Radio />} label='Newer than version + in use' />
                  <FormControlLabel value='in-use' control={<Radio />} label='Only versions in use' />
                  <FormControlLabel value='single' control={<Radio />} label='Single semantic version' />
                  <FormControlLabel value='all' control={<Radio />} label='All catalog versions' />
                </RadioGroup>
                <FormHelperText>{syncModeDescription[syncMode]}</FormHelperText>
                <FormHelperText>
                  On API v46.1+, every scope also maintains the latest usable release and local device-type metadata for
                  each allowlisted type. Device targets are not changed.
                </FormHelperText>
              </FormControl>
              {requiresVersion && (
                <TextField
                  label={syncMode === 'single' ? 'Semantic version' : 'Sync versions newer than'}
                  placeholder='6.5.0'
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  error={versionError}
                  helperText={
                    versionError
                      ? 'Enter a complete semantic version, for example 6.5.0 or 6.5.0+rev1.'
                      : syncMode === 'single'
                        ? 'Without build metadata, all matching revisions are included.'
                        : 'Currently used versions are included even when older than this threshold.'
                  }
                  disabled={status.state === 'running' || loading}
                  fullWidth
                />
              )}
              <Button
                variant='contained'
                startIcon={<SyncIcon />}
                disabled={!balenaOsOrganization || status.state === 'running' || loading || versionError}
                onClick={() => setConfirming(true)}
              >
                Sync BalenaOS catalog
              </Button>
              {status.state !== 'idle' && (
                <Box>
                  <Stack direction='row' justifyContent='space-between'>
                    <Typography>{status.phase}</Typography>
                    <Typography>
                      {status.processed} / {status.total}
                    </Typography>
                  </Stack>
                  <LinearProgress variant={status.total > 0 ? 'determinate' : 'indeterminate'} value={progress} />
                  <Typography variant='body2' color='text.secondary' sx={{ mt: 1 }}>
                    Created {status.created}, updated {status.updated}, unchanged {status.unchanged}
                  </Typography>
                  {status.mode && (
                    <Typography variant='body2' color='text.secondary'>
                      Mode: {syncModeDescription[status.mode]}
                      {status.version ? ` Threshold/version: ${status.version}.` : ''}
                    </Typography>
                  )}
                </Box>
              )}
              {status.state === 'failed' && <Alert severity='error'>{status.error}</Alert>}
              {status.state === 'completed' && (
                <Alert severity='success'>BalenaOS catalog synchronization completed.</Alert>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <ConfirmationDialog
        open={confirming}
        title='Synchronize BalenaOS catalog?'
        content={`${syncModeDescription[syncMode]} This imports or updates the selected public Host OS release graph for every allowlisted local device type. On API v46.1+, it also maintains the latest usable release and local config metadata for each type. Keep this server running until synchronization completes.`}
        confirmButtonText='Start sync'
        onClose={() => setConfirming(false)}
        onConfirm={startSync}
      />
    </Box>
  );
};

const balenaOs = {
  list: BalenaOsPage,
};

export default balenaOs;
