import React from 'react';
import { Button, ButtonProps } from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';

export const EnvVarButton: React.FC<ButtonProps & { resource: string; record: any; label?: string }> = (props) => {
  return (
    <Button
      href={`/#/${props.resource}%20environment%20variable?filter={"${props.resource}":${props.record['id']}}`}
      {...props}
    >
      <CodeIcon />
      {props.label ? <span style={{ paddingLeft: '4px' }}>{props.label}</span> : ''}
    </Button>
  );
};

export default EnvVarButton;
