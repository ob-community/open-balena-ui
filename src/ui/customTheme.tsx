import React from 'react';
import {
  LinearProgress,
  PaletteMode,
  PaletteOptions,
  ThemeOptions,
  createTheme,
  css,
  responsiveFontSizes,
} from '@mui/material';

const buttonBase = {
  defaultProps: {
    disableElevation: true,
    disableRipple: true,
    color: 'primary' as const,
    variant: 'contained' as const,
    size: 'large' as const,
  },
  styleOverrides: {
    root: {
      textTransform: 'none',
      fontWeight: 'bold',
      borderRadius: 5,
      transition: 'none',
      lineHeight: '1',
      paddingTop: '0',
      paddingBottom: 0,
    },
    sizeLarge: {
      fontSize: 17,
      letterSpacing: -0.5,
      height: 48,
    },
    sizeMedium: {
      fontSize: 14,
      height: 35,
    },
    sizeSmall: {
      fontSize: 12,
      height: 28,
    },
    iconSizeLarge: {
      '>svg': {
        position: 'relative',
        top: -0.5,
        fontSize: '24px !important',
      },
    },
    iconSizeMedium: {
      '&.MuiButton-startIcon': {
        marginRight: 6,
      },
      '>svg': {
        position: 'relative',
        top: 0.5,
        fontSize: '22px !important',
      },
    },
    iconSizeSmall: {
      '&.MuiButton-startIcon': {
        marginRight: 3,
      },
      '>svg': {
        position: 'relative',
        top: 1.2,
        fontSize: '20px !important',
      },
    },
  },
} as const;

const baseTypography: ThemeOptions['typography'] = {
  fontFamily:
    "NeueHansKendrick, system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif",
} as const;

const createLightPalette = (): PaletteOptions => ({
  mode: 'light',
  primary: {
    main: '#2a506f',
    light: '#4c7190',
    contrastText: '#ffffff',
  },
  secondary: {
    main: '#1496e1',
    light: '#33a7eb',
    contrastText: '#ffffff',
  },
  background: {
    default: '#f8f9fd',
    paper: '#ffffff',
  },
  chip: {
    background: '#c3efff',
    color: '#006387',
  },
  logs: {
    background: '#343434',
    text: {
      default: '#eeeeee',
      error: '#ee6666',
      warning: '#ffee66',
    },
  },
  text: {
    primary: '#23445e',
    secondary: '#4f6b84',
  },
  divider: '#e2e6f0',
});

const createDarkPalette = (): PaletteOptions => ({
  mode: 'dark',
  primary: {
    main: '#6eb8ff',
    light: '#8bcbff',
    contrastText: '#001422',
  },
  secondary: {
    main: '#3fc9ff',
    light: '#64d6ff',
    contrastText: '#001422',
  },
  background: {
    default: '#0d1a26',
    paper: '#142737',
  },
  chip: {
    background: '#1e3a52',
    color: '#a6d7ff',
  },
  logs: {
    background: '#0d1a26',
    text: {
      default: '#eeeeee',
      error: '#ee6666',
      warning: '#ffee66',
    },
  },
  text: {
    primary: '#e0f2ff',
    secondary: '#adc9df',
  },
  divider: '#1f3547',
});

