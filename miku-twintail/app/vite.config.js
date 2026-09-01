import { resolve } from "node:path";

export default {
  base: "./",   // GitHub Pages のサブパス配信に対応
  build: {
    rollupOptions: {
      input: {
        // 実曲版（TextAlive 接続）と擬似曲モックは同じ src/game/ を共有する
        main: resolve(process.cwd(), "index.html"),
        mock: resolve(process.cwd(), "mock.html"),
      },
    },
  },
};
