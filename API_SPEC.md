# SaaS 工具接入规范：积分校验与结果图入库

本文档定义图片类工具接入 SaaS 平台的标准流程。旧工具重构和新工具开发都按这套方式实现。

## 0. 核心原则

1. 用户上传给工具/Gemini/AI 的原图、参考图不进入 SaaS OSS，也不写入“我的图片”。
2. 只有 AI 最终生成成功后的结果图，才允许保存到 SaaS OSS 和 `UserImage` 表。
3. 工具不能持有 SaaS OSS 的永久 AK/SK。
4. 工具不能自己生成 `recordId`，也不能让 SaaS 盲信工具传回的图片记录字段。
5. 结果图唯一保存链路是：SaaS 签发短期 OSS 上传地址，工具后端直传 OSS，SaaS `commit` 校验后入库。

这套方式可以避开浏览器关闭、请求体过大、多图大包中断、主站二次下载再上传等问题。

## 1. 标准流程

工具每次生成都按以下顺序执行：

1. 页面初始化时调用 `/api/tool/launch` 获取用户和工具信息。
2. 用户点击生成前调用 `/api/tool/verify` 校验积分，失败则不生成。
3. 工具后端调用 AI 服务生成图片。
4. 工具后端完成图片压缩、合成、裁剪、排版等内部处理。
5. AI 生成或图片处理失败：不扣费、不上传、不入库。
6. AI 最终结果图生成成功：工具后端调用 `/api/tool/consume` 扣费。
7. 扣费成功后，工具后端调用 `/api/upload/direct-token` 申请短期 OSS 上传地址。
8. 工具后端使用返回的 `uploadUrl` 直接 `PUT` 结果图到 SaaS OSS。
9. 上传成功后，工具后端调用 `/api/upload/commit`。
10. SaaS 校验扣费标记、`objectKey`、OSS 文件存在后，生成 `recordId` 并写入 `UserImage`。
11. 工具后端把最终 `recordId/url/fileName/fileSize` 返回给浏览器。

失败规则：

- `/api/tool/verify` 失败：不调用 AI。
- AI 生成失败：不调用 `/api/tool/consume`。
- 工具内部图片处理失败：不调用 `/api/tool/consume`。
- `/api/tool/consume` 失败：不上传 OSS。
- OSS 上传失败：不调用 `/api/upload/commit`。
- `/api/upload/commit` 失败：前端不要提示保存成功。

## 2. 基础接口

### A. 启动接口：`POST /api/tool/launch`

调用时机：页面初始化。

请求体：

```json
{ "userId": "string", "toolId": "string" }
```

