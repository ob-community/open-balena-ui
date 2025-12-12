import * as React from 'react';
import { TextInput, useInput } from 'react-admin';
import type { TextInputProps } from 'react-admin';

/**
 * Detects if a string looks like JSON (starts and ends with {} or [])
 */
const looksLikeJson = (value: string): boolean => {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
};

/**
 * Validates JSON syntax and returns an error message if invalid
 */
const validateJsonSyntax = (value: string): string | undefined => {
  if (!value || !looksLikeJson(value)) return undefined;

  try {
    JSON.parse(value);
    return undefined;
  } catch (e) {
    if (e instanceof SyntaxError) {
      return `Invalid JSON: ${e.message}`;
    }
    return 'Invalid JSON syntax';
  }
};

/**
 * Custom JSON validation function for react-admin
 */
const jsonValidator = (value: string) => {
  const error = validateJsonSyntax(value);
  return error || undefined;
};

export interface JsonValueInputProps extends Omit<TextInputProps, 'multiline'> {
  /** Minimum number of rows for the textarea (default: 3) */
  minRows?: number;
  /** Maximum number of rows for the textarea (default: 10) */
  maxRows?: number;
}

/**
 * A smart value input component for environment/config variables.
 * Features:
 * - Multiline textarea
 * - Monospace font for better readability
 * - Automatic JSON syntax validation when input looks like JSON
 * - Error highlighting for invalid JSON
 */
const JsonValueInput: React.FC<JsonValueInputProps> = ({
  minRows = 3,
  maxRows = 10,
  validate,
  sx,
  ...props
}) => {
  // Combine existing validators with JSON validator
  const combinedValidate = React.useMemo(() => {
    if (!validate) {
      return jsonValidator;
    }
    if (Array.isArray(validate)) {
      return [...validate, jsonValidator];
    }
    return [validate, jsonValidator];
  }, [validate]);

  return (
    <TextInput
      {...props}
      multiline
      minRows={minRows}
      maxRows={maxRows}
      validate={combinedValidate}
      sx={{
        '& .MuiInputBase-input': {
          fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", "Monaco", monospace',
          fontSize: '0.875rem',
          lineHeight: 1.5,
        },
        '& .MuiInputBase-root': {
          alignItems: 'flex-start',
        },
        ...sx,
      }}
      fullWidth
    />
  );
};

export default JsonValueInput;

