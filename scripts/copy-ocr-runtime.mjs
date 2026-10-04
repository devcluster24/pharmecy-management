import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(projectRoot, "node_modules", "onnxruntime-web", "dist");
const destinationDirectory = path.join(projectRoot, "public", "ocr", "runtime");
const runtimeFiles = [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

await mkdir(destinationDirectory, { recursive: true });

for (const fileName of runtimeFiles) {
  await copyFile(
    path.join(sourceDirectory, fileName),
    path.join(destinationDirectory, fileName),
  );
}

console.info(`Prepared ${runtimeFiles.length} ONNX Runtime Web assets for browser OCR.`);
