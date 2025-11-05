import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const rawEnv = loadEnv(mode, process.cwd(), '');
  const port = Number(rawEnv.PORT ?? process.env.PORT ?? 3000);
  const previewPort = Number(rawEnv.PORT ?? process.env.PORT ?? 4173);

  return {
    plugins: [react()],
    envPrefix: ['REACT_APP_', 'VITE_'],
    resolve: {
      alias: {
        '@': resolve(currentDir, 'src'),
      },
    },
    define: {
      global: 'globalThis',
    },
    server: {
      port,
      open: true,
    },
    preview: {
      port: previewPort,
    },
    build: {
      outDir: 'dist/client',
      emptyOutDir: false,
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
