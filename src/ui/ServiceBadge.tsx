import { Box } from '@mui/material';
import React from 'react';
import { getServiceColors } from '../lib/deviceServicePresentation';

export const ServiceBadge: React.FC<{ name: string }> = ({ name }) => (
  <Box
    component='span'
    sx={{
      display: 'inline-block',
      border: '1px solid',
      ...getServiceColors(name),
      borderRadius: 1,
      px: 0.75,
      py: 0.125,
      fontSize: '0.8125rem',
      fontWeight: 600,
      lineHeight: 1.5,
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      verticalAlign: 'middle',
    }}
  >
    {name}
  </Box>
);
