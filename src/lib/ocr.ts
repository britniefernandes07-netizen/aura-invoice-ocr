import { createWorker, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      logger: () => {},
    });
  }
  return workerPromise;
}

export interface OcrResult {
  text: string;
  confidence: number;
}

/**
 * Preprocesses the image before OCR: upscales small images (Tesseract
 * reads small/dense text poorly), converts to grayscale, and increases
 * contrast. This is the "clean the image" step the research covered -
 * Tesseract specifically struggles with small text and low contrast,
 * which is exactly what a full-page invoice screenshot looks like.
 */
async function preprocessImage(file: File): Promise<Blob> {
  const img = await loadImage(file);

  // Upscale if the image is small - Tesseract does much better with
  // larger text. Target at least 2800px on the longer side - dense
  // multi-column invoices (like tax-breakdown tables) have much smaller
  // effective text size even at the same overall image resolution.
  const MIN_DIMENSION = 2800;
  const scale = Math.max(1, MIN_DIMENSION / Math.max(img.width, img.height));
  const targetWidth = Math.round(img.width * scale);
  const targetHeight = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  // Use better image smoothing when scaling up
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Grayscale + contrast boost, pixel by pixel
  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imageData.data;
  const contrastFactor = 1.25; // >1 increases contrast (gentler at higher res to avoid clipping thin strokes)

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // apply contrast around the midpoint (128)
    const contrasted = Math.min(255, Math.max(0, (gray - 128) * contrastFactor + 128));
    data[i] = data[i + 1] = data[i + 2] = contrasted;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      "image/png",
      1.0
    );
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export async function runOcr(file: File, onProgress?: (p: number) => void): Promise<OcrResult> {
  const worker = await getWorker();
  if (onProgress) onProgress(0);

  const preprocessedBlob = await preprocessImage(file);

  const { data } = await worker.recognize(preprocessedBlob);
  if (onProgress) onProgress(1);
  return {
    text: data.text || "",
    confidence: data.confidence ? data.confidence / 100 : 0,
  };
}

export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}