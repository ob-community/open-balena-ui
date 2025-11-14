import React from 'react';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import SwitchAccessShortcutIcon from '@mui/icons-material/SwitchAccessShortcut';
import type { TargetReleaseOrigin } from '../lib/targetRelease';

interface TargetReleaseIconProps extends SvgIconProps {
  origin: TargetReleaseOrigin;
}

const TargetReleaseIcon: React.FC<TargetReleaseIconProps> = ({ origin, ...props }) => {
  switch (origin) {
    case 'device':
      return <PushPinIcon {...props} />;
    case 'fleet':
      return <PushPinOutlinedIcon {...props} />;
    default:
      return <SwitchAccessShortcutIcon {...props} />;
  }
};

export default TargetReleaseIcon;
