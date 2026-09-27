import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientEnvironmentVariables = [
  'REACT_APP_BANNER_IMAGE',
  'REACT_APP_OPEN_BALENA_API_URL',
  'REACT_APP_OPEN_BALENA_API_VERSION',
  'REACT_APP_OPEN_BALENA_ODATA_VERSION',
  'REACT_APP_OPEN_BALENA_REMOTE_URL',
  'REACT_APP_OPEN_BALENA_UI_URL',
];

export default defineConfig(({ mode }) => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const rawEnv = loadEnv(mode, process.cwd(), '');
  const clientBuildEnvironment = Object.fromEntries(
    clientEnvironmentVariables.flatMap((key) => (rawEnv[key] ? [[key, rawEnv[key]]] : [])),
  );
  const port = Number(rawEnv.PORT ?? process.env.PORT ?? 3000);
  const previewPort = Number(rawEnv.PORT ?? process.env.PORT ?? 4173);

  return {
    plugins: [react()],
    envPrefix: [],
    resolve: {
      alias: {
        '@': resolve(currentDir, 'src'),
      },
    },
    define: {
      __OBUI_BUILD_ENV__: JSON.stringify(clientBuildEnvironment),
      global: 'globalThis',
    },
    server: {
      port,
      open: true,
      proxy: {
        '/admin-db': 'http://127.0.0.1:3001',
        '/device-update-options': 'http://127.0.0.1:3001',
        '/device-supervisor-target': 'http://127.0.0.1:3001',
        '/balena-os': 'http://127.0.0.1:3001',
      },
    },
    preview: {
      port: previewPort,
    },
    build: {
      outDir: 'dist/client',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (!id.includes('node_modules')) {
              return undefined;
            }

            const manualChunkExclusions = new Set([
              'attr-accept',
              'css-mediaquery',
              'date-fns',
              'diacritic',
              'dom-helpers',
              'dompurify',
              'file-selector',
              'set-cookie-parser',
              'tslib',
            ]);

            const getPackageName = () => {
              const parts = id.split('node_modules/')[1]?.split('/');
              if (!parts || parts.length === 0) {
                return 'vendor';
              }
              if (parts[0].startsWith('@') && parts.length > 1) {
                return `${parts[0]}/${parts[1]}`;
              }
              return parts[0];
            };

            const packageName = getPackageName();

            if (manualChunkExclusions.has(packageName)) {
              return undefined;
            }

            if (id.includes('react-router')) {
              return 'react-router';
            }

            if (id.includes('react-admin') || id.includes('ra-')) {
              return 'react-admin';
            }

            if (id.includes('@mui') || id.includes('@emotion')) {
              return 'mui';
            }

            if (id.includes('final-form') || id.includes('react-hook-form')) {
              return 'forms';
            }

            return `pkg-${packageName.replace(/[@/]/g, '-')}`;
          },
        },
      },
    },
    publicDir: 'public',
  };
});
