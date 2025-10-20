/** Originally from:
 * https://github.com/BigBasket/ra-components/pull/23
 *
 * But, updated to @mui/system
 * ... until ra-components updates to not use @mui/styled
 */
import ExpandMore from '@mui/icons-material/ExpandMore';
import Collapse from '@mui/material/Collapse';
import List from '@mui/material/List';
import ListItemIcon from '@mui/material/ListItemIcon';
import MenuItem from '@mui/material/MenuItem';
import { styled } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import classnames from 'classnames';
import React, { Fragment } from 'react';
import { useTranslate } from 'react-admin';

const PREFIX = 'RaTreeCustomMenuItem';

const classes = {
  icon: `${PREFIX}-icon`,
  sidebarIsOpen: `${PREFIX}-sidebarIsOpen`,
  sidebarIsClosed: `${PREFIX}-sidebarIsClosed`,
  menuItem: `${PREFIX}-menuItem`,
  menuItemName: `${PREFIX}-menuItemName`,
  openMenuItem: `${PREFIX}-openMenuItem`,
};

const StyledCustomMenuItem = styled('div')(({ theme }) => ({
  [`& .${classes.icon}`]: { minWidth: theme.spacing(5) },

  [`& .${classes.sidebarIsOpen}`]: {
    '& a': {
      paddingLeft: theme.spacing(3),
      transition: 'padding-left 195ms cubic-bezier(0.4, 0, 0.6, 1) 0ms',
    },
  },

  [`& .${classes.sidebarIsClosed}`]: {
    '& a': {
      paddingLeft: theme.spacing(2),
      transition: 'padding-left 195ms cubic-bezier(0.4, 0, 0.6, 1) 0ms',
    },
  },

  [`& .${classes.menuItem}`]: {},

  [`& .${classes.menuItemName}`]: {
    color: theme.palette.secondary,
  },

  [`& .${classes.openMenuItem}`]: {},
}));

const CustomMenuItem = ({ handleToggle, sidebarIsOpen, isOpen, name, icon, children, dense, setMenuColors }) => {
  const translate = useTranslate();

  const header = (
    <MenuItem
      key={name}
      dense={dense}
      onClick={handleToggle}
      className={classnames(classes.menuItem, {
        [classes.openMenuItem]: isOpen,
      })}
    >
      <ListItemIcon className={classes.icon}>{isOpen ? <ExpandMore /> : icon}</ListItemIcon>
      <Typography
        variant='inherit'
        color={setMenuColors ? 'primary.main' : ''}
        className={classnames(classes.menuItemName, 'menuItemName')}
      >
        {translate(name)}
      </Typography>
    </MenuItem>
  );

  return (
    <StyledCustomMenuItem>
      <Fragment>
        {sidebarIsOpen || isOpen ? (
          header
        ) : (
          <Tooltip title={translate(name)} placement='right'>
            {header}
          </Tooltip>
        )}
        <Collapse in={isOpen} timeout='auto' unmountOnExit>
          <List
            dense={dense}
            component='div'
            disablePadding
            className={sidebarIsOpen ? classes.sidebarIsOpen : classes.sidebarIsClosed}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'left',
            }}
          >
            {children}
          </List>
        </Collapse>
      </Fragment>
    </StyledCustomMenuItem>
  );
};

export default CustomMenuItem;