成功响应：

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_xxx",
      "name": "张三",
      "enterprise": "某某公司",
      "integral": 100,
      "role": 1
    },
    "tool": {
      "id": "tool_xxx",
      "name": "AI 图片工具",
      "integral": 10,
      "status": "active"
    }
  }
}
```

### B. 校验接口：`POST /api/tool/verify`

调用时机：用户点击生成按钮后、AI 开始生成前。

请求体：

```json
{ "userId": "string", "toolId": "string" }
```

成功响应：

```json
{
  "success": true,
  "data": {
    "currentIntegral": 100,
    "requiredIntegral": 10
  }
}
```

失败响应：

```json
{
  "success": false,
  "message": "积分不足，还差 5 积分"
}
```

### C. 扣费接口：`POST /api/tool/consume`

调用时机：AI 最终结果图生成成功，并且工具内部图片处理成功之后。

请求体：

```json
{ "userId": "string", "toolId": "string" }
```

成功响应：

```json
{
  "success": true,
  "message": "积分扣除成功",
  "data": {
    "currentIntegral": 90,
    "consumedIntegral": 10,
    "toolId": "tool_xxx"
  }
}
```

扣费成功后，SaaS 会给当前 `userId + toolId` 写入一个短时“结果图待保存”标记。后续 `/api/upload/direct-token` 和 `/api/upload/commit` 都依赖这个标记。

## 3. 唯一结果图保存接口

### D. 申请 OSS 直传地址：`POST /api/upload/direct-token`

调用时机：`/api/tool/consume` 成功之后，工具后端准备上传结果图前。

请求体：

```json
{
  "userId": "string",
  "toolId": "string",
  "source": "result",
  "mimeType": "image/png",
  "fileName": "optional-result.png",
  "fileSize": 8388608
}
```

字段说明：

- `source` 必须是 `result`。
- `mimeType` 必须是图片类型，如 `image/png`、`image/jpeg`、`image/webp`。
- `fileName` 只用于推断扩展名，最终 OSS `objectKey` 由 SaaS 生成。
- `fileSize` 推荐传真实字节数，便于日志和后续扩展校验。

成功响应：

```json
{
  "success": true,
  "source": "result",
  "method": "PUT",
  "objectKey": "result/1778663861275_xxx.png",
  "fileName": "result/1778663861275_xxx.png",
  "uploadUrl": "https://changzhou-saas.oss-cn-shanghai.aliyuncs.com/...",
  "ossUploadUrl": "https://changzhou-saas.oss-cn-shanghai.aliyuncs.com/...",
  "uploadStrategy": "oss-direct",
  "headers": {
    "Content-Type": "image/png"
  },
  "commitUrl": "/api/upload/commit",
  "expiresIn": 600,
  "publicUrl": "https://changzhou-saas.oss-cn-shanghai.aliyuncs.com/result/xxx.png",
  "readUrl": "https://signed-read-url..."
}
```

工具后端拿到响应后，立即把结果图二进制上传到 `uploadUrl`：

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

注意：

- `uploadUrl` 是短期地址，默认 10 分钟过期。
- 上传时必须使用 SaaS 返回的 `headers`，尤其是 `Content-Type`。
- 上传成功只代表 OSS 有文件，还没有写入“我的图片”。必须继续调用 `/api/upload/commit`。

### E. 确认上传并入库：`POST /api/upload/commit`

调用时机：工具后端成功 `PUT` 到 OSS 之后。

请求体：

```json
{
  "userId": "string",
  "toolId": "string",
  "source": "result",
  "objectKey": "result/1778663861275_xxx.png",
  "fileSize": 8388608
}
```

成功响应：

```json
{
  "success": true,
  "source": "result",
  "savedToRecords": true,
  "recordId": "img_xxx",
  "url": "https://signed-read-url...",
  "fileName": "result/1778663861275_xxx.png",
  "image": {
    "recordId": "img_xxx",
    "url": "https://signed-read-url...",
    "fileName": "result/1778663861275_xxx.png",
    "savedToRecords": true
  }
}
```

SaaS 在 `commit` 中会做这些校验：

- `userId/toolId` 对应的扣费待保存标记存在且未过期。
- `source` 是 `result`。
- `objectKey` 合法，不能包含 `..`、反斜杠或绝对路径。
- OSS 文件已经存在。
- 数据库中如果已有同一 `userId + objectKey` 记录，则直接返回已有 `recordId`，避免重复入库。

工具必须以 `commit.image` 或响应里的 `recordId/url/fileName` 作为最终保存结果。

## 4. 多图保存

多张结果图不要合成一个大请求。

工具后端应对每张图独立执行：

1. `/api/upload/direct-token`
2. `PUT uploadUrl`
3. `/api/upload/commit`

全部图片都 `commit` 成功后，再向浏览器返回最终结果。

推荐返回给工具前端的结构：

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

## 5. 平台图片记录展示

工具只负责把结果图保存成功，并把 `/api/upload/commit` 返回的 `image` 或 `recordId/url/fileName/fileSize` 返回给前端。

保存成功后，SaaS 平台会自动在以下页面展示图片记录：

- 用户端“我的图片”：展示当前用户自己的结果图。
- 管理员端“图片管理”：展示所有用户的结果图。

图片记录查询、删除、权限控制和保留周期由 SaaS 平台负责，工具不需要实现，也不要调用图片删除接口。

## 6. 工具后端生成接口要求

工具可以有自己的生成接口，例如：

- `/api/generate`
- `/api/beautify`
- `/api/generate-knife`
- `/api/gemini`

这些接口必须由工具后端完成 AI 生成、图片处理、扣费和 SaaS 保存。不要让浏览器拿到大图后再把大图 POST 到工具的 `/api/save`。

AI 模型调用必须放在工具后端。前端可以调用工具自己的后端接口，例如：

```js
const res = await fetch('/api/gemini', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gemini-2.5-flash',
    payload
  })
});
```

但前端请求体里不要传 `GEMINI_API_KEY`。工具后端接口必须从 `.env` 或部署平台环境变量读取 `GEMINI_API_KEY`：

```js
export async function POST(request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { success: false, error: '缺少 GEMINI_API_KEY' },
      { status: 500 }
    );
  }

  const { model, payload } = await request.json();

  // 在这里由工具后端携带 apiKey 调用 Gemini/AI 服务。
  const result = await callGemini({
    apiKey,
    model,
    payload
  });

  return Response.json({ success: true, data: result });
}
```

注意：

- `GEMINI_API_KEY` 只能放在工具后端运行环境的 `.env` 或部署平台环境变量里。
- 不要使用 `NEXT_PUBLIC_GEMINI_API_KEY` 这类会暴露到浏览器的变量。
- 不要让浏览器直接请求 Gemini 官方接口。
- 不要把 `GEMINI_API_KEY` 写进前端源码、localStorage、URL 参数或请求 body。

正确结构：

```txt
前端 -> 工具生成接口
工具后端 -> /api/tool/verify
工具后端 -> AI 生成
工具后端 -> 图片处理
工具后端 -> /api/tool/consume
工具后端 -> /api/upload/direct-token
工具后端 -> PUT uploadUrl
工具后端 -> /api/upload/commit
工具后端 -> 前端返回结果
```

禁止结构：

```txt
前端 -> 工具生成接口拿到大图
前端 -> 再 POST 大图到 /api/save
```

这种结构容易出现 `413 Request Entity Too Large`，也会在用户关闭页面时中断保存。

## 7. 工具内部图片处理要求

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

## 8. 超时与任务模式

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

## 9. 工具后端参考流程

```js
const SAAS_ORIGIN = process.env.SAAS_ORIGIN || 'https://aibigtree.com';

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

