import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { IconButton, Tooltip } from '@mui/material';
import React, { useMemo } from 'react';
import type { ThemePreference } from './ThemeModeProvider';
import { useThemeMode } from './ThemeModeProvider';

const preferenceOrder: ThemePreference[] = ['system', 'dark', 'light'];

const preferenceConfig: Record<ThemePreference, { icon: React.ReactElement; label: string }> = {
  system: {
    icon: <BrightnessAutoIcon fontSize='inherit' />,
    label: 'Theme: System',
  },
  dark: {
    icon: <DarkModeIcon fontSize='inherit' />,
    label: 'Theme: Dark',
  },
  light: {
    icon: <LightModeIcon fontSize='inherit' />,
    label: 'Theme: Light',
  },
};

const ThemePreferenceToggle: React.FC = () => {
  const { preference, cyclePreference } = useThemeMode();

  const { icon, label } = useMemo(() => preferenceConfig[preference], [preference]);

  return (
    <Tooltip title={`${label}. Click to change`} enterDelay={300}>
      <IconButton color='inherit' onClick={cyclePreference} aria-label={`${label}. Click to change`}>
        {icon}
      </IconButton>
    </Tooltip>
  );
};

export { preferenceOrder };
export default ThemePreferenceToggle;
