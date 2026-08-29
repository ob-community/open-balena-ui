import React from 'react';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import PushPinIcon from '@mui/icons-material/PushPin';
import type { TargetReleaseOrigin } from '../lib/targetRelease';

interface TargetReleaseIconProps extends SvgIconProps {
  origin: TargetReleaseOrigin;
}

const TargetReleaseIcon: React.FC<TargetReleaseIconProps> = ({ origin, ...props }) => {
  switch (origin) {
    case 'device':
      return <PushPinIcon {...props} />;
    case 'fleet':
      return <AccountTreeIcon {...props} />;
    default:
      return <AutoModeIcon {...props} />;
  }
};

export default TargetReleaseIcon;
