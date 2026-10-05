import React from 'react';
import { TableRow, type TableRowProps } from '@mui/material';
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import {
  DatagridRow,
  type DatagridRowProps,
  type Identifier,
  type GetListResult,
  useDataProvider,
  useGetMany,
  useListContext,
} from 'react-admin';
import {
  activeDeviceRefreshMs,
  isDeviceRefreshActive,
  settleDeviceActions,
  steadyDeviceRefreshMs,
} from '../lib/deviceRefresh';
import { relationshipId } from '../lib/deviceServicePresentation';
import type { ResourceRecord } from '../types/resource';
import { useDeviceRefreshActions } from './useDeviceRefreshActions';

type InstallSnapshot = {
  records: ResourceRecord[];
  updatedAt: number;
  requestedAt: number;
  complete: boolean;
};
type InstallBatch = { records: ResourceRecord[]; requestedAt: number };

export const acceptDeviceInstallBatch = (
  current: Record<string, InstallSnapshot>,
  deviceIds: Identifier[],
  batch: InstallBatch,
  updatedAt: number,
  complete: boolean,
): Record<string, InstallSnapshot> => {
  const next = { ...current };
  let changed = false;
  for (const id of deviceIds) {
    const key = String(id);
    const previous = current[key];
    if (
      previous &&
      (previous.requestedAt > batch.requestedAt ||
        (previous.requestedAt === batch.requestedAt && (previous.complete || !complete)))
    )
      continue;
    next[key] = {
      records: batch.records.filter((record) => String(relationshipId(record.device)) === key),
      updatedAt,
      requestedAt: batch.requestedAt,
      complete,
    };
    changed = true;
  }
  return changed ? next : current;
};
type RefreshContext = {
  installs: Record<string, InstallSnapshot>;
  visible: (id: Identifier, visible: boolean) => void;
};
const Context = React.createContext<RefreshContext | undefined>(undefined);
const emptyInstalls: ResourceRecord[] = [];

export const useDeviceListImageInstalls = (id?: Identifier): ResourceRecord[] =>
  React.useContext(Context)?.installs[String(id)]?.records ?? emptyInstalls;

const useVisibleRow = (id?: Identifier) => {
  const context = React.useContext(Context);
  const visible = context?.visible;
  const [element, setElement] = React.useState<HTMLTableRowElement | null>(null);
  React.useEffect(() => {
    if (!element || id == null || !visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      visible(id, true);
      return () => visible(id, false);
    }
    const observer = new IntersectionObserver(([entry]) => visible(id, entry.isIntersecting));
    observer.observe(element);
    return () => {
      observer.disconnect();
      visible(id, false);
    };
  }, [element, id, visible]);
  return setElement;
};

export const VisibleDeviceDatagridRow = (props: DatagridRowProps) => {
  const ref = useVisibleRow(props.id);
  return <DatagridRow {...props} ref={ref} />;
};

export const VisibleDeviceTableRow = ({ deviceId, ...props }: TableRowProps & { deviceId: Identifier }) => {
  const ref = useVisibleRow(deviceId);
  return <TableRow {...props} ref={ref} />;
};

// Never add, remove, or reorder records: the next list request owns filter membership.
export const mergeDeviceRows = (
  rows: ResourceRecord[],
  fresh: ResourceRecord[],
  authoritative = false,
): ResourceRecord[] => {
  const byId = new Map(fresh.map((record) => [String(record.id), record]));
  let changed = false;
  const next = rows.map((record) => {
    const update = byId.get(String(record.id));
    if (
      !update ||
      (Object.keys(update).every((field) => Object.is(record[field], update[field])) &&
        (!authoritative || Object.keys(record).length === Object.keys(update).length))
    )
      return record;
    changed = true;
    return authoritative ? update : { ...record, ...update };
  });
  return changed ? next : rows;
};

export const applyDeviceRowRefresh = (
  client: QueryClient,
  listKey: QueryKey,
  fresh: ResourceRecord[],
  sourceIds: Identifier[],
) => {
  // getMany returns full records; omitted old status fields must not survive.
  client.setQueryData<GetListResult<ResourceRecord>>(listKey, (current) => {
    if (!current) return current;
    const next = mergeDeviceRows(current.data, fresh, true);
    return next === current.data ? current : { ...current, data: next };
  });
  client.setQueriesData<ResourceRecord>({ queryKey: ['device', 'getOne'] }, (current) =>
    current ? mergeDeviceRows([current], fresh, true)[0] : current,
  );
  client.setQueriesData<ResourceRecord[]>(
    {
      queryKey: ['device', 'getMany'],
      predicate: (query) =>
        JSON.stringify((query.queryKey[2] as { ids?: string[] })?.ids) !== JSON.stringify(sourceIds.map(String)),
    },
    (current) => (current ? mergeDeviceRows(current, fresh, true) : current),
  );
};

const activityStatuses = '(Downloading,Downloaded,Installing,Installed,Starting,Stopping,configuring)';

