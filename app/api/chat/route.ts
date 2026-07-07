import { GoogleGenAI } from "@google/genai";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

function getGeminiClient() {
  const apiKey = (
    process.env.GEMINI_API_KEY_NEXT ||
    process.env.GEMINI_API_KEY ||
    process.env.API_KEY ||
    ""
  ).trim();

  if (!apiKey) {
    throw new Error("缺少 GEMINI_API_KEY 或 GEMINI_API_KEY_NEXT (Server)");
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "home-textiles-chat-intent",
      },
    },
  });
}

function extractInlineData(image: unknown) {
  if (typeof image !== "string" || !image.includes(",")) return null;
  const [prefix, data] = image.split(",");
  if (!data) return null;

  const mimeType = prefix.match(/:(.*?);/)?.[1] || "image/jpeg";
  return {
    inlineData: {
      data,
      mimeType,
    },
  };
}

function buildContextText(payload: any) {
  const {
    currentSettings,
    currentAnalysis,
    hasProductImages,
    hasSceneImage,
    hasModelImage,
    saasInfo,
  } = payload;

  let contextText = `【当前家纺生图工作区上下文】
- 是否已有商品图: ${hasProductImages ? "是" : "否"}
- 是否已有场景参考图: ${hasSceneImage ? "是" : "否"}
- 是否已有模特参考图: ${hasModelImage ? "是" : "否"}
`;

  if (currentAnalysis) {
    contextText += `- 当前商品分析:
  材质: ${currentAnalysis.material || "未分析"}
  颜色: ${currentAnalysis.color || "未分析"}
  图案: ${currentAnalysis.pattern || "未分析"}
  风格: ${currentAnalysis.style || "未分析"}
  细节: ${currentAnalysis.details || "未分析"}
  卖点: ${currentAnalysis.sellingPoint || "未分析"}
`;
  }

  if (currentSettings) {
    contextText += `- 当前对话生图参数:
  生成类型: ${currentSettings.imageType || "main"}
  风格: ${currentSettings.style || "默认高级家居电商风"}
  画幅: ${currentSettings.aspectRatio || "3:4"}
  数量: ${currentSettings.generationCount || 1}
`;
  }

  if (saasInfo?.context) {
    contextText += `- SaaS 页面上下文: ${saasInfo.context}\n`;
  }
  if (Array.isArray(saasInfo?.prompt) && saasInfo.prompt.length > 0) {
    contextText += `- SaaS 额外约束: ${saasInfo.prompt.join("，")}\n`;
  }

  return contextText;
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const { messages, imageBase64, imagesBase64 } = payload;
    const ai = getGeminiClient();

    const contents: any[] = [
      {
        role: "user",
        parts: [
          {
            text:
              buildContextText(payload) +
              "\n请记住以上上下文。下一步只需要判断用户最新对话意图，并输出指定格式。",
          },
        ],
      },
      {
        role: "model",
        parts: [
          {
            text:
              "收到。我会结合家纺商品上下文、用户历史对话和图片状态，返回自然回复以及可执行的 ACTION JSON。",
          },
        ],
      },
    ];

    if (Array.isArray(messages)) {
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const role = message?.role === "assistant" ? "model" : "user";
        const parts: any[] = [{ text: String(message?.content || "") }];
        const attachedImages = Array.isArray(message?.images)
          ? message.images
          : message?.image
            ? [message.image]
            : [];

        for (const image of attachedImages) {
          const inlineData = extractInlineData(image);
          if (inlineData) parts.push(inlineData);
        }

        if (i === messages.length - 1 && role === "user" && attachedImages.length === 0) {
          const currentImages = Array.isArray(imagesBase64)
            ? imagesBase64
            : imageBase64
              ? [imageBase64]
              : [];
          for (const image of currentImages) {
            const inlineData = extractInlineData(image);
            if (inlineData) parts.push(inlineData);
          }
        }

        contents.push({ role, parts });
      }
    }

    const systemInstruction = `你是专业的家纺电商视觉总监和 AI 对话生图助手。你的任务不是直接生成图片，而是根据用户最新一句话、历史对话、上传图片和当前上下文，判断下一步应该执行什么动作。

【核心约束】
- 输出必须只包含 [REPLY] 和 [ACTION] 两段。
- [REPLY] 写给用户，使用简洁自然的中文。
- [ACTION] 必须是完全合法的 JSON，不允许注释、Markdown 或多余文本。
- 新回复必须针对最新用户请求，严禁复制历史回复。
- 不要引入服装、电商服饰、穿搭等无关领域概念；所有判断都围绕家纺、床品、四件套、被套、枕套、面料、卧室场景和生活方式视觉。

【动作 action 定义】
1. "analyze_image": 用户上传了家纺商品图，或明确要求分析商品材质/颜色/图案/卖点。
2. "generate_smart": 用户明确要求生成、出图、做图、画一张/多张，或给出了足够明确的画面要求并要求开始。
3. "update_config": 用户只是在修改参数，例如风格、画幅、主图/细节、数量、是否使用场景或模特，但没有明确要求立即生成。
4. "none": 普通问答、引导上传、解释能力，或信息不足需要继续询问。

【图片类型 detectedImageType】
- "product": 家纺商品图、床品图、四件套图。
- "scene": 卧室、空间、样板间、参考场景图。
- "model": 人物、模特、真人参考图。
- "none": 没有新图片或无法判断。

【生成类型 smartParams.type】
- "main": 电商商品主图或整体场景图，突出床品整体效果、空间氛围、购买转化。
- "closeup": 细节近景图，突出面料纹理、花型、刺绣、走线、褶皱、触感。

【directGenerate 规则】
- 用户明确说“生成/出图/做图/画一张/来一张/开始/直接生成”等，directGenerate 必须为 true。
- 用户只说“想要奶油风”“比例改成 1:1”“换成细节图”“生成两张”但没有要求开始，action 用 "update_config"，directGenerate 为 false。
- 用户要求上传商品图/场景图/模特图，action 用 "none"，directGenerate 为 false，并在 reply 引导点击上传按钮。
- 如果缺少商品图也可以按文字生成，但 reply 要提醒“有商品图会更好还原花型和材质”。

【输出格式】
[REPLY]
中文回复

[ACTION]
注意：下面的枚举只表示可选范围，实际输出 JSON 中每个字段只能填写一个具体值。
{
  "action": "analyze_image" | "generate_smart" | "update_config" | "none",
  "actionExplanation": "中文动作说明",
  "detectedImageType": "product" | "scene" | "model" | "none",
  "directGenerate": true | false,
  "smartParams": {
    "type": "main" | "closeup",
    "config": {
      "style": "家纺场景风格，例如温馨奶油风/现代轻奢风/极简原木风",
      "aspectRatio": "3:4" | "1:1" | "4:3" | "16:9",
      "generationCount": 1 | 2 | 3 | 4
    },
    "analysis": {
      "material": "可选，用户补充的材质",
      "color": "可选，用户补充的颜色",
      "pattern": "可选，用户补充的图案",
      "style": "可选，用户补充的风格",
      "details": "可选，用户补充的画面细节",
      "sellingPoint": "可选，用户补充的卖点"
    },
    "extraInstruction": "把用户最新要求整理成可追加到生图 prompt 的自然语言"
  }
}

【合法示例】
如果用户说“生成一张奶油风卧室商品主图，3:4”：
[REPLY]
好的，我会按奶油风卧室氛围生成一张 3:4 的家纺商品主图，并优先突出床品整体质感。

[ACTION]
{
  "action": "generate_smart",
  "actionExplanation": "按用户描述直接生成家纺商品主图",
  "detectedImageType": "none",
  "directGenerate": true,
  "smartParams": {
    "type": "main",
    "config": {
      "style": "温馨奶油风卧室，低饱和配色，柔和自然光",
      "aspectRatio": "3:4",
      "generationCount": 1
    },
    "extraInstruction": "生成一张温馨奶油风卧室中的家纺商品主图，3:4 竖版，突出床品整体蓬松质感。"
  }
}`;

    const modelCandidates = [
      process.env.GEMINI_CHAT_MODEL,
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ].filter(Boolean) as string[];

    let responseStream: Awaited<ReturnType<typeof ai.models.generateContentStream>> | null = null;
    let lastError: unknown = null;

    for (const model of modelCandidates) {
      try {
        responseStream = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction,
            temperature: 0.45,
          },
        });
        break;
      } catch (error) {
        lastError = error;
        console.warn(`Chat intent model ${model} failed, trying fallback...`, error);
      }
    }

    if (!responseStream) {
      throw lastError instanceof Error ? lastError : new Error("AI 对话解析失败");
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream) {
            if (chunk.text) {
              controller.enqueue(encoder.encode(chunk.text));
            }
          }
        } catch (error: any) {
          controller.enqueue(encoder.encode(`\n\n[ERROR]\n${error.message || "AI 对话解析中断"}`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("Chat API Error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message || "AI 对话失败" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
