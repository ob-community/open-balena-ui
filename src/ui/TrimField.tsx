/** Copied from:
 * https://github.com/BigBasket/ra-components/blob/master/src/Trim/TrimField.js
 *
 * Until ra-components updates to not use @mui/styled
 */
import React from 'react';
import { FunctionField } from 'react-admin';
import type { FunctionFieldProps, RaRecord } from 'react-admin';

const DEFAULT_LIMITCHARS = 60;
const DEFAULT_TRIMSTR = '…';

/**
 *
 * Any `TextField` with more number of characters can be limited using `TrimField`.
 * @example
 * <TrimField source='field' label='Trimmed Field' />
 *
 * By default, this trims the value to 30 chars and appends … to the end.
 * You can customize it.
 * @example
 * <TrimField source='field' label='Trimmed Field' limit={40} trimstr='....' />
 *
 */

interface TrimFieldProps extends Omit<FunctionFieldProps<RaRecord>, 'render'> {
  text?: string;
  limit?: number;
  trimstr?: string;
}

export const TrimField: React.FC<TrimFieldProps> = ({
  source,
  text,
  limit = DEFAULT_LIMITCHARS,
  trimstr = DEFAULT_TRIMSTR,
  ...rest
}) => {
  const trimString = React.useCallback(
    (value: unknown): string => {
      if (value == null) {
        return '';
      }

      const valueAsString = String(value);
      return valueAsString.length > limit ? `${valueAsString.slice(0, limit)}${trimstr}` : valueAsString;
    },
    [limit, trimstr],
  );

  if (!text && !source) {
    throw new Error(`Missing mandatory prop: text or source`);
  }

  return (
    <FunctionField
      {...rest}
      render={(record: RaRecord) => {
        const data = text ?? (source ? record[source] : undefined);
        return trimString(data);
      }}
    />
  );
};
