import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

let commitHash = '';
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch (e) {
  console.warn('Failed to get git commit hash');
}

// Plot Polls is served as a static GitHub Pages site from the build output.
// Build artifacts are emitted into `build/` (the served Pages root), and the
// movie catalogue + embedding binaries live in `public/data/` so Vite copies
// them verbatim to `build/data/` on every build.
export default defineConfig({
  plugins: [react()],
  // Relative base so the bundle works whether served from a custom domain root
  // (plotpolls.com) or a project sub-path.
  base: './',
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    // The embedding binaries are large; don't inline or warn about them.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
