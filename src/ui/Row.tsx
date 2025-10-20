import { Box, SxProps, Theme } from '@mui/material';
import React, { PropsWithChildren } from 'react';

type RowProps = PropsWithChildren<{
  sx?: SxProps<Theme>;
}>;

const Row: React.FC<RowProps> = ({ children, sx }) => {
  return (
    <Box
      className='row'
      sx={{
        display: 'grid',
        gridAutoFlow: 'column',
        gridAutoColumns: 'auto',
        gap: '30px',
        width: '100%',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
};

export default Row;