async function verifyBeforeGenerate({ userId, toolId }) {
  const res = await fetch(`${SAAS_ORIGIN}/api/tool/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolId })
  });
  return readJsonResponse(res);
}

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
  await readJsonResponse(consumeRes);

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
  if (!uploadRes.ok) {
    throw new Error(`OSS 上传失败: ${uploadRes.status}`);
  }

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
  if (!commit.savedToRecords) {
    throw new Error(commit.error || '图片入库失败');
  }

  return commit.image;
}
```

生成接口示例：

```js
export async function POST(request) {
  try {
    const { userId, toolId, ...params } = await request.json();

    await verifyBeforeGenerate({ userId, toolId });

    const aiImageBuffer = await generateImage(params);
    const finalImageBuffer = await postProcessImage(aiImageBuffer);

    const image = await saveResultImageToSaas({
      userId,
      toolId,
      imageBuffer: finalImageBuffer,
      mimeType: 'image/png',
      fileName: 'result.png'
    });

    return Response.json({ success: true, image });
  } catch (error) {
    console.error('Generate tool error:', error);
    return Response.json(
      { success: false, error: error.message || '生成失败' },
      { status: 500 }
    );
  }
}
```

## 10. Iframe 初始化消息

SaaS 会通过 `postMessage` 给工具传初始化信息。工具也可以从 URL 参数读取 `userId/toolId`，但推荐以初始化消息为准。

```js
window.addEventListener('message', (event) => {
  if (event.data?.type !== 'SAAS_INIT') return;

  const {
    userId,
    toolId,
    launchUrl,
    verifyUrl,
    consumeUrl,
    uploadTokenUrl,
    uploadCommitUrl
  } = event.data;
});
```

如果没有收到初始化消息，工具可以从 URL 读取 `userId/toolId`，接口域名使用当前 SaaS 域名。

## 11. 禁止事项

1. 不要把用户原图/参考图上传到 SaaS OSS。
2. 不要把 OSS 永久 AK/SK 放进工具项目。
3. 不要把 `GEMINI_API_KEY` 放进前端源码、`NEXT_PUBLIC_*` 环境变量、URL 参数或请求 body。
4. 不要让浏览器直接请求 Gemini/AI 官方接口，必须由工具后端调用。
5. 结果图保存必须由工具后端完成，不要依赖浏览器在页面关闭前完成保存。
6. 结果图保存只使用 `/api/upload/direct-token`、OSS `PUT`、`/api/upload/commit`。
7. 不要让工具自己生成 `recordId` 或让 SaaS 直接信任工具传回的 URL 入库。
8. 不要在 AI 生成失败或图片处理失败时调用 `/api/tool/consume`。
9. 不要同一次生成既直接调用 `/api/tool/consume`，又发 `SAAS_CONSUME` 消息，否则可能重复扣费。
10. 不要让前端把大图 POST 到工具的 `/api/save`。
11. 不要跳过 `sharp().composite()` 前的尺寸检查。
12. 不要让同步生成接口无限等待。
