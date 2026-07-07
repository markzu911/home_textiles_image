import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { images } = await req.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "缺少 GEMINI_API_KEY (Server)" }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `作为专业的家纺电商视觉总监，请分析这些家纺四件套商品图，提取用于后续 AI 生图 100% 还原商品样式的关键特征。
请不要泛泛描述“高级、温馨、柔软”，要尽量写清楚可被图像模型复现的视觉事实：
- 面料材质、厚薄、蓬松度、光泽、纹理颗粒和褶皱状态
- 主色、辅色、明暗层次、色温和饱和度
- 花型/图案的具体类型、大小、密度、排列方向、边界和分布位置
- 包边、花边、刺绣、走线、纽扣、拉链、拼接、压线等工艺细节
- 床品四件套包含的可见部件及摆放方式
返回内容要服务于“商品原图最高优先级还原”，不要把背景、房间风格误写成商品本身风格。请按照要求的 JSON 格式返回。`;
      
    const parts: any[] = images.map((base64: string) => {
      const [prefix, data] = base64.split(",");
      const mimeType = prefix.match(/:(.*?);/)?.[1] || "image/jpeg";
      return {
        inlineData: { data, mimeType }
      };
    });

    const timeoutMsg = "AI 分析超时(120s)，请尝试重新提取";
    let response;
    try {
        response = await Promise.race([
          ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: { parts: [{ text: prompt }, ...parts] },
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  material: { type: Type.STRING, description: "材质" },
                  color: { type: Type.STRING, description: "商品主色、辅色、色温、饱和度和明暗层次" },
                  pattern: { type: Type.STRING, description: "商品花型/图案的类型、大小、密度、排列方向和分布位置" },
                  style: { type: Type.STRING, description: "适合该商品的家纺电商视觉风格，不要把背景误判为商品样式" },
                  details: { type: Type.STRING, description: "商品细节设计，包括花边、包边、刺绣、走线、拼接、纽扣、拉链、褶皱和可见部件" },
                  sellingPoint: { type: Type.STRING, description: "基于商品真实视觉特征提炼的核心卖点" }
                },
                required: ["material", "color", "pattern", "style", "details", "sellingPoint"]
              }
            }
          }),
          new Promise<never>((_, reject) => {
             setTimeout(() => reject(new Error(timeoutMsg)), 120000);
          })
        ]);
    } catch (err: any) {
        return NextResponse.json({ error: `AI 分析失败: ${err.message}` }, { status: 500 });
    }

    let text = response.text;
    if (!text) throw new Error("No response text");
    text = text.trim();
    if (text.startsWith("```json")) {
      text = text.replace(/^```json\n/, "").replace(/```$/, "").trim();
    } else if (text.startsWith("```")) {
      text = text.replace(/^```\n/, "").replace(/```$/, "").trim();
    }

    return NextResponse.json(JSON.parse(text));
  } catch (error: any) {
    console.error("Analysis Error:", error);
    return NextResponse.json({ 
      error: `分析失败: ${error.message || "未知错误"}` 
    }, { status: 500 });
  }
}
