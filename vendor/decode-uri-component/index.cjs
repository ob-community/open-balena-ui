'use strict';

// query-string 7 requires CommonJS, while patched upstream decoder releases are ESM-only.
const encodedBytes = /(?:%[a-f\d]{2})+/gi;

const decodeUriComponent = (value) => {
  if (typeof value !== 'string') {
    throw new TypeError(`Expected a string, received ${typeof value}`);
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value.replace(encodedBytes, (sequence) => {
      try {
        return decodeURIComponent(sequence);
      } catch {
        return sequence;
      }
    });
  }
};

module.exports = decodeUriComponent;
