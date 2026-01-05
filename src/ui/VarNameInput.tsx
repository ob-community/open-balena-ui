import * as React from 'react';
import { AutocompleteInput, useGetList } from 'react-admin';
import type { AutocompleteInputProps } from 'react-admin';

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
  ...props
}) => {
  // Fetch existing variable names from the resource
  const { data, isLoading } = useGetList(resource, {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: nameField, order: 'ASC' },
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

  // Make sure free text values render correctly by mapping both string values and choice objects.
  const getOptionText = React.useCallback(
    (choice: unknown) => {
      if (typeof choice === 'string') return choice;
      if (choice && typeof choice === 'object') {
        const obj = choice as Record<string, unknown>;
        const labelValue = obj[nameField] ?? obj.id;
        return typeof labelValue === 'string' ? labelValue : labelValue?.toString() ?? '';
      }

      return '';
    },
    [nameField],
  );

  const isOptionEqualToValue = React.useCallback(
    (option: unknown, value: unknown) => {
      const getComparableValue = (item: unknown) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          return (obj[nameField] ?? obj.id) as string | undefined;
        }
        return undefined;
      };

      const optionValue = getComparableValue(option);
      const currentValue = getComparableValue(value);

      // If either side resolves to undefined, only treat them as equal when both inputs are actually null/undefined.
      if (optionValue === undefined || currentValue === undefined) {
        const optionIsNullish = option == null;
        const valueIsNullish = value == null;
        if (optionIsNullish || valueIsNullish) {
          return optionIsNullish && valueIsNullish;
        }
        return false;
      }

      return optionValue === currentValue;
    },
    [nameField],
  );

  return (
    <AutocompleteInput
      {...props}
      source={source}
      label={label}
      choices={choices}
      optionText={getOptionText}
      isOptionEqualToValue={isOptionEqualToValue}
      isLoading={isLoading}
      // @ts-expect-error react-admin types freeSolo as literal false, but it supports true for free text entry
      freeSolo
      fullWidth
      sx={{
        '& .MuiInputBase-input': {
          fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", "Monaco", monospace',
        },
        ...sx,
      }}
    />
  );
};

export default VarNameInput;

