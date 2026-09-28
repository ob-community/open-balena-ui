export const requestSignal = (params: unknown): AbortSignal | undefined => {
  if (typeof params !== 'object' || params === null) {
    return undefined;
  }
  return (params as { signal?: AbortSignal }).signal;
};
