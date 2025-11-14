import '@mui/material/Button';
import '@mui/material/TextField';
import '@mui/material/Select';
import '@mui/material/styles';

declare module '@mui/material/Button' {
  interface ButtonPropsSizeOverrides {
    large: true;
  }
}

declare module '@mui/material/TextField' {
  interface TextFieldPropsSizeOverrides {
    large: true;
  }
}

declare module '@mui/material/Select' {
  interface SelectPropsSizeOverrides {
    large: true;
  }
}

declare module '@mui/material/styles' {
  interface Palette {
    chip: {
      background: string;
      color: string;
    };
  }

  interface PaletteOptions {
    chip?: {
      background: string;
      color: string;
    };
  }
}
