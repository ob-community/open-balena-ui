import Chip, { ChipProps } from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import React from 'react';
import { RaRecord, useRecordContext } from 'react-admin';

export function getSemver(record: RaRecord | Record<string, any>): string {
  const major = record['semver major'] ?? '0';
  const minor = record['semver minor'] ?? '0';
  const patch = record['semver patch'] ?? '0';
  const prerelease = record['semver prerelease'] ?? '';
  const build = record['semver build'] ?? '';
  const revision = record['semver revision'] ?? '0';

  let versionLabel = [major, minor, patch].join('.');
  if (prerelease) {
    versionLabel += '-' + prerelease;
  } else if (build) {
    versionLabel += '+' + build;
  }
  if (revision !== '0') {
    versionLabel += `+rev${revision}`;
  }

  return versionLabel;
}

interface SemVerChipProps extends Omit<ChipProps, 'label'> {
  record?: RaRecord | Record<string, any> | null;
  showBlankOnNull?: boolean;
  withTooltip?: boolean;
}

const SemVerChip: React.FC<SemVerChipProps> = ({
  record: recordProp,
  showBlankOnNull = false,
  withTooltip = true,
  ...rest
}) => {
  const contextRecord = useRecordContext<RaRecord | Record<string, any>>();
  const record = recordProp ?? contextRecord;

  if (!record) {
    return showBlankOnNull ? null : <Chip label='Unknown' color='error' {...rest} />;
  }

  const semver = getSemver(record);
  const commit = record['commit'] ?? 'unknown commit';
  const chip = <Chip label={semver} size='small' {...rest} />;

  if (!withTooltip) {
    return chip;
  }

  return (
    <Tooltip title={commit} placement='top' arrow={true}>
      {chip}
    </Tooltip>
  );
};

export default SemVerChip;
