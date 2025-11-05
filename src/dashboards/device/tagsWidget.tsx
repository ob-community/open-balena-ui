import { Box } from '@mui/material';
import * as React from 'react';
import { DeviceTagList } from '../../components/deviceTag';

const TagsWidget: React.FC = () => {
  return (
    <Box
      sx={{
        'px': '15px',
        '.RaList-noResults': {
          height: 'auto',
          paddingBottom: '30px',
        },
      }}
    >
      <DeviceTagList />
    </Box>
  );
};

export default TagsWidget;
