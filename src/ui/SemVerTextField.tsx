import Tooltip from '@mui/material/Tooltip';
import Typography, { TypographyProps } from '@mui/material/Typography';
import React from 'react';
import { RaRecord, useRecordContext, useTranslate } from 'react-admin';
import { getStringLength } from '../lib/common';
import { getSemver } from './SemVerChip';

interface SemVerTextFieldProps extends TypographyProps {
  record?: RaRecord | Record<string, any> | null;
  emptyText?: string;
  emptyCommitText?: string;
  label?: string;
}

const SemVerTextField: React.FC<SemVerTextFieldProps> = ({
  record: recordProp,
  emptyText = 'Unknown',
  emptyCommitText = 'unknown commit',
  label,
  ...rest
}) => {
  const translate = useTranslate();
  const contextRecord = useRecordContext<RaRecord | Record<string, any>>();
  const record = recordProp ?? contextRecord;

  if (!record) {
    return getStringLength(emptyText) > 0 ? (
      <Typography component='span' variant='body2' {...rest}>
        {translate(emptyText)}
      </Typography>
    ) : null;
  }

  const semver = getSemver(record);
  const commit = record['commit'] ?? translate(emptyCommitText);

  return (
    <Tooltip placement='top' arrow={true} title={commit}>
      <Typography component='span' variant='body2' {...rest}>
        {semver}
      </Typography>
    </Tooltip>
  );
};

export default SemVerTextField;
