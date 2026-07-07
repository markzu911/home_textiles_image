import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const getDataUrlByteSize = (dataUrl: string) => {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
};

export async function compressImage(
  file: File,
  maxWidth = 1024,
  maxHeight = 1024,
  quality = 0.78,
  maxBytes = 420 * 1024
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }

        // Fill background with white in case it's a transparent image being converted to JPEG
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);

        ctx.drawImage(img, 0, 0, width, height);

        let currentCanvas = canvas;
        let currentQuality = quality;
        let dataUrl = currentCanvas.toDataURL("image/jpeg", currentQuality);

        for (let attempt = 0; attempt < 12 && getDataUrlByteSize(dataUrl) > maxBytes; attempt++) {
          if (currentQuality > 0.42) {
            currentQuality = Math.max(0.42, currentQuality - 0.08);
            dataUrl = currentCanvas.toDataURL("image/jpeg", currentQuality);
            continue;
          }

          const longestSide = Math.max(currentCanvas.width, currentCanvas.height);
          if (longestSide <= 512) {
            break;
          }

          const scale = Math.max(512 / longestSide, 0.84);
          const scaledWidth = Math.max(1, Math.round(currentCanvas.width * scale));
          const scaledHeight = Math.max(1, Math.round(currentCanvas.height * scale));
          if (scaledWidth === currentCanvas.width && scaledHeight === currentCanvas.height) {
            break;
          }

          const scaledCanvas = document.createElement("canvas");
          scaledCanvas.width = scaledWidth;
          scaledCanvas.height = scaledHeight;
          const scaledCtx = scaledCanvas.getContext("2d");
          if (!scaledCtx) {
            break;
          }
          scaledCtx.fillStyle = "#ffffff";
          scaledCtx.fillRect(0, 0, scaledWidth, scaledHeight);
          scaledCtx.drawImage(currentCanvas, 0, 0, scaledWidth, scaledHeight);
          currentCanvas = scaledCanvas;
          currentQuality = 0.72;
          dataUrl = currentCanvas.toDataURL("image/jpeg", currentQuality);
        }

        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("Failed to load image"));
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
  });
}
