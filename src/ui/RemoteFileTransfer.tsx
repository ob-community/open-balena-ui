import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import { Alert, Box, Button, LinearProgress, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import React from 'react';
import { remoteTransferUrl, responseError, type RemoteTarget } from '../lib/builtInRemoteAccess';
import { isAbsoluteDevicePath, isTransferCancellation, transferFilename } from '../lib/remoteAccessUi';
import { RemoteTargetSelect } from './RemoteTargetSelect';

interface SaveHandle {
  createWritable(): Promise<WritableStream<Uint8Array>>;
}
interface Picker {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveHandle>;
}
interface Props {
  token: string;
  deviceUuid: string;
  targets: RemoteTarget[];
}

export const RemoteFileTransfer: React.FC<Props> = ({ token, deviceUuid, targets }) => {
  const [mode, setMode] = React.useState<'upload' | 'download'>('upload');
  const [targetId, setTargetId] = React.useState('host');
  const selected = targets.find((target) => target.id === targetId);
  const [uploadPath, setUploadPath] = React.useState('');
  const [downloadPath, setDownloadPath] = React.useState('');
  const [file, setFile] = React.useState<File>();
  const [active, setActive] = React.useState(false);
  const [progress, setProgress] = React.useState<number>();
  const [bytes, setBytes] = React.useState(0);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const operation = React.useRef<AbortController | undefined>(undefined);
  React.useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = undefined;
    },
    [token, deviceUuid],
  );
  React.useEffect(() => {
    setActive(false);
  }, [token, deviceUuid]);

  const transfer = async () => {
    const path = (mode === 'upload' ? uploadPath : downloadPath).trim();
    if (
      operation.current ||
      !token ||
      !deviceUuid ||
      !selected ||
      !isAbsoluteDevicePath(path) ||
      (mode === 'upload' && !file)
    )
      return;
    const controller = new AbortController();
    operation.current = controller;
    const current = () => operation.current === controller && !controller.signal.aborted;
    setActive(true);
    setProgress(undefined);
    setBytes(0);
    setError('');
    setMessage('');
    try {
      // Invoke the picker before the first await, while the click's user activation is still available.
      const picker = globalThis as typeof globalThis & Picker;
      const handlePromise =
        mode === 'download' && picker.showSaveFilePicker
          ? picker.showSaveFilePicker({ suggestedName: transferFilename(path) })
          : undefined;
      if (mode === 'upload') {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const abort = () => xhr.abort();
          controller.signal.addEventListener('abort', abort, { once: true });
          xhr.open('PUT', remoteTransferUrl('upload', deviceUuid, path, selected.container));
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.upload.onprogress = (event) => {
            if (!current()) return;
            setBytes(event.loaded);
            setProgress(event.lengthComputable ? (event.loaded / event.total) * 100 : undefined);
          };
          const finish = (failure?: Error) => {
            controller.signal.removeEventListener('abort', abort);
            if (failure) reject(failure);
            else resolve();
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) finish();
            else {
              let text = `Upload failed (${xhr.status}).`;
              try {
                const body = JSON.parse(xhr.responseText) as { message?: unknown };
                if (typeof body.message === 'string') text = body.message;
              } catch {
                /* The endpoint may return a non-JSON error. */
              }
              finish(new Error(text));
            }
          };
          xhr.onerror = () => finish(new Error('Upload failed. Check your connection.'));
          xhr.onabort = () => finish(new DOMException('Cancelled', 'AbortError'));
          xhr.send(file!);
        });
      } else {
        const handle = handlePromise ? await handlePromise : undefined;
        if (!current()) return;
        const response = await fetch(remoteTransferUrl('download', deviceUuid, path, selected.container), {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw await responseError(response, 'Download failed.');
        if (!response.body) throw new Error('The download did not contain a stream.');
        const total = Number(response.headers.get('Content-Length'));
        let received = 0;
        const stream = response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, output) {
              received += chunk.byteLength;
              if (current()) {
                setBytes(received);
                setProgress(total > 0 ? Math.min(100, (received / total) * 100) : undefined);
              }
              output.enqueue(chunk);
            },
          }),
        );
        if (handle) {
          const writable = await handle.createWritable();
          await stream.pipeTo(writable, { signal: controller.signal });
        } else {
          const blob = await new Response(stream).blob();
          if (!current()) return;
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = transferFilename(path);
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
      if (current()) {
        setProgress(100);
        setMessage(
          mode === 'upload'
            ? `Uploaded ${file?.name} to ${selected.label}: ${path}`
            : `Downloaded ${selected.label}: ${path}`,
        );
      }
    } catch (failure) {
      if (operation.current === controller) {
        if (isTransferCancellation(failure, controller.signal)) setMessage('Transfer cancelled.');
        else setError(failure instanceof Error ? failure.message : 'File transfer failed.');
      }
    } finally {
      controller.abort();
      if (operation.current === controller) {
        operation.current = undefined;
        setActive(false);
      }
    }
  };
  const path = mode === 'upload' ? uploadPath : downloadPath;
  const invalid = !!path && !isAbsoluteDevicePath(path);
  return (
    <Box sx={{ borderTop: 1, borderColor: 'divider', px: 2, pb: 1.5, flexShrink: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} spacing={1} sx={{ pt: 1 }}>
        <Stack direction='row' alignItems='center' spacing={2} sx={{ flex: 1 }}>
          <Typography variant='subtitle2'>File transfer</Typography>
          <Tabs value={mode} onChange={(_, value: 'upload' | 'download') => setMode(value)} sx={{ minHeight: 40 }}>
            <Tab value='upload' label='Upload' disabled={active} sx={{ minHeight: 40, py: 1 }} />
            <Tab value='download' label='Download' disabled={active} sx={{ minHeight: 40, py: 1 }} />
          </Tabs>
        </Stack>
        <RemoteTargetSelect
          targets={targets}
          value={selected?.id ?? ''}
          onChange={(value) => {
            setTargetId(value);
            setError('');
            setMessage('');
            setProgress(undefined);
            setBytes(0);
          }}
          ariaLabel='File transfer target'
          label={mode === 'upload' ? 'Upload to' : 'Download from'}
          disabled={active}
          sx={{ minWidth: 180 }}
        />
      </Stack>
      {!selected && !active && (
        <Alert severity='warning'>The selected target is no longer running. Choose another target.</Alert>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-end' }} sx={{ mt: 1 }}>
        {mode === 'upload' && (
          <Button
            component='label'
            size='small'
            variant='outlined'
            disabled={active}
            sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            Choose file
            <input type='file' hidden onChange={(event) => setFile(event.target.files?.[0])} />
          </Button>
        )}
        <TextField
          size='small'
          fullWidth
          label={`Absolute ${selected?.target === 'container' ? 'container' : 'device'} ${mode === 'upload' ? 'target' : 'source'} path`}
          placeholder={selected?.target === 'container' ? '/tmp/file.bin' : '/mnt/data/file.bin'}
          value={path}
          disabled={active}
          error={invalid}
          helperText={invalid ? 'Enter an absolute path starting with /' : undefined}
          sx={{ 'minWidth': 0, '& .MuiFormLabel-root': { fontSize: 12, fontWeight: 500 } }}
          onChange={(event) =>
            mode === 'upload' ? setUploadPath(event.target.value) : setDownloadPath(event.target.value)
          }
        />
        <Button
          size='small'
          variant='contained'
          sx={{ flexShrink: 0 }}
          startIcon={mode === 'upload' ? <UploadIcon /> : <DownloadIcon />}
          disabled={
            active || !token || !deviceUuid || !selected || !isAbsoluteDevicePath(path) || (mode === 'upload' && !file)
          }
          onClick={() => void transfer()}
        >
          {mode === 'upload' ? 'Upload' : 'Download'}
        </Button>
        {active && (
          <Button
            size='small'
            color='warning'
            onClick={() => {
              operation.current?.abort();
              setMessage('Transfer cancelled.');
            }}
          >
            Cancel
          </Button>
        )}
      </Stack>
      {mode === 'upload' && file && (
        <Typography
          variant='caption'
          color='text.secondary'
          sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}
        >
          {file.name} · {file.size.toLocaleString()} bytes
        </Typography>
      )}
      {active && (
        <Box sx={{ mt: 1 }}>
          <LinearProgress variant={progress == null ? 'indeterminate' : 'determinate'} value={progress} />
          <Typography variant='caption' color='text.secondary'>
            {bytes.toLocaleString()} bytes transferred{progress == null ? '' : ` · ${Math.round(progress)}%`}
          </Typography>
        </Box>
      )}
      {mode === 'download' && !(globalThis as typeof globalThis & Picker).showSaveFilePicker && (
        <Typography variant='caption' color='text.secondary'>
          This browser saves downloads after receiving the file in browser memory.
        </Typography>
      )}
      {error && (
        <Alert severity='error' sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      {message && (
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1 }}>
          {message}
        </Typography>
      )}
    </Box>
  );
};
