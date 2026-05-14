import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { images } = await req.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey.trim() === "") {
      return NextResponse.json({ error: "Gemini API Key missing. Please check your AI Studio Secrets panel." }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const parts = images.map((base64: string) => {
      const parts = base64.split(",");
      const mimeType = parts[0].match(/:(.*?);/)?.[1] || "image/jpeg";
      const data = parts[1];
      return {
        inlineData: {
          data,
          mimeType,
        },
      };
    });

    const prompt = "作为专业的家纺电商视觉总监，请分析这些家纺四件套的图片，提取出详细的商品特征。请以JSON格式返回，包含以下字段：material(材质), color(颜色), pattern(图案), style(整体风格), details(细节设计，如花边、刺绣等), sellingPoint(核心卖点)。";

    const result = await model.generateContent([prompt, ...parts]);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json(JSON.parse(text));
  } catch (error: any) {
    console.error("Analysis Error:", error);
    return NextResponse.json({ 
      error: `API Key 验证失败: ${error.message || "未知错误"}` 
    }, { status: 500 });
  }
}