const createCustomTheme = (mode: PaletteMode) => {
  const palette = mode === 'dark' ? createDarkPalette() : createLightPalette();

  let theme = createTheme({
    palette,
    typography: baseTypography,
  });

  const isDark = mode === 'dark';
  const cardHeaderBackground = isDark ? '#1c3245' : '#f2f4fa';
  const tableAlternateRow = isDark ? 'rgba(255, 255, 255, 0.04)' : '#f8f9fd';
  const tableHover = isDark ? 'rgba(110, 184, 255, 0.12)' : 'rgba(51, 219, 238, 0.07)';
  const toolbarBackground = isDark ? '#0f1f2c' : theme.palette.text.primary;
  const tooltipImageBackground = isDark ? '#142737' : '#ffffff';
  const tooltipImageBorder = isDark ? '1px solid rgba(160, 200, 255, 0.35)' : '1px solid rgba(97, 97, 97, 0.9)';
  const dialogSecondaryHover = isDark ? 'rgba(110, 184, 255, 0.15)' : 'rgba(42, 80, 111, 0.04)';
  const chipBackground = theme.palette.chip?.background ?? (isDark ? '#1e3a52' : '#c3efff');
  const chipColor = theme.palette.chip?.color ?? (isDark ? '#a6d7ff' : '#006387');
  const menuItemSelected =
    theme.palette.action?.hover ?? (isDark ? 'rgba(110, 184, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)');

  theme = createTheme(theme, {
    components: {
      MuiCssBaseline: {
        styleOverrides: css`
          * {
            font-family:
              NeueHansKendrick,
              system-ui,
              -apple-system,
              Segoe UI,
              Roboto,
              Ubuntu,
              Cantarell,
              Noto Sans,
              sans-serif,
              BlinkMacSystemFont,
              'Segoe UI',
              Roboto,
              'Helvetica Neue',
              Arial,
              'Noto Sans',
              sans-serif,
              'Apple Color Emoji',
              'Segoe UI Emoji',
              'Segoe UI Symbol',
              'Noto Color Emoji' !important;
          }

          html,
          body {
            padding: 0;
            margin: 0;
            line-height: 1.5;
            height: 100%;
            overflow: auto;
            background-color: ${theme.palette.background.default};
            color: ${theme.palette.text.primary};
          }

          .RaLayout-appFrame {
            margin-top: 60px !important;
          }

          #main-content {
            background: ${theme.palette.background.default} !important;
            padding: 15px !important;
            margin-left: 230px;
          }

          .RaShow-main,
          .RaCreate-main,
          .RaEdit-main {
            margin-top: 0 !important;
          }

          .edit-page,
          .create-page {
            height: 100%;
          }

          .RaCreate-main,
          .RaEdit-main {
            display: flex;
            width: 100%;
            align-items: center !important;
            justify-content: center !important;
            height: 100%;

            > div {
              padding: 30px;
              max-width: 800px;
            }
          }

          .RaList-noResults {
            display: flex;
            flex-direction: column;
            justify-content: center;
            height: 100vh;
          }

          .RaBulkActionsToolbar-toolbar {
            padding-left: 20px !important;
            padding-right: 15px !important;
            align-items: center !important;

            .MuiToolbar-root {
              min-height: 0 !important;
              padding: 0 !important;
            }
          }

          .RaList-actions {
            align-items: center !important;
            padding-left: 2px;

            .MuiToolbar-root {
              align-items: center !important;
              padding: 4px !important;
            }

            & > form {
              min-height: 0 !important;
              padding: 0 !important;

              .MuiFormControl-root {
                margin-top: 0 !important;
              }
            }
          }

          .RaCreate-main,
          .RaEdit-main {
            .MuiToolbar-root {
              min-height: 0 !important;
              padding: 16px !important;
              background: none !important;
            }

            .RaToolbar-defaultToolbar {
              display: flex;
              justify-content: flex-end !important;

              button {
                flex: 1;
              }

              .ra-delete-button {
                height: 48px;
                flex: 0.3;
                margin-left: 40px;
              }
            }
          }

          .RaDatagrid-tableWrapper {
            td {
              .MuiToolbar-root {
                background: none !important;
                min-height: 0 !important;
                padding: 0 !important;
                justify-content: flex-end !important;

                .MuiButtonBase-root {
                  min-width: 0 !important;
                  margin-left: 10px !important;
                }

                .MuiButton-icon,
                button > svg {
                  margin: 0 !important;
                }
              }
            }
          }

          .RaEditButton-root,
          [class$='RaButton-root'] {
            .MuiButton-icon {
              margin: 0 !important;

              svg {
                top: 0 !important;
              }
            }
          }

          .RaTabbedShowLayout-content {
            padding: 0 !important;
            margin-top: 30px !important;
          }

          .rdl-actions {
            margin: 0 15px !important;

            button {
              padding: 5px !important;
              margin: 0 !important;
              display: flex;
              align-items: center;
              margin-bottom: 1.5px !important;
              outline: none !important;
            }
          }
        `.styles,
      },

      MuiAppBar: {
        styleOverrides: {
          root: {
            'background': toolbarBackground,
            'color': isDark ? theme.palette.text.primary : '#ffffff',
            'border': 'none',
            'borderRadius': '0',
            'boxShadow': 'none',
            'height': '60px',
            'justifyContent': 'flex-start',
            'padding': 0,
            'marginLeft': '0 !important',
            'width': '100% !important',
            'left': 0,
            'right': 0,
            '& .MuiToolbar-root': {
              paddingLeft: '0 !important',
              paddingRight: '0 !important',
              width: '100%',
            },

            '.RaAppBar-menuButton': {
              display: 'none',
            },

            '#react-admin-title': {
              textAlign: 'center',
              fontWeight: 'bold',
              marginLeft: '230px',
              color: isDark ? theme.palette.text.primary : '#ffffff',
            },

            '[class$="RaLoadingIndicator-root"]': {
              position: 'relative',
              right: '25px',
            },
          },
        },
      },

      MuiCardHeader: {
        styleOverrides: {
          root: {
            backgroundColor: cardHeaderBackground,
          },
        },
      },

      MuiChip: {
        defaultProps: {
          size: 'small',
        },
        styleOverrides: {
          root: {
            'background': chipBackground,
            'border': 'none',

            '.MuiChip-label, .MuiChip-icon': {
              'color': `${chipColor}!important`,

              '&.MuiChip-labelSmall': {
                padding: '0 12px',
              },
            },
          },
        },
      },

      MuiButton: buttonBase,

      MuiLoadingButton: {
        ...buttonBase,
        defaultProps: {
          ...buttonBase.defaultProps,
          loadingIndicator: React.createElement(LinearProgress, { color: 'inherit' }),
        },
        styleOverrides: {
          ...buttonBase.styleOverrides,
          root: {
            ...buttonBase.styleOverrides.root,

            '.MuiLinearProgress-root': {
              width: '100%',
            },

            '.MuiLoadingButton-loadingIndicator': {
              width: '50%',
            },
          },
        },
      },

      MuiFormHelperText: {
        styleOverrides: {
          root: {
            marginLeft: 0,
            marginTop: 6,
            fontSize: 11,
          },
        },
      },

      MuiInputLabel: {
        defaultProps: {
          variant: 'outlined',
          disableAnimation: true,
          shrink: true,
        },
        styleOverrides: {
          root: {
            transform: 'none',
            fontWeight: 'bold',
            display: 'block',
            position: 'unset',
            lineHeight: 1,
            fontSize: 14,
            color: theme.palette.text.primary,
            marginBottom: 5,
          },
        },
      },

      MuiTextField: {
        defaultProps: {
          color: 'primary',
          variant: 'outlined',
        },
      },

      MuiOutlinedInput: {
        styleOverrides: {
          notchedOutline: {
            borderWidth: '1px !important',
            borderColor: theme.palette.text.disabled,
          },
          root: {
            'borderRadius': 5,
            'height': 48,
            'fontSize': 16,
            'lineHeight': 1,
            'background': theme.palette.background.paper,

            '&.MuiInputBase-multiline': {
              height: 'auto',
            },

            '.MuiInputAdornment-root': {
              color: theme.palette.text.disabled,
              marginRight: 4,
            },

            '&.Mui-focused .MuiInputAdornment-root': {
              color: theme.palette.primary.main,
            },

            'input': {
              padding: '14px 16px',
              fontSize: 16,
              height: 'auto',
            },

            '&.MuiInputBase-sizeSmall': {
              'height': 32,
              'lineHeight': 1,
              'fontSize': 14,

              'input': {
                padding: '7px 10px',
                fontSize: 14,
                height: 'auto',
              },

              '.MuiInputAdornment-root': {
                marginRight: 0,

                svg: {
                  width: 18,
                  height: 18,
                },
              },
            },

            'fieldset legend': {
              maxWidth: '0.01px !important',
            },

            '&.Mui-focused .MuiSelect-iconOutlined': {
              color: theme.palette.primary.main,
            },
          },
        },
      },

      MuiPaper: {
        styleOverrides: {
          root: {
            background: theme.palette.background.paper,
            borderRadius: 10,
            boxShadow: isDark ? 'rgba(0, 0, 0, 0.45) 0px 10px 30px -12px' : 'rgba(0, 0, 0, 0.1) 0px 0px 6px 0px',
            border: `1px solid ${theme.palette.divider}`,
            overflow: 'hidden',
          },
        },
      },

      MuiSelect: {
        defaultProps: {
          size: 'medium',
        },
        styleOverrides: {
          select: {
            minHeight: 0,
          },
        },
      },

      MuiMenuItem: {
        defaultProps: {
          disableRipple: true,
        },
        styleOverrides: {
          root: {
            '&.Mui-selected': {
              background: `${menuItemSelected}!important`,
            },
            '&[role="option"]': {
              paddingTop: 12,
              paddingBottom: 12,
            },
          },
        },
      },

      MuiLink: {
        styleOverrides: {
          root: {
            '&, *': {
              color: `${theme.palette.secondary.main}!important`,
            },
            '&:hover': {
              textDecoration: 'underline',
            },
          },
        },
      },

      MuiTable: {
        defaultProps: {
          size: 'medium',
        },
        styleOverrides: {
          root: {
            'borderColor': theme.palette.divider,

            'th': {
              textTransform: 'uppercase',
              fontSize: '12px',
              fontWeight: 'bold',
              backgroundColor: `${cardHeaderBackground}!important`,
            },

            'th, td': {
              border: 'none',
            },

            'tbody tr:nth-of-type(even)': {
              backgroundColor: tableAlternateRow,
            },

            'tr.MuiTableRow-hover:hover': {
              backgroundColor: `${tableHover}!important`,
            },
          },
        },
      },

      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            '&.isImage': {
              background: tooltipImageBackground,
              border: tooltipImageBorder,
              textAlign: 'center',
            },
          },
        },
      },

      MuiDialogContent: {
        styleOverrides: {
          root: {
            padding: '0 24px',
          },
        },
      },

      MuiDialogActions: {
        styleOverrides: {
          root: {
            'display': 'flex',
            'justifyContent': 'space-between',
            'padding': '30px 24px 20px',

            '&:not(.custom)': {
              '.MuiButton-root': {
                '&.MuiButton-containedPrimary': {
                  color: isDark ? theme.palette.text.primary : '#ffffff',
                },

                '&:first-of-type': {
                  'background': 'none',
                  'border': `1px solid ${theme.palette.primary.light}`,
                  'color': theme.palette.primary.main,

                  '&:hover': {
                    background: dialogSecondaryHover,
                    border: `1px solid ${theme.palette.primary.main}`,
                  },
                },

                '.MuiButton-icon': {
                  display: 'none',
                },
              },
            },
          },
        },
      },
    },
  } as Record<string, unknown>);

  return responsiveFontSizes(theme);
};

const customTheme = createCustomTheme('light');

export { createCustomTheme, customTheme };
export default createCustomTheme;
