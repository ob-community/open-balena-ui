export const PERMISSION_HINT = 'Ensure you have the appropriate permissions.';

export const withPermissionHint = (message: string, status?: number): string => {
  if (status !== 401 || message.includes(PERMISSION_HINT)) {
    return message;
  }
  if (!message) {
    return PERMISSION_HINT;
  }
  return `${message}${/[.!?]$/.test(message) ? ' ' : '. '}${PERMISSION_HINT}`;
};
