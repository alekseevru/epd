import vinext from "vinext";
import { defineConfig } from "vite";
export default defineConfig(() => {
  return {
    plugins: [vinext()],
  };
});
