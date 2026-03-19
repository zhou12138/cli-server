import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'CLI Server',
  },
  rebuildConfig: {
    // node-pty needs Spectre-mitigated libs + full Windows SDK;
    // skip native module rebuild when tools are missing — PTY mode
    // degrades gracefully at runtime via dynamic require.
    onlyModules: [],
  },
  makers: [
    new MakerSquirrel({ name: 'cli-server', authors: 'CLI Server' }),
    new MakerDMG({ format: 'ULFO' }),
    new MakerDeb({ options: { name: 'cli-server' } }),
    new MakerRpm({ options: { name: 'cli-server' } }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
