import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: './',  // Relative paths — required for Electron file:// loading
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
        // Fix bun junction resolution — force Vite to resolve from real paths
        preserveSymlinks: false,
      },
      // Ensure all deps are found even through bun's .bun/ junction structure
      optimizeDeps: {
        include: [
          'react', 'react-dom', 'react-router-dom', 'react-router',
          'framer-motion', 'motion-dom', 'motion-utils',
          'socket.io-client', 'lucide-react',
          'y-protocols/awareness', 'y-protocols/sync',
          '@hocuspocus/provider', '@blocknote/react', '@blocknote/mantine', '@blocknote/core',
        ],
      },
    };
});
