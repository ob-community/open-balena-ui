export const MAX_PASSWORD_BYTES = 72;

export const passwordByteLength = (password: string): number => new TextEncoder().encode(password).length;

export const isPasswordWithinBcryptLimit = (password: unknown): password is string =>
  typeof password === 'string' && passwordByteLength(password) <= MAX_PASSWORD_BYTES;

export const isValidPassword = (password: unknown): password is string =>
  isPasswordWithinBcryptLimit(password) &&
  password.length >= 8 &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /\d/.test(password) &&
  /[^A-Za-z0-9]/.test(password);

export const maxPasswordBytes = (password: string | undefined): string | undefined =>
  password != null && !isPasswordWithinBcryptLimit(password)
    ? `Password must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes`
    : undefined;
