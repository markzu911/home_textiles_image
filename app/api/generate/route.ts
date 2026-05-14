import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { 
      model: genModel, 
      prompt, 
      images, 
      sceneImage, 
      modelImage, 
      aspectRatio, 
      imageSize,
      saasInfo
    } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API Key missing (server)" }, { status: 500 });
    }

    // 1. Verify integral
    if (saasInfo?.verifyUrl) {
      try {
        const verifyRes = await fetch(saasInfo.verifyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: saasInfo.userId, toolId: saasInfo.toolId })
        });
        const verifyData = await verifyRes.json();
        // verifyData.success handling. Check response object structure based on API_SPEC.
        if (verifyData && verifyData.success === false) {
           return NextResponse.json({ error: verifyData.message || verifyData.error || "积分不足" }, { status: 403 });
        }
      } catch (err: any) {
         console.warn("Verify failed, but proceeding or intercepting depending on rules:", err);
      }
    }

    const ai = new GoogleGenAI({ apiKey });

    const parts: any[] = [];
    const [prefix, data] = images[0].split(",");
    const mimeType = prefix.match(/:(.*?);/)?.[1] || "image/jpeg";
    parts.push({ inlineData: { data, mimeType } });

    if (sceneImage) {
      const [sPrefix, sData] = sceneImage.split(",");
      const sMimeType = sPrefix.match(/:(.*?);/)?.[1] || "image/jpeg";
      parts.push({ inlineData: { data: sData, mimeType: sMimeType } });
    }

    if (modelImage) {
      const [mPrefix, mData] = modelImage.split(",");
      const mMimeType = mPrefix.match(/:(.*?);/)?.[1] || "image/jpeg";
      parts.push({ inlineData: { data: mData, mimeType: mMimeType } });
    }

    parts.push({ text: prompt });

    const targetModel = genModel || "gemini-3.1-flash-image-preview";
    const response = await ai.models.generateContent({
      model: targetModel,
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio,
          ...(imageSize ? { imageSize } : {}),
        }
      }
    });

    if (!response.candidates?.[0]?.content?.parts) {
      throw new Error("No image generated.");
    }

    let generatedBase64 = null;
    let generatedMimeType = "image/png";
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
          generatedBase64 = part.inlineData.data;
          if (part.inlineData.mimeType) {
            generatedMimeType = part.inlineData.mimeType;
          }
          break;
      }
    }

    if (!generatedBase64) throw new Error("No image data returned from Gemini");

    const finalImageBuffer = Buffer.from(generatedBase64, 'base64');
    let responseImage: any = `data:${generatedMimeType};base64,${generatedBase64}`;

    if (saasInfo?.userId && saasInfo?.toolId && saasInfo?.consumeUrl) {
      try {
        const SAAS_ORIGIN = new URL(saasInfo.consumeUrl).origin;
        const { userId, toolId } = saasInfo;
        
        // 1. Consume
        const consumeRes = await fetch(`${SAAS_ORIGIN}/api/tool/consume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, toolId })
        });
        const consume = await consumeRes.json().catch(() => ({ success: false, error: 'Consume fetch parsing failed' }));
        if (!consume.success) {
          throw new Error(consume.error || consume.message || '扣费失败');
        }

        // 2. Direct Token
        const tokenRes = await fetch(`${SAAS_ORIGIN}/api/upload/direct-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            toolId,
            source: 'result',
            mimeType: generatedMimeType,
            fileName: 'result.png',
            fileSize: finalImageBuffer.byteLength
          })
        });
        const token = await tokenRes.json().catch(() => ({ success: false, error: 'Token fetch parsing failed' }));
        if (!token.success) {
          throw new Error(token.error || token.message || '获取上传凭证失败');
        }

        // 3. Upload to OSS
        const uploadRes = await fetch(token.uploadUrl, {
          method: token.method || 'PUT',
          headers: token.headers,
          body: finalImageBuffer
        });
        if (!uploadRes.ok) throw new Error(`OSS 上传失败: ${uploadRes.status}`);

        // 4. Commit
        const commitRes = await fetch(`${SAAS_ORIGIN}/api/upload/commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            toolId,
            source: 'result',
            objectKey: token.objectKey,
            fileSize: finalImageBuffer.byteLength
          })
        });
        const commit = await commitRes.json().catch(() => ({ success: false, error: 'Commit fetch parsing failed' }));
        
        if (!commit.success && !commit.savedToRecords) {
          throw new Error(commit.error || '图片入库失败');
        }

        responseImage = commit.image || {
          recordId: commit.recordId,
          url: commit.url,
          fileName: commit.fileName,
          fileSize: finalImageBuffer.byteLength
        };

      } catch (saasErr: any) {
        console.error("SAAS integration error:", saasErr);
        return NextResponse.json({ error: saasErr.message || "服务异常，无法保存结果图" }, { status: 500 });
      }
    }

    return NextResponse.json({ image: responseImage });
  } catch (error: any) {
    console.error("Generation Error:", error);
    return NextResponse.json({ 
      error: `生成失败: ${error.message || "未知错误"}` 
    }, { status: 500 });
  }
}
