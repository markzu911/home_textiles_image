# SaaS 图片工具接入规范

本文档只保留图片类工具必须遵守的接入规则。工具按这里实现后，AI 生成的结果图会保存到 SaaS OSS，并显示在用户端“我的图片”和管理员端“图片管理”。

## 1. 核心规则

1. 用户上传给工具或 AI 的原图、参考图不上传到 SaaS OSS，也不写入图片记录。
2. 只有 AI 最终生成成功的结果图，才保存到 SaaS OSS 和 `UserImage`。
3. 工具不能持有 SaaS OSS 永久 AK/SK。
4. 工具不能自己生成 `recordId`，`recordId` 必须由 SaaS `/api/upload/commit` 返回。
5. AI 生成失败、图片处理失败、OSS 上传失败、入库失败时，都不要扣费或不要返回成功。

## 2. 必须执行的顺序

每次生成都按这个顺序：

1. `/api/tool/verify`：生成前校验积分。
2. 工具后端调用 AI 生成图片。
3. 工具后端完成图片压缩、合成、裁剪等内部处理。
4. `/api/tool/consume`：确认最终结果图生成成功后再扣费。
5. `/api/upload/direct-token`：申请 SaaS OSS 短期直传地址。
6. `PUT uploadUrl`：工具后端把结果图二进制直传到 OSS。
7. `/api/upload/commit`：确认 OSS 文件存在并写入图片记录。
8. 工具后端把 `recordId/url/fileName/fileSize` 返回给前端。

任何一步失败，都返回：

```json
{ "success": false, "error": "明确的失败原因" }
```

## 3. 基础接口

### 校验积分：`POST /api/tool/verify`

请求：

```json
{ "userId": "string", "toolId": "string" }
```

成功：

```json
{
  "success": true,
  "data": {
    "currentIntegral": 100,
    "requiredIntegral": 10
  }
}
```

### 扣费：`POST /api/tool/consume`

调用时机：AI 生成成功，并且工具内部图片处理成功之后。

请求：

```json
{ "userId": "string", "toolId": "string" }
```

成功后，SaaS 会给当前 `userId + toolId` 写入短时“结果图待保存”标记。后续 `direct-token` 和 `commit` 都依赖这个标记。

## 4. 保存结果图

### 申请 OSS 直传地址：`POST /api/upload/direct-token`

请求：

```json
{
  "userId": "string",
  "toolId": "string",
  "source": "result",
  "mimeType": "image/png",
  "fileName": "result.png",
  "fileSize": 8388608
}
```

要求：

- `source` 必须是 `result`。
- `mimeType` 必须是图片类型。
- `fileSize` 传真实字节数。
- 最终 `objectKey` 由 SaaS 返回，工具不要自己拼。

成功响应会包含：

```json
{
  "success": true,
  "method": "PUT",
  "objectKey": "result/xxx.png",
  "uploadUrl": "https://...",
  "headers": {
    "Content-Type": "image/png"
  },
  "commitUrl": "/api/upload/commit"
}
```

### 上传到 OSS

```js
const uploadRes = await fetch(token.uploadUrl, {
  method: token.method || 'PUT',
  headers: token.headers,
  body: imageBuffer
});

if (!uploadRes.ok) {
  throw new Error(`OSS 上传失败: ${uploadRes.status}`);
}
```

### 确认入库：`POST /api/upload/commit`

请求：

```json
{
  "userId": "string",
  "toolId": "string",
  "source": "result",
  "objectKey": "result/xxx.png",
  "fileSize": 8388608
}
```

成功：

```json
{
  "success": true,
  "savedToRecords": true,
  "recordId": "img_xxx",
  "url": "https://signed-read-url...",
  "fileName": "result/xxx.png",
  "image": {
    "recordId": "img_xxx",
    "url": "https://signed-read-url...",
    "fileName": "result/xxx.png",
    "savedToRecords": true
  }
}
```

工具必须以 `commit.image` 或响应里的 `recordId/url/fileName` 作为最终结果。

## 5. 多图保存

多张结果图不要合成一个大请求。每张图独立执行：

1. `/api/upload/direct-token`
2. `PUT uploadUrl`
3. `/api/upload/commit`

全部 `commit` 成功后，再向前端返回：

```json
{
  "success": true,
  "images": [
    {
      "recordId": "img_xxx",
      "url": "https://signed-read-url...",
      "fileName": "result/xxx.png",
      "fileSize": 8388608
    }
  ]
}
```