const DeviceListRefresh: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { data = [], page, perPage, sort, filterValues } = useListContext<ResourceRecord>();
  const provider = useDataProvider();
  const client = useQueryClient();
  const { actions, settle } = useDeviceRefreshActions();
  const [visibleIds, setVisibleIds] = React.useState<Set<string>>(() => new Set());
  const [installs, setInstalls] = React.useState<Record<string, InstallSnapshot>>({});
  const deviceSnapshots = React.useRef<Record<string, { record: ResourceRecord; updatedAt: number }>>({});
  const visible = React.useCallback((id: Identifier, isVisible: boolean) => {
    setVisibleIds((current) => {
      const key = String(id);
      if (current.has(key) === isVisible) return current;
      const next = new Set(current);
      if (isVisible) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const rows = data.filter((record) => visibleIds.has(String(record.id)));
  const ids = rows.map((record) => record.id).sort((a, b) => String(a).localeCompare(String(b)));
  const busyIds = rows
    .filter(
      (record) =>
        actions[String(record.id)]?.length || isDeviceRefreshActive(record, installs[String(record.id)]?.records),
    )
    .map((record) => record.id)
    .sort((a, b) => String(a).localeCompare(String(b)));
  const activeDevices = useGetMany<ResourceRecord>(
    'device',
    { ids: busyIds },
    {
      enabled: busyIds.length > 0,
      refetchInterval: activeDeviceRefreshMs,
      refetchIntervalInBackground: false,
    },
  );

  const fetchInstalls = async (deviceIds: Identifier[], activeOnly: boolean, signal: AbortSignal) => {
    const requestedAt = Date.now();
    const records: ResourceRecord[] = [];
    for (let page = 1; ; page++) {
      const result = await provider.getList<ResourceRecord>('image install', {
        pagination: { page, perPage: 1000 },
        sort: { field: 'id', order: 'ASC' },
        filter: {
          'device@in': `(${deviceIds.join(',')})`,
          'select@': 'id,device,status,download progress,is provided by-release,installs-image',
          ...(activeOnly ? { 'status@in': activityStatuses } : {}),
        },
        ...(provider.supportAbortSignal ? { signal } : {}),
      });
      records.push(...result.data);
      if (result.data.length < 1000 || (result.total != null && records.length >= result.total))
        return { records, requestedAt };
    }
  };
  const fallback = useQuery({
    queryKey: ['device-list-activity', { ids, activeOnly: true }],
    queryFn: ({ signal }) => fetchInstalls(ids, true, signal),
    enabled: ids.length > 0,
    refetchInterval: steadyDeviceRefreshMs,
    refetchIntervalInBackground: false,
  });
  const activeInstalls = useQuery({
    queryKey: ['device-list-activity', { ids: busyIds, activeOnly: false }],
    queryFn: ({ signal }) => fetchInstalls(busyIds, false, signal),
    enabled: busyIds.length > 0,
    refetchInterval: activeDeviceRefreshMs,
    refetchIntervalInBackground: false,
  });
  const acceptInstalls = React.useCallback(
    (deviceIds: Identifier[], batch: InstallBatch, updatedAt: number, complete: boolean) => {
      setInstalls((current) => acceptDeviceInstallBatch(current, deviceIds, batch, updatedAt, complete));
    },
    [],
  );
  const idsKey = JSON.stringify(ids);
  const busyIdsKey = JSON.stringify(busyIds);
  React.useEffect(() => {
    if (fallback.data && !fallback.isFetching && !fallback.error)
      acceptInstalls(JSON.parse(idsKey), fallback.data, fallback.dataUpdatedAt, false);
  }, [fallback.data, fallback.dataUpdatedAt, fallback.isFetching, fallback.error, idsKey, acceptInstalls]);
  React.useEffect(() => {
    if (activeInstalls.data && !activeInstalls.isFetching && !activeInstalls.error)
      acceptInstalls(JSON.parse(busyIdsKey), activeInstalls.data, activeInstalls.dataUpdatedAt, true);
  }, [
    activeInstalls.data,
    activeInstalls.dataUpdatedAt,
    activeInstalls.isFetching,
    activeInstalls.error,
    busyIdsKey,
    acceptInstalls,
  ]);

  const listKey = JSON.stringify([
    'device',
    'getList',
    {
      pagination: { page, perPage },
      sort,
      filter: filterValues,
    },
  ]);
  const applied = React.useRef(0);
  React.useEffect(() => {
    if (
      !activeDevices.data ||
      activeDevices.isFetching ||
      activeDevices.error ||
      activeDevices.isPlaceholderData ||
      activeDevices.dataUpdatedAt <= applied.current
    )
      return;
    applied.current = activeDevices.dataUpdatedAt;
    const fresh = activeDevices.data;
    for (const record of fresh)
      deviceSnapshots.current[String(record.id)] = { record, updatedAt: activeDevices.dataUpdatedAt };
    applyDeviceRowRefresh(client, JSON.parse(listKey), fresh, busyIds);
  }, [
    activeDevices.data,
    activeDevices.dataUpdatedAt,
    activeDevices.isFetching,
    activeDevices.error,
    activeDevices.isPlaceholderData,
    client,
    listKey,
    busyIdsKey,
  ]);

  React.useEffect(() => {
    for (const record of rows) {
      const pending = actions[String(record.id)];
      if (!pending?.length) continue;
      const snapshot = installs[String(record.id)];
      const deviceSnapshot = deviceSnapshots.current[String(record.id)];
      const device = deviceSnapshot?.record ?? record;
      settle(
        record.id,
        settleDeviceActions(
          pending,
          device,
          snapshot?.records ?? [],
          {
            device: deviceSnapshot?.updatedAt ?? 0,
            // A status-filtered fallback cannot prove that a stopped install was removed.
            installs: snapshot?.complete ? snapshot.updatedAt : 0,
          },
          { appReleaseId: relationshipId(device['should be running-release']) },
        ),
      );
    }
  }, [data, visibleIds, actions, installs, settle, activeDevices.dataUpdatedAt, activeDevices.isFetching]);

  const value = React.useMemo(() => ({ installs, visible }), [installs, visible]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
};

export default DeviceListRefresh;
