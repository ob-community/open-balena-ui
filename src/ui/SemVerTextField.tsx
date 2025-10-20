import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useRecordContext, useTranslate } from 'react-admin';
import { getStringLength } from '../lib/common';
import { getSemver } from './SemVerChip';

const SemVerTextField = ({ style, record, emptyText = 'Unknown', emptyCommitText = 'unknown commit' }) => {
  const translate = useTranslate();
  if (!record) {
    record = useRecordContext();
  }

  if (!record) {
    return getStringLength(emptyText) > 0 ? (
      <Typography component='span' variant='body2'>
        {translate(emptyText)}
      </Typography>
    ) : null;
  }

  const semver = getSemver(record);
  const commit = record['commit'] ?? translate(emptyCommitText);

  return (
    <Tooltip placement='top' arrow={true} title={commit}>
      <Typography style={style} component='span' variant='body2'>
        {semver}
      </Typography>
    </Tooltip>
  );
};

export default SemVerTextField;
