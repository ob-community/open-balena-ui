import * as React from 'react';
import { useGetList, useInput } from 'react-admin';
import type { AutocompleteInputProps } from 'react-admin';
import { Autocomplete, AutocompleteRenderInputParams, TextField, useTheme } from '@mui/material';

/**
 * Props for VarNameInput component.
 * Note: `freeSolo` is intentionally omitted and always enabled internally,
 * allowing users to enter new variable names not in the suggestions list.
 * `choices` is also omitted as it's populated automatically from the resource.
 */
export interface VarNameInputProps extends Omit<AutocompleteInputProps, 'choices' | 'freeSolo'> {
  /** The resource to fetch existing variable names from */
  resource: string;
  /** The field name that contains the variable name (default: 'name') */
  nameField?: string;
}

/**
 * A smart variable name input component that suggests existing variable names.
 * Features:
 * - Autocomplete with suggestions from existing variables
 * - Free text entry allowed (freeSolo mode)
 * - Fetches unique names from the specified resource
 */
const VarNameInput: React.FC<VarNameInputProps> = ({
  resource,
  nameField = 'name',
  label = 'Name',
  source = 'name',
  sx,
  helperText,
  ...props
}) => {
  const theme = useTheme();
  // Ensure default margin is 'dense' to match other inputs
  const { margin = 'dense', variant, ...rest } = props as any;

  // Fetch existing variable names from the resource
  const { data, isLoading } = useGetList(resource, {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: nameField, order: 'ASC' },
    // Optimize payload by selecting only necessary fields.
    // Note: PostgREST doesn't support SELECT DISTINCT on tables without a view/RPC.
    filter: { 'select@': `id,${nameField}` },
  });

  // Extract unique names and format as choices
  const choices = React.useMemo(() => {
    if (!data) return [];

    const uniqueNames = new Set<string>();
    data.forEach((record) => {
      const name = record[nameField];
      if (name && typeof name === 'string') {
        uniqueNames.add(name);
      }
    });

    return Array.from(uniqueNames)
      .sort()
      .map((name) => ({
        id: name,
        name: name,
      }));
  }, [data, nameField]);

  // Use useInput to integrate with react-admin form
  const { field, fieldState } = useInput({ source, ...props });

  return (
    <Autocomplete
      {...rest}
      fullWidth
      freeSolo
      options={choices}
      loading={isLoading}
      value={field.value || ''}
      sx={sx || { marginBottom: margin === 'dense' ? 1 : 2 }}
      // Handle selection or 'Enter' on a value
      onChange={(event: React.SyntheticEvent, newValue: string | { name: string } | null) => {
        const val = typeof newValue === 'string' ? newValue : newValue?.name;
        field.onChange(val);
      }}
      // Handle text input changes (essential for strictly freeform entry without selection)
      onInputChange={(event: React.SyntheticEvent, newInputValue: string) => {
        field.onChange(newInputValue);
      }}
      // Comparison and Labeling
      getOptionLabel={(option: string | { name: string }) => {
        if (typeof option === 'string') return option;
        return option.name;
      }}
      isOptionEqualToValue={(option: { name: string }, value: string | { name: string }) => {
        if (!value) return false;
        if (typeof value === 'string') return option.name === value;
        return option.name === value.name;
      }}
      renderInput={(params: AutocompleteRenderInputParams) => (
        <TextField
          {...params}
          label={label}
          name={source}
          // Default margin to dense for proper vertical spacing in lists
          // margin={margin} // Handled by root Autocomplete
          variant={variant}
          error={!!fieldState.error}
          helperText={fieldState.error?.message || helperText}
          onBlur={field.onBlur}
          fullWidth
          sx={{
            '& .MuiInputBase-input': {
              ...theme.monoTypography,
            },
          }}
        />
      )}
    />
  );
};

export default VarNameInput;
