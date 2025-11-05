import React from 'react';
import { Box, Tooltip } from '@mui/material';
import { useRecordContext } from 'react-admin';
import TargetReleaseIcon from './TargetReleaseIcon';
import type { TargetReleaseOrigin } from '../lib/targetRelease';
import { getTargetOriginLabel } from '../lib/targetRelease';
import { getSemver } from './SemVerChip';

const EMPTY_RECORD: Record<string, any> = {};

interface TargetReleaseTooltipProps {
  origin: TargetReleaseOrigin;
  fallbackDetail?: string;
  children: React.ReactElement;
}

const TargetReleaseTooltip: React.FC<TargetReleaseTooltipProps> = ({ origin, fallbackDetail, children }) => {
  const releaseRecord = useRecordContext<Record<string, any>>(EMPTY_RECORD);
  const resolvedRecord: Record<string, any> | undefined = releaseRecord === EMPTY_RECORD ? undefined : releaseRecord;
  const detail = resolvedRecord ? getSemver(resolvedRecord) : (fallbackDetail ?? 'Tracking latest release');
  const commit = resolvedRecord?.commit;
  const detailLine = commit ? `${detail} (${String(commit).slice(0, 7)})` : detail;

  const title = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <TargetReleaseIcon origin={origin} fontSize='inherit' />
        <span>{getTargetOriginLabel(origin)}</span>
      </Box>
      <Box sx={{ fontSize: '0.7rem' }}>{detailLine}</Box>
    </Box>
  );

  return (
    <Tooltip placement='top' arrow={true} title={title}>
      {children}
    </Tooltip>
  );
};

export default TargetReleaseTooltip;
