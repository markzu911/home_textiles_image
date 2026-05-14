import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { 
      model: modelId, 
      prompt, 
      images, 
      sceneImage, 
      modelImage, 
      aspectRatio, 
      imageSize,
      saasInfo
    } = await req.json();

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey.trim() === "") {
      return NextResponse.json({ error: "Gemini API Key missing. Please check your AI Studio Secrets panel." }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelId });

    const parts: any[] = [];
    
    // Add main product image
    const [prefix, data] = images[0].split(",");
    const mimeType = prefix.match(/:(.*?);/)?.[1] || "image/jpeg";
    parts.push({
      inlineData: { data, mimeType },
    });

    // Add scene reference if exists
    if (sceneImage) {
      const [sPrefix, sData] = sceneImage.split(",");
      const sMimeType = sPrefix.match(/:(.*?);/)?.[1] || "image/jpeg";
      parts.push({
        inlineData: { data: sData, mimeType: sMimeType },
      });
    }

    // Add model reference if exists
    if (modelImage) {
      const [mPrefix, mData] = modelImage.split(",");
      const mMimeType = mPrefix.match(/:(.*?);/)?.[1] || "image/jpeg";
      parts.push({
        inlineData: { data: mData, mimeType: mMimeType },
      });
    }

    parts.push({ text: prompt });

    const config: any = {
      imageConfig: {
        aspectRatio,
        ...(imageSize ? { imageSize } : {}),
      },
    };

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: config
    });
    
    const response = await result.response;
    const candidates = (response as any).candidates;
    
    if (candidates?.[0]?.content?.parts) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData) {
          const finalImageMimeType = part.inlineData.mimeType || "image/png";
          const finalImageBase64 = part.inlineData.data;
          const finalImageBuffer = Buffer.from(finalImageBase64, 'base64');
          
          let responseImage: any = `data:${finalImageMimeType};base64,${finalImageBase64}`;

          if (saasInfo?.userId && saasInfo?.toolId && saasInfo?.saasOrigin) {
            try {
              const SAAS_ORIGIN = saasInfo.saasOrigin;
              const userId = saasInfo.userId;
              const toolId = saasInfo.toolId;
              
              // 1. Consume
              const consumeRes = await fetch(`${SAAS_ORIGIN}/api/tool/consume`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, toolId })
              });
              const consume = await consumeRes.json().catch(() => ({ success: false, error: 'Consume fetch parsing failed' }));
              if (!consume.success) {
                console.error("consume result:", consume);
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
                  mimeType: finalImageMimeType,
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
              
              if (!commit.success || !commit.savedToRecords) {
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

          return NextResponse.json({ 
            image: responseImage
          });
        }
      }
    }

    return NextResponse.json({ error: "No image data returned from Gemini" }, { status: 500 });
  } catch (error: any) {
    console.error("Generation Error:", error);
    return NextResponse.json({ 
      error: `API Key 验证失败: ${error.message || "未知错误"}` 
    }, { status: 500 });
  }
}
