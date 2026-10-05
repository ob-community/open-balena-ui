import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Alert, Box, Button, MenuItem, Select, Stack, Typography } from '@mui/material';
import React from 'react';
import {
  encodeTerminalInput,
  remoteWebSocketUrl,
  responseError,
  type RemoteControlMessage,
  type RemoteSession,
} from '../lib/builtInRemoteAccess';
import { createTerminalDecoder } from '../lib/remoteAccessUi';
import { ServiceBadge } from './ServiceBadge';

export interface TerminalTarget {
  id: string;
  label: string;
  target: 'host' | 'container';
  container?: string;
}
export type TerminalStatus = 'disconnected' | 'connecting' | 'connected';

const terminalFontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

interface Props {
  active: boolean;
  token: string;
  deviceUuid: string;
  targets: TerminalTarget[];
  onStatus: (status: TerminalStatus, label: string) => void;
}

export const RemoteTerminalTab: React.FC<Props> = ({ active, token, deviceUuid, targets, onStatus }) => {
  const element = React.useRef<HTMLDivElement>(null);
  const terminal = React.useRef<Terminal | undefined>(undefined);
  const fit = React.useRef<FitAddon | undefined>(undefined);
  const socket = React.useRef<WebSocket | undefined>(undefined);
  const pending = React.useRef<AbortController | undefined>(undefined);
  const generation = React.useRef(0);
  const ready = React.useRef(false);
  const [status, setStatus] = React.useState<TerminalStatus>('disconnected');
  const [targetId, setTargetId] = React.useState('host');
  const [error, setError] = React.useState('');
  const selected = targets.find((target) => target.id === targetId) ?? targets[0];

  const stop = React.useCallback(() => {
    generation.current++;
    pending.current?.abort();
    pending.current = undefined;
    ready.current = false;
    const current = socket.current;
    socket.current = undefined;
    if (current) {
      current.onopen = current.onmessage = current.onerror = current.onclose = null;
      if (current.readyState === WebSocket.OPEN) {
        current.send(JSON.stringify({ v: 1, type: 'close', channel: 1 }));
      }
      current.close(1000, 'Terminal disconnected');
    }
  }, []);

  React.useEffect(() => {
    const instance = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 13,
      fontFamily: terminalFontFamily,
      theme: { background: '#111923', foreground: '#e5edf5' },
    });
    const addon = new FitAddon();
    instance.loadAddon(addon);
    instance.open(element.current!);
    terminal.current = instance;
    fit.current = addon;
    const fitVisible = () => {
      if (element.current && element.current.clientWidth > 0 && element.current.clientHeight > 0) addon.fit();
    };
    const observer = new ResizeObserver(fitVisible);
    observer.observe(element.current!);
    fitVisible();
    const input = instance.onData((data) => {
      if (ready.current && socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(encodeTerminalInput(1, data));
    });
    const resize = instance.onResize(({ cols, rows }) => {
      if (ready.current && socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ v: 1, type: 'resize', channel: 1, cols, rows }));
    });
    return () => {
      stop();
      observer.disconnect();
      input.dispose();
      resize.dispose();
      instance.dispose();
      terminal.current = undefined;
      fit.current = undefined;
    };
  }, [stop]);

  React.useEffect(() => {
    setStatus('disconnected');
    return stop;
  }, [deviceUuid, token, stop]);
  React.useEffect(() => onStatus(status, selected?.label ?? 'Host OS'), [status, selected?.label, onStatus]);
  React.useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      if (element.current?.clientWidth && element.current.clientHeight) fit.current?.fit();
      if (ready.current) terminal.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, status]);

  const connect = async () => {
    if (!token || !deviceUuid || !selected || pending.current || socket.current) return;
    stop();
    const attempt = generation.current;
    const controller = new AbortController();
    pending.current = controller;
    const currentAttempt = () => generation.current === attempt && !controller.signal.aborted;
    setError('');
    setStatus('connecting');
    terminal.current?.reset();
    try {
      const response = await fetch('/remote/session', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceUuid }),
        signal: controller.signal,
      });
      if (!response.ok) throw await responseError(response, 'Unable to create the remote session.');
      const session = (await response.json()) as RemoteSession;
      if (!currentAttempt()) return;
      const ws = new WebSocket(remoteWebSocketUrl());
      socket.current = ws;
      ws.binaryType = 'arraybuffer';
      const decode = createTerminalDecoder(1);
      const fail = (message: string) => {
        if (!currentAttempt()) return;
        setError(message);
        stop();
        setStatus('disconnected');
      };
      ws.onopen = () => {
        if (currentAttempt()) ws.send(JSON.stringify({ v: 1, type: 'auth', ticket: session.ticket }));
      };
      ws.onmessage = (event) => {
        if (!currentAttempt()) return;
        try {
          if (typeof event.data !== 'string') {
            terminal.current?.write(decode(event.data as ArrayBuffer));
            return;
          }
          const message = JSON.parse(event.data) as RemoteControlMessage;
          if (message.channel != null && message.channel !== 1) return;
          if (message.type === 'ready') {
            if (element.current?.clientWidth && element.current.clientHeight) fit.current?.fit();
            ws.send(
              JSON.stringify({
                v: 1,
                type: 'open',
                channel: 1,
                target: selected.target,
                ...(selected.container ? { container: selected.container } : {}),
                cols: terminal.current?.cols ?? 80,
                rows: terminal.current?.rows ?? 24,
              }),
            );
          } else if (message.type === 'opened') {
            ready.current = true;
            setStatus('connected');
          } else if (message.type === 'error') {
            fail(message.message ?? 'The terminal session failed.');
          } else if (message.type === 'exit' || message.type === 'closed') {
            terminal.current?.writeln(`\r\nSession ended${message.code == null ? '' : ` (${message.code})`}.`);
            stop();
            setStatus('disconnected');
          }
        } catch (failure) {
          fail(failure instanceof Error ? failure.message : 'Invalid terminal response.');
        }
      };
      ws.onerror = () => fail('The terminal connection failed.');
      ws.onclose = () => {
        if (!currentAttempt()) return;
        if (!ready.current) setError('The terminal connection closed before it was ready.');
        stop();
        setStatus('disconnected');
      };
    } catch (failure) {
      if (!currentAttempt()) return;
      setError(failure instanceof Error ? failure.message : 'Unable to connect.');
      stop();
      setStatus('disconnected');
    }
  };
  const action = () => {
    if (status === 'disconnected') void connect();
    else {
      stop();
      setStatus('disconnected');
    }
  };

  return (
    <Box sx={{ display: active ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {error && (
        <Alert severity='error' sx={{ borderRadius: 0 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ position: 'relative', flex: 1, minHeight: 100, bgcolor: '#111923' }}>
        <Box
          ref={element}
          sx={{
            'position': 'absolute',
            'inset': 0,
            'p': 1.5,
            'overflow': 'hidden',
            // The app baseline forces a proportional font on every element, including xterm's measurement spans.
            '& .xterm, & .xterm *': { fontFamily: `${terminalFontFamily} !important` },
          }}
        />
        {status !== 'connected' && (
          <Stack
            spacing={2}
            alignItems='center'
            justifyContent='center'
            sx={{ position: 'absolute', inset: 0, bgcolor: '#111923ee', color: '#e5edf5' }}
          >
            <Typography variant='subtitle1' fontWeight={600}>
              Start a terminal session
            </Typography>
            <Select
              size='small'
              value={selected?.id ?? ''}
              disabled={status === 'connecting'}
              onChange={(event) => setTargetId(event.target.value)}
              inputProps={{ 'aria-label': 'Terminal target' }}
              sx={{ 'width': 240, 'bgcolor': '#fff', 'color': '#111923', '& .MuiSelect-icon': { color: '#111923' } }}
            >
              {targets.map((target) => (
                <MenuItem key={target.id} value={target.id}>
                  <ServiceBadge name={target.label} />
                </MenuItem>
              ))}
            </Select>
            <Button size='small' variant='contained' onClick={action} disabled={!token || !deviceUuid}>
              {status === 'connecting' ? 'Cancel connection' : 'Start terminal'}
            </Button>
            {status === 'connecting' && <Typography variant='caption'>Connecting to {selected?.label}…</Typography>}
          </Stack>
        )}
      </Box>
    </Box>
  );
};
