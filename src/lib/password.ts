import { hashSync } from 'bcrypt-ts';
import { isPasswordWithinBcryptLimit, MAX_PASSWORD_BYTES } from './passwordPolicy';

export const hashPassword = (password: string): string => {
  if (!isPasswordWithinBcryptLimit(password)) {
    throw new Error(`Passwords cannot exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes.`);
  }
  return hashSync(password, 10).replace(/^\$2a\$/, '$2b$');
};
