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
  maxWidth = 1400,
  maxHeight = 1400,
  quality = 0.82,
  maxBytes = 700 * 1024
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

        for (let attempt = 0; attempt < 10 && getDataUrlByteSize(dataUrl) > maxBytes; attempt++) {
          if (currentQuality > 0.48) {
            currentQuality = Math.max(0.48, currentQuality - 0.08);
            dataUrl = currentCanvas.toDataURL("image/jpeg", currentQuality);
            continue;
          }

          const scaledWidth = Math.max(640, Math.round(currentCanvas.width * 0.86));
          const scaledHeight = Math.max(640, Math.round(currentCanvas.height * 0.86));
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
