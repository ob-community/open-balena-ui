import { Box } from '@mui/material';
import React from 'react';

interface EmbeddedFrameProps {
  id?: string;
  title?: string;
  src?: string;
  srcDoc?: string;
  backgroundColor?: string;
  minHeight?: string | number;
}

export const EmbeddedFrame: React.FC<EmbeddedFrameProps> = ({
  id,
  title,
  src,
  srcDoc,
  backgroundColor,
  minHeight = '400px'
}) => (
  <Box sx={{
    flex: '1',
    display: 'flex',
    flexDirection: 'column',
    minHeight,
    backgroundColor
  }}>
    {(src || srcDoc) && <iframe
      id={id}
      title={title}
      src={src}
      srcDoc={srcDoc}
      height="100%"
      width="100%"
      frameBorder={0}
      style={{
        flex: '1',
        position: 'relative'
      }}
    />}
  </Box>
);

export default EmbeddedFrame;

