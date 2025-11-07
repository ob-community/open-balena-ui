import ContentCopy from '@mui/icons-material/ContentCopy';
import { Box, Tooltip, TooltipProps, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import React, { CSSProperties, useMemo, useState } from 'react';

interface CopyChipProps {
  style?: CSSProperties;
  title: string;
  label: string;
  placement?: TooltipProps['placement'];
}

const CopyChip: React.FC<CopyChipProps> = ({ style, title, label, placement = 'top' }) => {
  const [copied, setCopied] = useState(false);
  const theme = useTheme();

  const accentColor = theme.palette.mode === 'dark' ? theme.palette.info.light : theme.palette.error.main;
  const chipBackground = theme.palette.mode === 'dark' ? alpha(accentColor, 0.15) : alpha(accentColor, 0.1);
  const chipBorder = alpha(accentColor, theme.palette.mode === 'dark' ? 0.3 : 0.2);

  const isImage = useMemo(() => {
    if (title?.startsWith('data:image')) {
      return true;
    }

    if (title?.startsWith('http')) {
      const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];
      return extensions.some((ext) => title?.endsWith(ext));
    }

    return false;
  }, [title]);

  const tooltipContent = useMemo(() => {
    if (isImage) {
      return <img src={title} style={{ width: '100%', maxWidth: '150px' }} alt='' />;
    }

    if (title != label) {
      return title;
    }

    return '';
  }, [isImage, label, title]);

  if (!label) {
    return null;
  }

  return (
    <Box
      style={style}
      sx={{
        'display': 'flex',
        'alignItems': 'center',
        '.copy-icon': {
          visibility: 'hidden',
        },
        '&:hover .copy-icon': {
          visibility: 'visible',
        },
      }}
    >
      <Tooltip
        title={tooltipContent}
        placement={placement}
        arrow={true}
        classes={{
          tooltip: isImage ? 'isImage' : undefined,
        }}
      >
        <Box
          sx={{
            padding: '2px 6px',
            fontFamily: '"Ubuntu Mono", "Courier New", monospace !important',
            backgroundColor: chipBackground,
            color: accentColor,
            border: `1px solid ${chipBorder}`,
            borderRadius: '4px',
          }}
        >
          {label}
        </Box>
      </Tooltip>

      <Tooltip title={copied ? 'Copied' : ''} placement='top' arrow={true}>
        <ContentCopy
          className='copy-icon'
          sx={{ cursor: 'pointer', width: '13px', marginLeft: '4px', color: accentColor }}
          onClick={() => {
            navigator.clipboard.writeText(title);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        />
      </Tooltip>
    </Box>
  );
};

export default CopyChip;
