import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import TerminalIcon from '@mui/icons-material/Terminal';
import { Alert, Box, GlobalStyles, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useAuthProvider } from 'react-admin';
import type { OpenBalenaAuthProvider } from '../authProvider/openbalenaAuthProvider';
import type { ResourceRecord } from '../types/resource';
import { RemoteTerminalTab, type TerminalStatus, type TerminalTarget } from './RemoteTerminalTab';
import { RemoteFileTransfer } from './RemoteFileTransfer';
import { deviceServiceTerminalTargets, getServiceColors } from '../lib/deviceServicePresentation';
import { useDeviceServicePresentation } from './useDeviceServicePresentation';
import { ServiceBadge } from './ServiceBadge';

interface BuiltInDeviceConnectProps {
  record: ResourceRecord;
}
interface SessionTab {
  id: number;
  status: TerminalStatus;
  label: string;
}

const Session: React.FC<{
  tab: SessionTab;
  active: boolean;
  token: string;
  deviceUuid: string;
  targets: TerminalTarget[];
  update: (id: number, status: TerminalStatus, label: string) => void;
}> = ({ tab, update, ...props }) => {
  const onStatus = React.useCallback(
    (status: TerminalStatus, label: string) => update(tab.id, status, label),
    [tab.id, update],
  );
  return <RemoteTerminalTab {...props} onStatus={onStatus} />;
};

export const BuiltInDeviceConnect: React.FC<BuiltInDeviceConnectProps> = ({ record }) => {
  const authProvider = useAuthProvider<OpenBalenaAuthProvider>();
  const presentation = useDeviceServicePresentation(record);
  const targets = deviceServiceTerminalTargets(presentation.services);
  const [tabs, setTabs] = React.useState<SessionTab[]>([{ id: 1, status: 'disconnected', label: 'Host OS' }]);
  const [active, setActive] = React.useState(1);
  const nextId = React.useRef(2);
  const [expanded, setExpanded] = React.useState(false);
  const token = authProvider?.getSession().jwt ?? '';
  const deviceUuid = typeof record.uuid === 'string' ? record.uuid : '';

  React.useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', escape);
    };
  }, [expanded]);
  const update = React.useCallback((id: number, status: TerminalStatus, label: string) => {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === id && (tab.status !== status || tab.label !== label) ? { ...tab, status, label } : tab,
      ),
    );
  }, []);
  const close = (id: number) => {
    const remaining = tabs.filter((tab) => tab.id !== id);
    if (!remaining.length) {
      const fresh = nextId.current++;
      setTabs([{ id: fresh, status: 'disconnected', label: 'Host OS' }]);
      setActive(fresh);
    } else {
      setTabs(remaining);
      if (active === id) setActive(remaining[remaining.length - 1].id);
    }
  };
  return (
    <Box
      data-remote-expanded={expanded}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        minWidth: 0,
        ...(expanded ? { position: 'fixed', inset: 0, zIndex: 1400, height: '100dvh' } : { minHeight: 490 }),
      }}
    >
      <GlobalStyles
        styles={{
          // React Admin's content is a stacking context below its app bar.
          '.RaLayout-content.RaLayout-content:has([data-remote-expanded="true"])': { zIndex: 1400 },
        }}
      />
      <Stack
        direction='row'
        alignItems='center'
        spacing={1}
        sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <TerminalIcon fontSize='small' />
        <Typography variant='subtitle2' sx={{ flex: 1 }}>
          Terminal · {String(record['device name'] ?? 'Unnamed device')}
        </Typography>
        <Tooltip title={expanded ? 'Collapse terminal' : 'Expand terminal'}>
          <IconButton
            size='small'
            aria-label={expanded ? 'Collapse terminal' : 'Expand terminal'}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <CloseFullscreenIcon fontSize='small' /> : <OpenInFullIcon fontSize='small' />}
          </IconButton>
        </Tooltip>
      </Stack>
      {presentation.error ? (
        <Alert severity='error'>Unable to load terminal targets: {presentation.error.message}</Alert>
      ) : null}
      <Stack direction='row' alignItems='center' sx={{ bgcolor: '#182330', px: 0.5 }}>
        <Box role='tablist' aria-label='Terminal sessions' sx={{ display: 'flex', overflowX: 'auto', flex: 1 }}>
          {tabs.map((tab, index) => {
            const color = getServiceColors(tab.label).backgroundColor;
            return (
              <Box
                key={tab.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  borderBottom: 2,
                  borderColor: active === tab.id ? color : 'transparent',
                  bgcolor: active === tab.id ? '#253446' : 'transparent',
                }}
              >
                <Box
                  component='button'
                  role='tab'
                  aria-selected={active === tab.id}
                  aria-controls={`terminal-panel-${tab.id}`}
                  id={`terminal-tab-${tab.id}`}
                  onClick={() => setActive(tab.id)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    p: 1,
                    border: 0,
                    bgcolor: 'transparent',
                    color,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    font: 'inherit',
                    fontSize: 13,
                  }}
                >
                  <Box
                    component='span'
                    title={tab.status}
                    aria-label={tab.status}
                    sx={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      bgcolor:
                        tab.status === 'connected' ? '#68d391' : tab.status === 'connecting' ? '#f6c45b' : '#718096',
                    }}
                  />
                  <ServiceBadge name={tab.label} /> · {index + 1}
                </Box>
                <IconButton
                  size='small'
                  aria-label={`Close terminal ${index + 1}`}
                  onClick={() => close(tab.id)}
                  sx={{ color: '#a8b6c5', mr: 0.5 }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            );
          })}
        </Box>
        <Tooltip title='Add terminal'>
          <IconButton
            size='small'
            aria-label='Add terminal'
            sx={{ color: '#a8b6c5' }}
            onClick={() => {
              const id = nextId.current++;
              setTabs((current) => [...current, { id, status: 'disconnected', label: 'Host OS' }]);
              setActive(id);
            }}
          >
            <AddIcon fontSize='small' />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ display: 'flex', flex: 1, minHeight: expanded ? 0 : 300 }}>
        {tabs.map((tab) => (
          <Box
            key={tab.id}
            role='tabpanel'
            id={`terminal-panel-${tab.id}`}
            aria-labelledby={`terminal-tab-${tab.id}`}
            hidden={active !== tab.id}
            sx={{ display: active === tab.id ? 'flex' : 'none', flex: 1, minHeight: 0 }}
          >
            <Session
              tab={tab}
              active={active === tab.id}
              token={token}
              deviceUuid={deviceUuid}
              targets={targets}
              update={update}
            />
          </Box>
        ))}
      </Box>
      <RemoteFileTransfer token={token} deviceUuid={deviceUuid} targets={targets} />
    </Box>
  );
};
export default BuiltInDeviceConnect;
