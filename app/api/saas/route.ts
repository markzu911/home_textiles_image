import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { 
      imageBase64,
      mimeType,
      saasInfo
    } = await req.json();

    const finalImageBuffer = Buffer.from(imageBase64, 'base64');
    let responseImage: any = `data:${mimeType};base64,${imageBase64}`;

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
            mimeType: mimeType,
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
  } catch (error: any) {
    console.error("SAAS Route Error:", error);
    return NextResponse.json({ 
      error: `保存失败: ${error.message || "未知错误"}` 
    }, { status: 500 });
  }
}