## 6. 工具内部图片处理要求

工具自己的生成接口，例如 `/api/beautify`、`/api/generate`、`/api/generate-knife`，必须先完成 AI 生成和图片处理，再进入扣费保存流程。

### 输入图

- 用户原图只做临时处理，不进 SaaS OSS。
- 输入图超过 15MB 建议拒绝或压缩。
- 输入图最长边建议压到 `2048` 到 `3072` 像素以内。
- 建议去掉 EXIF，避免隐私和方向错误。

```js
import sharp from 'sharp';

async function normalizeInputImage(inputBuffer) {
  return sharp(inputBuffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}
```

### Sharp 合成

如果使用 `sharp().composite()`，叠加图必须不大于底图，否则会报：

```txt
Image to composite must have same dimensions or smaller
```

所有 `composite` 前都要限制叠加图尺寸：

```js
async function compositeSafely(baseBuffer, overlayBuffer) {
  const baseMeta = await sharp(baseBuffer).metadata();
  if (!baseMeta.width || !baseMeta.height) {
    throw new Error('底图尺寸无效');
  }

  const safeOverlay = await sharp(overlayBuffer, { failOn: 'none' })
    .resize({
      width: baseMeta.width,
      height: baseMeta.height,
      fit: 'inside',
      withoutEnlargement: true
    })
    .png()
    .toBuffer();

  return sharp(baseBuffer)
    .composite([{ input: safeOverlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
}
```

如果使用指定坐标，必须满足：

```js
left >= 0
top >= 0
left + overlayWidth <= baseWidth
top + overlayHeight <= baseHeight
```

## 7. 超时要求

如果工具接口出现 `504 Gateway Time-out`，说明工具后端生成或处理耗时过长。

要求：

- AI 请求必须设置超时，建议 `90` 到 `120` 秒。
- AI 请求失败最多重试 `1` 到 `2` 次。
- 同步接口不要无限等待。
- 如果经常超过 `45` 到 `60` 秒，改成任务模式。

同步模式：

```txt
POST /api/beautify -> AI 生成 -> 图片处理 -> SaaS 保存 -> 返回结果
```

任务模式：

```txt
POST /api/beautify -> 返回 taskId
GET /api/tasks/{taskId} -> 轮询状态
任务完成后，工具后端执行 SaaS 保存链路，并返回 recordId/url
```

## 8. 工具后端保存函数

```js
async function saveResultImageToSaas({
  userId,
  toolId,
  imageBuffer,
  mimeType = 'image/png',
  fileName = 'result.png'
}) {
  const consumeRes = await fetch(`${SAAS_ORIGIN}/api/tool/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolId })
  });
  const consume = await readJsonResponse(consumeRes);
  if (!consume.success) throw new Error(consume.error || consume.message || '扣费失败');

  const tokenRes = await fetch(`${SAAS_ORIGIN}/api/upload/direct-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      toolId,
      source: 'result',
      mimeType,
      fileName,
      fileSize: imageBuffer.byteLength
    })
  });
  const token = await readJsonResponse(tokenRes);

  const uploadRes = await fetch(token.uploadUrl, {
    method: token.method || 'PUT',
    headers: token.headers,
    body: imageBuffer
  });
  if (!uploadRes.ok) throw new Error(`OSS 上传失败: ${uploadRes.status}`);

  const commitRes = await fetch(`${SAAS_ORIGIN}/api/upload/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      toolId,
      source: 'result',
      objectKey: token.objectKey,
      fileSize: imageBuffer.byteLength
    })
  });
  const commit = await readJsonResponse(commitRes);
  if (!commit.success || !commit.savedToRecords) {
    throw new Error(commit.error || '图片入库失败');
  }

  return commit.image;
}

async function readJsonResponse(res) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 300) };
  }

  if (!res.ok || data.success === false) {
    throw new Error(data.error || data.message || `请求失败: ${res.status}`);
  }

  return data;
}
```

## 9. 禁止事项

1. 不要把用户原图、参考图上传到 SaaS OSS。
2. 不要把 OSS 永久 AK/SK 放进工具项目。
3. 不要在 AI 生成失败或图片处理失败时扣费。
4. 不要让浏览器负责最终保存，保存必须在工具后端完成。
5. 不要让工具自己生成 `recordId`。
6. 不要跳过 `sharp().composite()` 前的尺寸检查。
7. 不要让同步生成接口无限等待。
