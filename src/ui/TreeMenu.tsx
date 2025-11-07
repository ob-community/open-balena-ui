/** Copied from:
 * https://github.com/BigBasket/ra-components/pull/23
 *
 * But, updated to @mui/system
 * ... until ra-components updates to not use @mui/styled
 */
import LabelIcon from '@mui/icons-material/Label';
import DefaultIcon from '@mui/icons-material/ViewList';
import { styled } from '@mui/material/styles';
import classnames from 'classnames';
import React, { useState } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { DashboardMenuItem, MenuItemLink, useResourceDefinitions, useSidebarState, useTranslate } from 'react-admin';
import CustomMenuItem from './CustomMenuItem';
import logo from '../logo.svg';

const PREFIX = 'RaTreeMenu';

const classes = {
  main: `${PREFIX}-main`,
  open: `${PREFIX}-open`,
  closed: `${PREFIX}-closed`,
};

const StyledMenu = styled('div')(({ theme }) => {
  const isDark = theme.palette.mode === 'dark';
  const backgroundColor = isDark ? theme.palette.background.paper : theme.palette.text.primary;
  const primaryText = isDark ? theme.palette.text.primary : '#ffffff';
  const mutedText = isDark ? theme.palette.text.secondary : 'rgba(255,255,255,0.7)';
  const hoverColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const activeColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.2)';

  return {
    'background': backgroundColor,
    'position': 'fixed',
    'left': 0,
    'top': 0,
    'bottom': 0,
    'width': 230,
    'zIndex': 1101,

    'li, a': {
      'color': primaryText,
      'paddingTop': '12px',
      'paddingBottom': '12px',

      '&.RaMenuItemLink-active': {
        'fontWeight': 'bold',
        'color': primaryText,
        'background': `${activeColor} !important`,

        '.MuiListItemIcon-root': {
          color: primaryText,
        },
      },

      '&:hover': {
        background: hoverColor,
      },
    },

    '.MuiListItemIcon-root': {
      color: mutedText,
    },

    [`& .${classes.main}`]: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
    },
  };
});

interface TreeMenuProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  dense?: boolean;
  hasDashboard?: boolean;
  onMenuClick?: (event?: unknown) => void;
  logout?: ReactNode;
  dashboardlabel?: string;
  setMenuColors?: boolean;
}

const TreeMenu: React.FC<TreeMenuProps> = (props) => {
  const {
    className,
    dense,
    hasDashboard,
    onMenuClick = () => null,
    logout,
    dashboardlabel = 'Dashboard',
    setMenuColors = true,
    ...rest
  } = props;

  const translate = useTranslate();
  const [open] = useSidebarState();
  const pathname = window.location.hash;
  let allResources = useResourceDefinitions();
  const resources = Object.keys(allResources).map((name) => allResources[name]);
  const hasList = (resource) => resource.hasList;

  const handleToggle = (parent) => {
    setState((state) => ({ [parent]: !state[parent] }));
  };

  const isParent = (resource) => !!resource?.options?.isMenuParent;

  const isOrphan = (resource) =>
    !resource?.options?.hasOwnProperty?.('menuParent') && !resource?.options?.hasOwnProperty?.('isMenuParent');

  const isChildOfParent = (resource, parentResource) => resource?.options?.menuParent == parentResource?.name;

  const getResourceName = (slug) => {
    if (!slug) {
      return '';
    }

    var words = slug.toString().split('_');

    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      words[i] = word.charAt(0).toUpperCase() + word.slice(1);
    }

    return words.join(' ');
  };

  const getPrimaryTextForResource = (resource) => {
    let resourcename = '';

    if (resource?.options?.label) {
      resourcename = resource.options.label;
    } else if (resource?.name) {
      resourcename = translate(`resources.${resource.name}.name`);

      if (resourcename.startsWith('resources.')) {
        resourcename = getResourceName(resource.name);
      }
    }

    return resourcename;
  };

  const MenuItem = (resource) => (
    <MenuItemLink
      key={resource.name}
      to={`/${encodeURIComponent(resource.name)}`}
      primaryText={getPrimaryTextForResource(resource)}
      leftIcon={resource.icon ? <resource.icon /> : <DefaultIcon />}
      onClick={onMenuClick}
      dense={dense}
      sidebarIsOpen={open}
    />
  );

  const mapParentStack = (parentResource) => {
    return (
      <CustomMenuItem
        key={parentResource.name}
        handleToggle={() => handleToggle(parentResource.name)}
        isOpen={state[parentResource.name] || parentActiveResName === parentResource.name}
        sidebarIsOpen={open}
        name={getPrimaryTextForResource(parentResource)}
        icon={parentResource.icon ? <parentResource.icon /> : <LabelIcon />}
        dense={dense}
        setMenuColors={false}
      >
        {
          // eslint-disable-next-line
          resources
            .filter((resource) => isChildOfParent(resource, parentResource) && hasList(resource))
            .map((childResource) => {
              return MenuItem(childResource);
            })
        }
      </CustomMenuItem>
    );
  };

  const mapIndependent = (independentResource) => hasList(independentResource) && MenuItem(independentResource);

  const initialExpansionState = {};

  let parentActiveResName = null;

  resources?.forEach((resource) => {
    if (isParent(resource)) {
      initialExpansionState[resource.name] = false;
    } else if (
      pathname.startsWith(`#/${encodeURIComponent(resource.name)}`) &&
      resource?.options?.hasOwnProperty?.('menuParent')
    ) {
      parentActiveResName = resource.options.menuParent;
    }
  });

  const [state, setState] = useState(initialExpansionState);
  const resRenderGroup: React.ReactNode[] = [];

  resources &&
    resources.length > 0 &&
    resources.forEach((resource) => {
      if (isParent(resource)) resRenderGroup.push(mapParentStack(resource));
      if (isOrphan(resource)) resRenderGroup.push(mapIndependent(resource));
    });

  return (
    <StyledMenu>
      <img src={logo} className='logo' style={{ margin: '10px 12px 6px' }} alt='Open Balena' />

      <div
        className={classnames(classes.main, className, {
          [classes.open]: open,
          [classes.closed]: !open,
        })}
        {...rest}
      >
        <DashboardMenuItem onClick={onMenuClick} dense={dense} sidebarIsOpen={open} primaryText={dashboardlabel} />
        {resRenderGroup}
      </div>
    </StyledMenu>
  );
};

export default TreeMenu;
