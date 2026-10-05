import React from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { v4 as uuid } from 'uuid';
import type { DeviceActionRequest, PendingDeviceAction } from '../lib/deviceRefresh';

type Actions = Record<string, PendingDeviceAction[]>;
const key = ['device-refresh-actions'];

export const refreshDeviceStateQueries = (client: QueryClient, deviceId: number | string): void => {
  void client.invalidateQueries({ queryKey: ['device', 'getOne', { id: String(deviceId) }] });
  void client.invalidateQueries({
    predicate: (query) => {
      if (query.queryKey[0] !== 'image install') return false;
      const params = query.queryKey[2];
      if (!params || typeof params !== 'object') return false;
      const fields = params as Record<string, unknown>;
      if (fields.target === 'device' && String(fields.id) === String(deviceId)) return true;
      if (!fields.filter || typeof fields.filter !== 'object') return false;
      const filter = fields.filter as Record<string, unknown>;
      if (String(filter.device) === String(deviceId)) return true;
      const batch = filter['device@in'];
      const ids = Array.isArray(batch) ? batch : typeof batch === 'string' ? batch.replace(/[()]/g, '').split(',') : [];
      return ids.some((id) => String(id).trim() === String(deviceId));
    },
  });
};

export const useDeviceRefreshActions = () => {
  const client = useQueryClient();
  const { data: actions = {} } = useQuery<Actions>({
    queryKey: key,
    queryFn: async () => ({}),
    initialData: {},
    enabled: false,
    staleTime: Infinity,
  });
  const begin = React.useCallback(
    (request: DeviceActionRequest): string => {
      const action = { ...request, id: uuid(), startedAt: Date.now() };
      client.setQueryData<Actions>(key, (current = {}) => ({
        ...current,
        [String(request.deviceId)]: [...(current[String(request.deviceId)] ?? []), action],
      }));
      return action.id;
    },
    [client],
  );
  const change = React.useCallback(
    (id: string, acknowledge: boolean) => {
      client.setQueryData<Actions>(key, (current = {}) => {
        const next: Actions = {};
        for (const [device, entries] of Object.entries(current)) {
          const changed = acknowledge
            ? entries.map((action) => (action.id === id ? { ...action, acknowledgedAt: Date.now() } : action))
            : entries.filter((action) => action.id !== id);
          if (changed.length) next[device] = changed;
        }
        return next;
      });
    },
    [client],
  );
  const acknowledge = React.useCallback((id: string) => change(id, true), [change]);
  const cancel = React.useCallback((id: string) => change(id, false), [change]);
  const settle = React.useCallback(
    (deviceId: number | string, remaining: PendingDeviceAction[]) => {
      client.setQueryData<Actions>(key, (current = {}) => {
        const id = String(deviceId);
        if (
          (current[id] ?? []).length === remaining.length &&
          (current[id] ?? []).every((action, index) => action === remaining[index])
        )
          return current;
        const next = { ...current };
        if (remaining.length) next[id] = remaining;
        else delete next[id];
        return next;
      });
    },
    [client],
  );
  return { actions, begin, acknowledge, cancel, settle };
};
