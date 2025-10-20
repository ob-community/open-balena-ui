/** Copied from:
 * https://github.com/BigBasket/ra-components/blob/master/src/Trim/TrimField.js
 *
 * Until ra-components updates to not use @mui/styled
 */
import React from 'react';
import { FunctionField } from 'react-admin';

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
export const TrimField = (props) => {
  const TrimString = (str) => {
    let retval = str;
    if (retval && typeof retval === 'string')
      retval = retval.length > limit ? retval.slice(0, limit) + trimstr : retval;
    return retval;
  };

  const { source, text, limit = DEFAULT_LIMITCHARS, trimstr = DEFAULT_TRIMSTR, ...rest } = props;
  if (!text && !source) throw new Error(`Missing mandatory prop: text or source`);
  if (isNaN(Number(limit))) throw new Error(`Invalid prop value: limit must be a number`);
  return (
    <FunctionField
      render={(record) => {
        const data = text || record[source];
        return TrimString(data, limit);
      }}
      {...rest}
    />
  );
};
