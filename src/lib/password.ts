import { hashSync } from 'bcrypt-ts';

export const hashPassword = (password: string): string => hashSync(password, 10).replace(/^\$2a\$/, '$2b$');
