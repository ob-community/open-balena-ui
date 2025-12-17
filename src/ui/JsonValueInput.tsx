import * as React from 'react';
import { useInput, useTranslate, Validator } from 'react-admin';
import type { TextInputProps } from 'react-admin';
import { FormControlLabel, Checkbox, Box, TextField } from '@mui/material';

/**
 * Detects if a string looks like JSON (starts and ends with {} or [])
 */
const looksLikeJson = (value: string): boolean => {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    const parseError = validateJsonSyntax(trimmed);
    return !parseError;
  }
  return false;
};

/**
 * Validates JSON syntax and returns an error message if invalid
 */
const validateJsonSyntax = (value: string): string | undefined => {
  if (!value) return undefined;

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
 * Formats JSON string - either pretty-printed or minified
 * @param value - The JSON string to format
 * @param pretty - If true, format with indentation; if false, minify
 */
const formatJson = (value: string, pretty: boolean): string => {
  if (!value || typeof value !== 'string') return value || '';
  try {
    const parsed = JSON.parse(value);
    return pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
  } catch {
    return value;
  }
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
 * - "JSON Value" checkbox for explicit JSON mode
 * - Auto-detection of JSON values on load
 * - Automatic JSON syntax validation when JSON mode is enabled
 * - Pretty-formatted JSON display
 * - Minified JSON on form submission
 */
const JsonValueInput: React.FC<JsonValueInputProps> = ({
  minRows = 3,
  maxRows = 10,
  validate,
  sx,
  source = 'value',
  label,
  ...props
}) => {
  const translate = useTranslate();
  const [isJsonMode, setIsJsonMode] = React.useState(false);
  const [hasInitialized, setHasInitialized] = React.useState(false);
  const [displayValue, setDisplayValue] = React.useState('');
  const [jsonError, setJsonError] = React.useState<string | undefined>(undefined);

  // Create JSON validator that only runs when JSON mode is enabled
  const jsonValidator: Validator = React.useCallback(
    (value: string) => {
      if (!isJsonMode) return undefined;
      return validateJsonSyntax(value);
    },
    [isJsonMode]
  );

  // Combine existing validators with JSON validator
  const combinedValidate = React.useMemo(() => {
    if (!validate) {
      return jsonValidator;
    }
    if (Array.isArray(validate)) {
      return [...validate, jsonValidator];
    }
    return [validate, jsonValidator];
  }, [validate, jsonValidator]);

  // Get access to the field value via useInput
  const {
    field,
    fieldState: { error, isTouched },
    isRequired,
  } = useInput({ source, validate: combinedValidate });

  // Initialize display value and JSON mode on load
  React.useEffect(() => {
    if (!hasInitialized && field.value !== undefined) {
      const value = field.value || '';
      const shouldBeJsonMode = looksLikeJson(value);
      setIsJsonMode(shouldBeJsonMode);

      // If it's JSON, display it in pretty format
      if (shouldBeJsonMode) {
        setDisplayValue(formatJson(value, true));
      } else {
        setDisplayValue(value);
      }
      setHasInitialized(true);
    }
  }, [field.value, hasInitialized]);

  // Handle checkbox toggle
  const handleJsonModeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newJsonMode = event.target.checked;
    setIsJsonMode(newJsonMode);
    setJsonError(undefined);

    if (newJsonMode && displayValue) {
      // When enabling JSON mode, try to pretty-format the current value
      const error = validateJsonSyntax(displayValue);
      if (!error) {
        setDisplayValue(formatJson(displayValue, true));
      } else {
        setJsonError(error);
      }
    } else if (!newJsonMode && displayValue) {
      // When disabling JSON mode, revert to minified/original format if valid JSON, else leave as-is
      const error = validateJsonSyntax(displayValue);
      const minified = !error ? formatJson(displayValue, false) : displayValue;
      setDisplayValue(minified);
      field.onChange(minified);
    }
  };

  // Handle input changes - just update display value, don't sync yet
  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setDisplayValue(newValue);

    // Clear any previous JSON error when typing
    if (jsonError) {
      setJsonError(undefined);
    }

    // Also update form value in real-time so form knows something changed
    // In JSON mode, store minified if valid, otherwise store as-is
    if (isJsonMode) {
      const error = validateJsonSyntax(newValue);
      if (!error) {
        field.onChange(formatJson(newValue, false));
      } else {
        field.onChange(newValue);
      }
    } else {
      field.onChange(newValue);
    }
  };

  // Handle blur - validate and sync to form state
  const handleBlur = () => {
    field.onBlur();

    if (isJsonMode && displayValue) {
      const error = validateJsonSyntax(displayValue);
      if (error) {
        setJsonError(error);
      } else {
        // Valid JSON - minify for form state, keep display pretty
        field.onChange(formatJson(displayValue, false));
        setDisplayValue(formatJson(displayValue, true));
        setJsonError(undefined);
      }
    }
  };

  // Returns the error message to display, or null if no error should be shown
  const getError = (): string | null => {
    const isFormJsonError = error?.message?.includes('Invalid JSON');
    const hasAnyJsonError = isFormJsonError || !!jsonError;
    
    // Local JSON error in JSON mode (shows immediately, no touch required)
    if (isJsonMode && jsonError) return jsonError;
    
    if (!isTouched || !error) return null;
   
    if ((isJsonMode && isFormJsonError) || !hasAnyJsonError) {
      const translated = translate(error.message as string, { _: error.message as string });
      // Clean up any @@react-admin@@ prefixes that may appear in untranslated keys
      if (translated.includes('@@react-admin@@')) {
        return error.message as string;
      }
      return translated;
    }
          
    return null;
  };

  const errorMessage = getError();

  return (
    <Box sx={{ width: '100%' }}>
      <TextField
        {...props}
        label={label}
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        multiline
        minRows={minRows}
        maxRows={maxRows}
        error={!!errorMessage}
        helperText={errorMessage ?? undefined}
        required={isRequired}
        sx={{
          width: '100%',
          '& .MuiInputBase-input': {
            fontFamily: 'Consolas, "Courier New", monospace !important',
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
      <FormControlLabel
        control={
          <Checkbox
            checked={isJsonMode}
            onChange={handleJsonModeChange}
            size="small"
            sx={{
              color: 'text.secondary',
              '&.Mui-checked': {
                color: 'primary.main',
              },
            }}
          />
        }
        label="JSON Value"
        sx={{
          margin: 0,
          '& .MuiFormControlLabel-label': {
            fontSize: '0.875rem',
            color: 'text.secondary',
          },
        }}
      />
    </Box>
  );
};

export default JsonValueInput;
