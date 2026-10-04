import type { OcrResult } from "@paddleocr/paddleocr-js";

const DETECTION_MODEL = "PP-OCRv5_mobile_det";
const RECOGNITION_MODEL = "PP-OCRv5_mobile_rec";

async function createOcrEngine() {
  const { PaddleOCR } = await import("@paddleocr/paddleocr-js");

  return PaddleOCR.create({
    textDetectionModelName: DETECTION_MODEL,
    textDetectionModelAsset: {
      url: "/ocr/models/PP-OCRv5_mobile_det.tar",
    },
    textRecognitionModelName: RECOGNITION_MODEL,
    textRecognitionModelAsset: {
      url: "/ocr/models/PP-OCRv5_mobile_rec.tar",
    },
    ortOptions: {
      backend: "wasm",
      wasmPaths: "/ocr/runtime/",
      numThreads: 1,
      simd: true,
    },
  });
}

let enginePromise: ReturnType<typeof createOcrEngine> | null = null;

async function getOcrEngine() {
  if (!enginePromise) enginePromise = createOcrEngine();

  try {
    return await enginePromise;
  } catch (error) {
    enginePromise = null;
    throw error;
  }
}

function getCanvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not prepare the enhanced image."));
    }, "image/png");
  });
}

async function createEnhancedImage(file: File) {
  const image = await createImageBitmap(file);
  try {
    const longestSide = Math.max(image.width, image.height);
    const scale = Math.min(1.5, 2200 / longestSide);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Image enhancement is unavailable in this browser.");

    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;
    const original = new Uint8ClampedArray(data);
    const contrast = 1.08;

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const pixel = (y * width + x) * 4;
        const verticalOffset = width * 4;

        for (let channel = 0; channel < 3; channel += 1) {
          const average = (
            original[pixel - verticalOffset + channel]
            + original[pixel - 4 + channel]
            + original[pixel + 4 + channel]
            + original[pixel + verticalOffset + channel]
          ) / 4;
          const sharpened = original[pixel + channel] + 0.55 * (original[pixel + channel] - average);
          data[pixel + channel] = Math.max(0, Math.min(255, (sharpened - 128) * contrast + 128));
        }
      }
    }

    return getCanvasBlob(canvas);
  } finally {
    image.close();
  }
}

function getAverageConfidence(result: OcrResult) {
  const scores = result.items.map((item) => item.score).filter(Number.isFinite);
  if (!scores.length) return 0;
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

export type ProductImageOcrResult = {
  result: OcrResult;
  averageConfidence: number;
  enhancedImageUsed: boolean;
};

export async function recognizeProductImage(
  file: File,
  onProgress?: (message: string) => void,
): Promise<ProductImageOcrResult> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file to scan.");
  }

  onProgress?.("Loading the OCR runtime and medicine text models...");
  const engine = await getOcrEngine();
  onProgress?.("Checking the original image...");
  const [originalResult] = await engine.predict(file);
  if (!originalResult) throw new Error("The OCR model did not return a result for the original image.");

  onProgress?.("Enhancing the image and checking OCR readability...");
  const enhancedImage = await createEnhancedImage(file);
  const [enhancedResult] = await engine.predict(enhancedImage);
  if (!enhancedResult) throw new Error("The OCR model did not return a result for the enhanced image.");

  const originalConfidence = getAverageConfidence(originalResult);
  const enhancedConfidence = getAverageConfidence(enhancedResult);
  const useEnhancedImage = enhancedConfidence > originalConfidence;
  const result = useEnhancedImage ? enhancedResult : originalResult;

  return {
    result,
    averageConfidence: useEnhancedImage ? enhancedConfidence : originalConfidence,
    enhancedImageUsed: useEnhancedImage,
  };
}
