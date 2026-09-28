import { Box } from '@mui/material';
import React from 'react';

interface EmbeddedFrameProps {
  id?: string;
  title?: string;
  src?: string;
  backgroundColor?: string;
  minHeight?: string | number;
}

export const EmbeddedFrame: React.FC<EmbeddedFrameProps> = ({
  id,
  title,
  src,
  backgroundColor,
  minHeight = '400px',
}) => (
  <Box
    sx={{
      flex: '1',
      display: 'flex',
      flexDirection: 'column',
      minHeight,
      backgroundColor,
    }}
  >
    {src && (
      <iframe
        id={id}
        title={title}
        src={src}
        height='100%'
        width='100%'
        style={{
          flex: '1',
          position: 'relative',
          border: 'none',
        }}
      />
    )}
  </Box>
);

export default EmbeddedFrame;
