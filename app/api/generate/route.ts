import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = 'nodejs';
export const maxDuration = 120;

function getSaasUrl(saasInfo: any, specificUrl: string, defaultPath: string) {
  if (saasInfo[specificUrl]) return saasInfo[specificUrl];
  let origin = saasInfo.apiBaseUrl || "https://aibigtree.com";
  if (!saasInfo.apiBaseUrl && saasInfo.consumeUrl) {
      try { origin = new URL(saasInfo.consumeUrl).origin; } catch(e){}
  }
  return origin.replace(/\/$/, '') + defaultPath;
}

export async function POST(req: Request) {
  try {
    const { 
      model: genModel, 
      prompt, 
      images, 
      sceneImage, 
      modelImage, 
      aspectRatio, 
      saasInfo
    } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "缺少 GEMINI_API_KEY (Server)" }, { status: 500 });
    }

    const { userId, toolId } = saasInfo || {};
    const shouldSaveToSaas = !!(userId && toolId);

    // 1. Verify integral
    if (shouldSaveToSaas) {
      try {
        const verifyUrl = getSaasUrl(saasInfo, 'verifyUrl', '/api/tool/verify');
        const verifyRes = await fetch(verifyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, toolId }),
          signal: typeof AbortSignal !== "undefined" ? AbortSignal.timeout(10000) : undefined
        });
        const verifyDataText = await verifyRes.text();
        let verifyData: any = {};
        try { verifyData = JSON.parse(verifyDataText); } catch(e) { verifyData = { error: verifyDataText.slice(0, 300) }; }
        
        // Ensure success field is properly checked to prevent bypass
        if (verifyRes.ok === false || verifyData.success === false) {
           return NextResponse.json({ error: verifyData.message || verifyData.error || "积分不足或其他校验失败" }, { status: 403 });
        }
      } catch (err: any) {
         console.warn("Verify failed, throwing error to stop generation:", err);
         return NextResponse.json({ error: `前置校验失败: ${err.message}` }, { status: 500 });
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

    let response;
    try {
        const timeoutMsg = "AI 生成超时(120s): 模型处理耗时过长，请尝试降低参数或再次重试。";
        const targetModel = genModel || "gemini-3.1-flash-image-preview";
        response = await Promise.race([
          ai.models.generateContent({
            model: targetModel,
            contents: { parts },
            config: {
              imageConfig: {
                aspectRatio
              }
            }
          }),
          new Promise<never>((_, reject) => {
             setTimeout(() => reject(new Error(timeoutMsg)), 120000);
          })
        ]);
    } catch(err: any) {
        return NextResponse.json({ error: `AI 生成失败: ${err.message}` }, { status: 500 });
    }

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

    if (shouldSaveToSaas) {
      try {
        // 2. Consume
        const consumeUrl = getSaasUrl(saasInfo, 'consumeUrl', '/api/tool/consume');
        const consumeRes = await fetch(consumeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, toolId }),
          signal: typeof AbortSignal !== "undefined" ? AbortSignal.timeout(10000) : undefined
        });
        const consumeText = await consumeRes.text();
        let consume: any = {};
        try { consume = JSON.parse(consumeText); } catch(e) { consume = { error: consumeText.slice(0, 300) }; }
        if (!consumeRes.ok || consume.success === false) {
          throw new Error(consume.error || consume.message || '扣费失败');
        }

        // 3. Direct Token
        const uploadTokenUrl = getSaasUrl(saasInfo, 'uploadTokenUrl', '/api/upload/direct-token');
        const tokenRes = await fetch(uploadTokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            toolId,
            source: 'result',
            mimeType: generatedMimeType,
            fileName: 'result.png',
            fileSize: finalImageBuffer.byteLength
          }),
          signal: typeof AbortSignal !== "undefined" ? AbortSignal.timeout(10000) : undefined
        });
        const tokenText = await tokenRes.text();
        let token: any = {};
        try { token = JSON.parse(tokenText); } catch(e) { token = { error: tokenText.slice(0, 300) }; }
        if (!tokenRes.ok || token.success === false) {
          throw new Error(token.error || token.message || '获取上传凭证失败');
        }

        // 4. Upload to OSS
        const uploadRes = await fetch(token.uploadUrl, {
          method: token.method || 'PUT',
          headers: token.headers,
          body: finalImageBuffer,
          signal: typeof AbortSignal !== "undefined" ? AbortSignal.timeout(30000) : undefined
        });
        if (!uploadRes.ok) throw new Error(`OSS 上传失败: ${uploadRes.status}`);

        // 5. Commit
        const uploadCommitUrl = getSaasUrl(saasInfo, 'uploadCommitUrl', '/api/upload/commit');
        const commitRes = await fetch(uploadCommitUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            toolId,
            source: 'result',
            objectKey: token.objectKey,
            fileSize: finalImageBuffer.byteLength
          }),
          signal: typeof AbortSignal !== "undefined" ? AbortSignal.timeout(10000) : undefined
        });
        const commitText = await commitRes.text();
        let commit: any = {};
        try { commit = JSON.parse(commitText); } catch(e) { commit = { error: commitText.slice(0, 300) }; }
        
        if (!commitRes.ok || commit.success === false || commit.savedToRecords === false) {
          throw new Error(commit.error || commit.message || '图片入库失败');
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
