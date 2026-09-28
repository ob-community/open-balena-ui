process.env.PORT = '3001';

import('./index').catch((error) => {
  console.error('Unable to start the development UI server:', error);
  process.exitCode = 1;
});
