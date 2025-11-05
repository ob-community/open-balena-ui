import ContentCopy from '@mui/icons-material/ContentCopy';
import { Box, Tooltip, TooltipProps } from '@mui/material';
import React, { CSSProperties, useMemo, useState } from 'react';

interface CopyChipProps {
  style?: CSSProperties;
  title: string;
  label: string;
  placement?: TooltipProps['placement'];
}

const CopyChip: React.FC<CopyChipProps> = ({ style, title, label, placement = 'top' }) => {
  const [copied, setCopied] = useState(false);

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
            backgroundColor: 'rgb(249, 242, 244)',
            color: 'rgb(199, 37, 78)',
          }}
        >
          {label}
        </Box>
      </Tooltip>

      <Tooltip title={copied ? 'Copied' : ''} placement='top' arrow={true}>
        <ContentCopy
          className='copy-icon'
          sx={{ cursor: 'pointer', width: '13px', marginLeft: '4px' }}
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
