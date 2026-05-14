import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { images } = await req.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API Key missing (server)" }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = "作为专业的家纺电商视觉总监，请分析这些家纺四件套的图片，提取出详细的商品特征。请按照要求的格式返回。";
      
    const parts: any[] = images.map((base64: string) => {
      const [prefix, data] = base64.split(",");
      const mimeType = prefix.match(/:(.*?);/)?.[1] || "image/jpeg";
      return {
        inlineData: { data, mimeType }
      };
    });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: prompt }, ...parts] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            material: { type: Type.STRING, description: "材质" },
            color: { type: Type.STRING, description: "颜色" },
            pattern: { type: Type.STRING, description: "图案" },
            style: { type: Type.STRING, description: "整体风格" },
            details: { type: Type.STRING, description: "细节设计(花边、刺绣等)" },
            sellingPoint: { type: Type.STRING, description: "核心卖点" }
          },
          required: ["material", "color", "pattern", "style", "details", "sellingPoint"]
        }
      }
    });

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
