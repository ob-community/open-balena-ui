import {
  AppBar as RaAppBar,
  AppBarProps,
  LoadingIndicator,
  SidebarToggleButton,
  TitlePortal,
  UserMenu,
} from 'react-admin';
import { Box, Toolbar, Typography } from '@mui/material';
import React from 'react';
import ThemePreferenceToggle from './ThemePreferenceToggle';

const AppHeader: React.FC<AppBarProps> = ({ userMenu, ...rest }) => {
  const resolvedUserMenu = userMenu === false ? null : React.isValidElement(userMenu) ? userMenu : <UserMenu />;

  return (
    <RaAppBar {...rest} toolbar={false} userMenu={false}>
      <Toolbar
        variant='dense'
        disableGutters
        sx={{
          minHeight: 60,
          gap: 1,
          px: 0,
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          flexGrow: 1,
        }}
      >
        <Box sx={{ ml: 2, display: 'flex' }}>
          <SidebarToggleButton />
        </Box>
        <TitlePortal />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            gap: 1,
            mr: 2,
            ml: 2,
          }}
        >
          <LoadingIndicator sx={{ color: 'inherit' }} />
          <ThemePreferenceToggle />
          {resolvedUserMenu}
        </Box>
      </Toolbar>
    </RaAppBar>
  );
};

export default AppHeader;
