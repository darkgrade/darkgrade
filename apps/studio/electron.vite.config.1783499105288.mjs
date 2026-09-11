// electron.vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";
var __electron_vite_injected_dirname = "/sessions/youthful-keen-ride/mnt/repositories/darkgrade/apps/studio";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared"),
        "@main": resolve(__electron_vite_injected_dirname, "src/main")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared"),
        "@renderer": resolve(__electron_vite_injected_dirname, "src/renderer/src"),
        "@voice": resolve(__electron_vite_injected_dirname, "src/renderer/src/voice")
      }
    },
    worker: {
      format: "es"
    },
    build: {
      // transformers.js is large; raise the warning ceiling rather than splitting it
      chunkSizeWarningLimit: 4096
    }
  }
});
export {
  electron_vite_config_default as default
};
