import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';
import { useAuthProvider, useDataProvider, useNotify } from 'react-admin';
import type { DataProvider } from 'react-admin';
import type { OpenBalenaAuthProvider } from '../authProvider/openbalenaAuthProvider';
import {
  decodeTerminalOutput,
  encodeTerminalInput,
  remoteTransferUrl,
  remoteWebSocketUrl,
  responseError,
  type RemoteControlMessage,
  type RemoteSession,
} from '../lib/builtInRemoteAccess';
import type { ResourceRecord } from '../types/resource';

interface BuiltInDeviceConnectProps {
  record: ResourceRecord;
}

interface TerminalTarget {
  id: string;
  label: string;
  target: 'host' | 'container';
  container?: string;
}

interface SaveFilePicker {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{
    createWritable(): Promise<WritableStream<Uint8Array>>;
  }>;
}

const channelId = 1;

const bearerHeaders = (token: string, headers?: HeadersInit): Headers => {
  const result = new Headers(headers);
  result.set('Authorization', ['Bearer', token].join(' '));
  return result;
};

const suggestedFilename = (path: string): string => {
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'download';
};

export const BuiltInDeviceConnect: React.FC<BuiltInDeviceConnectProps> = ({ record }) => {
  const authProvider = useAuthProvider<OpenBalenaAuthProvider>();
  const dataProvider = useDataProvider<DataProvider>();
  const notify = useNotify();
  const theme = useTheme();
  const terminalElement = React.useRef<HTMLDivElement>(null);
  const terminal = React.useRef<Terminal | undefined>(undefined);
  const fitAddon = React.useRef<FitAddon | undefined>(undefined);
  const socket = React.useRef<WebSocket | undefined>(undefined);
  const connected = React.useRef(false);
  const [targets, setTargets] = React.useState<TerminalTarget[]>([{ id: 'host', label: 'host - SSH', target: 'host' }]);
  const [selectedTarget, setSelectedTarget] = React.useState('host');
  const [status, setStatus] = React.useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [error, setError] = React.useState('');
  const [uploadPath, setUploadPath] = React.useState('');
  const [uploadFile, setUploadFile] = React.useState<File>();
  const [downloadPath, setDownloadPath] = React.useState('');
  const [transferring, setTransferring] = React.useState(false);
  const transferAbort = React.useRef<AbortController | undefined>(undefined);
  const token = authProvider?.getSession().jwt ?? '';
  const deviceUuid = typeof record.uuid === 'string' ? record.uuid : '';

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const installs = await dataProvider.getList<ResourceRecord>('image install', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { device: record.id, status: 'Running' },
        });
        const containers = await Promise.all(
          installs.data.map(async (install): Promise<TerminalTarget | undefined> => {
            const images = await dataProvider.getList<ResourceRecord>('image', {
              pagination: { page: 1, perPage: 1 },
              sort: { field: 'id', order: 'ASC' },
              filter: { id: install['installs-image'] },
            });
            const services = await dataProvider.getList<ResourceRecord>('service', {
              pagination: { page: 1, perPage: 1 },
              sort: { field: 'id', order: 'ASC' },
              filter: { id: images.data[0]?.['is a build of-service'] },
            });
            const container = services.data[0]?.['service name'];
            return typeof container === 'string' && container
              ? {
                  id: `container:${String(install.id)}`,
                  label: `${container} - SSH`,
                  target: 'container',
                  container,
                }
              : undefined;
          }),
        );
        if (!cancelled) {
          setTargets([
            { id: 'host', label: 'host - SSH', target: 'host' },
            ...containers.filter((target): target is TerminalTarget => target !== undefined),
          ]);
        }
      } catch (loadError) {
        if (!cancelled) {
          notify(loadError instanceof Error ? loadError.message : 'Unable to load terminal targets', { type: 'error' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataProvider, notify, record.id]);

  React.useEffect(() => {
    if (!terminalElement.current) return;
    const instance = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme:
        theme.palette.mode === 'dark'
          ? { background: theme.palette.logs?.background ?? '#0d1a26', foreground: '#f5f5f5' }
          : { background: '#1e1e1e', foreground: '#f5f5f5' },
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(terminalElement.current);
    fit.fit();
    terminal.current = instance;
    fitAddon.current = fit;
    const input = instance.onData((data) => {
      if (socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(encodeTerminalInput(channelId, data));
      }
    });
    const resize = instance.onResize(({ cols, rows }) => {
      if (socket.current?.readyState === WebSocket.OPEN && connected.current) {
        socket.current.send(JSON.stringify({ v: 1, type: 'resize', channel: channelId, cols, rows }));
      }
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(terminalElement.current);
    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      instance.dispose();
      terminal.current = undefined;
      fitAddon.current = undefined;
    };
  }, [theme.palette.logs?.background, theme.palette.mode]);

  const disconnect = React.useCallback(() => {
    const current = socket.current;
    socket.current = undefined;
    connected.current = false;
    if (current?.readyState === WebSocket.OPEN) {
      current.send(JSON.stringify({ v: 1, type: 'close', channel: channelId }));
      current.close(1000, 'User disconnected');
    } else {
      current?.close();
    }
    setStatus('disconnected');
  }, []);

  React.useEffect(() => disconnect, [disconnect]);

  const connect = async (): Promise<void> => {
    if (!token || !deviceUuid || status !== 'disconnected') return;
    setError('');
    setStatus('connecting');
    terminal.current?.clear();
    terminal.current?.writeln('Connecting...');
    try {
      const response = await fetch('/remote/session', {
        method: 'POST',
        headers: bearerHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ deviceUuid }),
      });
      if (!response.ok) throw await responseError(response, 'Unable to create the remote session.');
      const session = (await response.json()) as RemoteSession;
      const webSocket = new WebSocket(remoteWebSocketUrl());
      webSocket.binaryType = 'arraybuffer';
      socket.current = webSocket;
      webSocket.onopen = () => webSocket.send(JSON.stringify({ v: 1, type: 'auth', ticket: session.ticket }));
      webSocket.onmessage = (event) => {
        void (async () => {
          if (typeof event.data !== 'string') {
            const output = await decodeTerminalOutput(event.data as ArrayBuffer);
            if (output.channel === channelId) terminal.current?.write(output.output);
            return;
          }
          const message = JSON.parse(event.data) as RemoteControlMessage;
          if (message.type === 'ready') {
            const selected = targets.find(({ id }) => id === selectedTarget) ?? targets[0];
            fitAddon.current?.fit();
            webSocket.send(
              JSON.stringify({
                v: 1,
                type: 'open',
                channel: channelId,
                target: selected.target,
                ...(selected.container ? { container: selected.container } : {}),
                cols: terminal.current?.cols ?? 80,
                rows: terminal.current?.rows ?? 24,
              }),
            );
          } else if (message.type === 'opened') {
            connected.current = true;
            setStatus('connected');
            terminal.current?.clear();
          } else if (message.type === 'error') {
            const messageText = message.message ?? 'The terminal session failed.';
            setError(messageText);
            terminal.current?.writeln(`\r\n${messageText}`);
            if (message.channel == null) {
              connected.current = false;
              setStatus('disconnected');
              webSocket.close(1011, 'Terminal open failed');
            }
          } else if (message.type === 'exit') {
            terminal.current?.writeln(`\r\nSession exited${message.code == null ? '' : ` with code ${message.code}`}.`);
          } else if (message.type === 'closed') {
            webSocket.close(1000, 'Terminal closed');
          }
        })().catch((messageError: unknown) => {
          setError(messageError instanceof Error ? messageError.message : 'Invalid terminal response.');
          webSocket.close(1002, 'Invalid response');
        });
      };
      webSocket.onerror = () => setError('The terminal WebSocket failed.');
      webSocket.onclose = () => {
        if (socket.current === webSocket) socket.current = undefined;
        connected.current = false;
        setStatus('disconnected');
      };
    } catch (connectError) {
      setStatus('disconnected');
      const message = connectError instanceof Error ? connectError.message : 'Unable to connect to the device.';
      setError(message);
      terminal.current?.writeln(`\r\n${message}`);
    }
  };

  const upload = async (): Promise<void> => {
    if (!token || !deviceUuid || !uploadFile || !uploadPath.trim()) return;
    const controller = new AbortController();
    transferAbort.current = controller;
    setTransferring(true);
    setError('');
    try {
      const response = await fetch(remoteTransferUrl('upload', deviceUuid, uploadPath.trim()), {
        method: 'PUT',
        headers: bearerHeaders(token),
        body: uploadFile,
        signal: controller.signal,
      });
      if (!response.ok) throw await responseError(response, 'Upload failed.');
      notify(`Uploaded ${uploadFile.name} to ${uploadPath.trim()}`, { type: 'success' });
    } catch (uploadError) {
      if (!controller.signal.aborted) {
        const message = uploadError instanceof Error ? uploadError.message : 'Upload failed.';
        setError(message);
        notify(message, { type: 'error' });
      }
    } finally {
      if (transferAbort.current === controller) transferAbort.current = undefined;
      setTransferring(false);
    }
  };

  const download = async (): Promise<void> => {
    if (!token || !deviceUuid || !downloadPath.trim()) return;
    const controller = new AbortController();
    transferAbort.current = controller;
    setTransferring(true);
    setError('');
    try {
      const response = await fetch(remoteTransferUrl('download', deviceUuid, downloadPath.trim()), {
        headers: bearerHeaders(token),
        signal: controller.signal,
      });
      if (!response.ok) throw await responseError(response, 'Download failed.');
      if (!response.body) throw new Error('The download response did not contain a stream.');
      const filename = suggestedFilename(downloadPath.trim());
      const picker = globalThis as typeof globalThis & SaveFilePicker;
      if (picker.showSaveFilePicker) {
        const handle = await picker.showSaveFilePicker({ suggestedName: filename });
        await response.body.pipeTo(await handle.createWritable(), { signal: controller.signal });
      } else {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      notify(`Downloaded ${downloadPath.trim()}`, { type: 'success' });
    } catch (downloadError) {
      if (!controller.signal.aborted) {
        const message = downloadError instanceof Error ? downloadError.message : 'Download failed.';
        setError(message);
        notify(message, { type: 'error' });
      }
    } finally {
      if (transferAbort.current === controller) transferAbort.current = undefined;
      setTransferring(false);
    }
  };

  return (
    <Stack spacing={1.5} sx={{ minHeight: 0, flex: 1 }}>
      {error && <Alert severity='error'>{error}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Select
          size='small'
          value={selectedTarget}
          disabled={status !== 'disconnected'}
          onChange={(event) => setSelectedTarget(event.target.value)}
          sx={{ minWidth: 220 }}
          aria-label='Terminal target'
        >
          {targets.map((target) => (
            <MenuItem key={target.id} value={target.id}>
              {target.label}
            </MenuItem>
          ))}
        </Select>
        <Button variant='contained' onClick={() => void connect()} disabled={status !== 'disconnected'}>
          {status === 'connecting' ? 'Connecting...' : 'Connect'}
        </Button>
        <Button variant='outlined' onClick={disconnect} disabled={status === 'disconnected'}>
          Disconnect
        </Button>
        <Typography sx={{ alignSelf: 'center' }} color='text.secondary'>
          {status}
        </Typography>
      </Stack>

      <Box
        ref={terminalElement}
        sx={{ minHeight: 300, flex: 1, backgroundColor: '#1e1e1e', p: 1, overflow: 'hidden' }}
      />

      {transferring && <LinearProgress />}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
        <Button component='label' variant='outlined' startIcon={<UploadIcon />} disabled={transferring}>
          {uploadFile?.name ?? 'Choose upload file'}
          <input hidden type='file' onChange={(event) => setUploadFile(event.target.files?.[0])} />
        </Button>
        <TextField
          size='small'
          label='Device target path'
          value={uploadPath}
          onChange={(event) => setUploadPath(event.target.value)}
          placeholder='/mnt/data/file.bin'
          disabled={transferring}
          sx={{ flex: 1 }}
        />
        <Button
          variant='contained'
          startIcon={<UploadIcon />}
          onClick={() => void upload()}
          disabled={transferring || !uploadFile || !uploadPath.trim()}
        >
          Upload
        </Button>
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
        <TextField
          size='small'
          label='Device source path'
          value={downloadPath}
          onChange={(event) => setDownloadPath(event.target.value)}
          placeholder='/mnt/data/file.bin'
          disabled={transferring}
          sx={{ flex: 1 }}
        />
        <Button
          variant='contained'
          startIcon={<DownloadIcon />}
          onClick={() => void download()}
          disabled={transferring || !downloadPath.trim()}
        >
          Download
        </Button>
        <Button
          variant='outlined'
          color='warning'
          onClick={() => transferAbort.current?.abort()}
          disabled={!transferring}
        >
          Cancel transfer
        </Button>
      </Stack>
    </Stack>
  );
};

export default BuiltInDeviceConnect;
