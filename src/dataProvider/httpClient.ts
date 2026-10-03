import { HttpError } from 'react-admin';
import type { HttpClient } from './odataDataProvider';
import { withPermissionHint } from '../lib/httpErrorMessage';

export const withPermissionHints =
  (httpClient: HttpClient): HttpClient =>
  async (url, options) => {
    try {
      return await httpClient(url, options);
    } catch (error) {
      if (error instanceof HttpError) {
        error.message = withPermissionHint(error.message, error.status);
      }
      throw error;
    }
  };
