import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const source = path.resolve(
  "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
);
const destination = path.resolve("public/excalidraw-assets/fonts");
await rm(destination, { recursive: true, force: true });
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });
console.error("Copied Excalidraw fonts locally.");
