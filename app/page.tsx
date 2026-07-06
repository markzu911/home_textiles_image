"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload,
  Image as ImageIcon,
  Sparkles,
  ArrowRight,
  Check,
  Loader2,
  RefreshCw,
  Download,
  X,
  ArrowLeft,
  Settings,
  MessageCircle,
  Send,
  Wand2,
  Bot,
  UserRound,
  Images,
  Home as HomeIcon,
} from "lucide-react";
import Image from "next/image";
import { compressImage } from "@/lib/utils";

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

type WorkspaceMode = "HOME" | "STANDARD" | "CHAT";
type Step = "UPLOAD" | "ANALYZING" | "EDIT" | "GENERATING" | "RESULT";
type ImageType = "main" | "closeup";
type ChatActionType =
  | "uploadProduct"
  | "uploadScene"
  | "uploadModel"
  | "analyze"
  | "generate"
  | "style"
  | "aspect"
  | "imageType"
  | "count";

interface SaasInfo {
  userId?: string | null;
  toolId?: string | null;
  context?: string;
  prompt?: string[];
  apiBaseUrl?: string;
  launchUrl?: string;
  verifyUrl?: string;
  consumeUrl?: string;
  uploadTokenUrl?: string;
  uploadCommitUrl?: string;
}

interface AnalysisResult {
  material: string;
  color: string;
  pattern: string;
  style: string;
  details: string;
  sellingPoint: string;
}

interface ChatAction {
  type: ChatActionType;
  label: string;
  value?: string;
  description?: string;
}

interface ChatGeneration {
  status: "loading" | "success" | "error";
  images?: string[];
  error?: string;
  note?: string;
  aspectRatio?: string;
}

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  content?: string;
  images?: string[];
  actions?: ChatAction[];
  generation?: ChatGeneration;
}

interface GenerationPromptOptions {
  analysis: AnalysisResult;
  imageType: ImageType;
  hasProductImages: boolean;
  sceneImage?: string | null;
  modelImage?: string | null;
  saasInfo?: SaasInfo;
  extraInstruction?: string;
}

interface GenerateRequestOptions {
  model: string;
  prompt: string;
  images: string[];
  sceneImage?: string | null;
  modelImage?: string | null;
  aspectRatio: string;
  saasInfo: SaasInfo;
}

interface ChatGenerationSettings {
  style: string | null;
  aspectRatio: string;
  imageType: ImageType;
  generationCount: number;
}

const DEFAULT_GEN_MODEL = "gemini-3.1-flash-image-preview";
const DEFAULT_ASPECT_RATIO = "3:4";

const PRESET_STYLES = [
  "极简原木风 (阳光、白墙、原木床架)",
  "法式复古风 (石膏线、复古吊灯、法式门窗)",
  "现代轻奢风 (大理石、金属元素、高级灰背景)",
  "温馨奶油风 (低饱和度、毛绒地毯、暖色氛围灯)",
];

const ASPECT_RATIO_OPTIONS = [
  { value: "3:4", label: "3:4", description: "竖版电商" },
  { value: "1:1", label: "1:1", description: "方形主图" },
  { value: "4:3", label: "4:3", description: "横版展示" },
  { value: "16:9", label: "16:9", description: "宽屏海报" },
];

const IMAGE_TYPE_OPTIONS = [
  { value: "main", label: "电商主图", description: "整体视觉效果" },
  { value: "closeup", label: "细节近景", description: "面料与做工特写" },
];

const CHAT_WELCOME_ACTIONS: ChatAction[] = [
  { type: "uploadProduct", label: "上传商品图", description: "可选，保持花色与细节一致" },
  { type: "generate", label: "直接按文字生成" },
];

const getChatId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getAspectClassName = (ratio: string) => {
  if (ratio === "1:1") return "aspect-square";
  if (ratio === "4:3") return "aspect-[4/3]";
  if (ratio === "16:9") return "aspect-video";
  return "aspect-[3/4]";
};

const createFallbackAnalysis = (instruction: string, style?: string | null): AnalysisResult => ({
  material: "根据用户描述选择适合家纺电商展示的高级面料质感",
  color: "根据用户描述确定主色，未说明时使用柔和、高级、耐看的配色",
  pattern: "根据用户描述确定图案，未说明时使用克制纹理或低饱和花型",
  style: style || "现代高级家居电商风",
  details: instruction || "高级质感家纺四件套，画面干净，细节清晰",
  sellingPoint: "舒适触感、高端质感、生活方式氛围与电商转化友好",
});

const inferChatSettingsFromText = (
  text: string,
  current: ChatGenerationSettings
): ChatGenerationSettings => {
  let next = { ...current };

  if (/奶油|温馨/.test(text)) next.style = PRESET_STYLES[3];
  if (/轻奢|高级灰|大理石|金属/.test(text)) next.style = PRESET_STYLES[2];
  if (/法式|复古/.test(text)) next.style = PRESET_STYLES[1];
  if (/极简|原木/.test(text)) next.style = PRESET_STYLES[0];

  if (/1\s*[:：]\s*1|方图|方形/.test(text)) next.aspectRatio = "1:1";
  if (/3\s*[:：]\s*4|竖版|竖图/.test(text)) next.aspectRatio = "3:4";
  if (/4\s*[:：]\s*3|横版展示/.test(text)) next.aspectRatio = "4:3";
  if (/16\s*[:：]\s*9|宽屏|横屏|海报/.test(text)) next.aspectRatio = "16:9";

  if (/细节|近景|特写|close.?up/i.test(text)) next.imageType = "closeup";
  if (/主图|整体|main/i.test(text)) next.imageType = "main";

  const numericCount = text.match(/([1-4])\s*张/);
  if (numericCount) next.generationCount = Number(numericCount[1]);
  if (/两张|2张/.test(text)) next.generationCount = 2;
  if (/四张|4张/.test(text)) next.generationCount = 4;
  if (/一张|1张/.test(text)) next.generationCount = 1;

  return next;
};

const getParameterActionsForText = (text: string): ChatAction[] => {
  if (/风格/.test(text)) {
    return PRESET_STYLES.map((preset) => ({
      type: "style",
      label: preset.split(" ")[0],
      value: preset,
    }));
  }
  if (/比例|尺寸|大小|画幅/.test(text)) {
    return ASPECT_RATIO_OPTIONS.map((option) => ({
      type: "aspect",
      label: `${option.label} ${option.description}`,
      value: option.value,
    }));
  }
  if (/类型|主图|细节|近景|特写/.test(text)) {
    return IMAGE_TYPE_OPTIONS.map((option) => ({
      type: "imageType",
      label: option.label,
      value: option.value,
      description: option.description,
    }));
  }
  if (/数量|几张/.test(text)) {
    return [1, 2, 4].map((count) => ({
      type: "count",
      label: `${count} 张`,
      value: String(count),
    }));
  }
  if (/参数|设置|选项/.test(text)) {
    return [
      { type: "uploadProduct", label: "上传商品图" },
      { type: "style", label: "温馨奶油风", value: PRESET_STYLES[3] },
      { type: "aspect", label: "1:1 方图", value: "1:1" },
      { type: "imageType", label: "细节近景", value: "closeup" },
      { type: "count", label: "2 张", value: "2" },
      { type: "generate", label: "生成图片" },
    ];
  }
  return [];
};

const buildGenerationPrompt = ({
  analysis,
  imageType,
  hasProductImages,
  sceneImage,
  modelImage,
  saasInfo,
  extraInstruction,
}: GenerationPromptOptions) => {
  const isMain = imageType === "main";
  const typeName = isMain ? "电商主图" : "细节近景图";
  const typeDesc = isMain
    ? "构图突出床品四件套本身，展现整体的视觉效果和生活气息。"
    : "【极其重要】：构图必须采用极近的微距（Macro）或特写（Close-up）视角，镜头需要非常贴近床品！极力展现面料的纹理、材质的细腻感、以及精致的做工细节（如走线、花边、刺绣等）。床品的摆放必须显得随意、凌乱、自然（例如：掀开的一角、堆叠的褶皱），绝对不要整齐平铺！";

  let basePrompt = hasProductImages
    ? `作为专业的家纺电商视觉总监和图像后期专家，请基于我提供的原图，生成一张精美的家纺四件套${typeName}。
【注意】：我提供了以下图片：
1. 【商品原图】（必须100%还原细节，但可改变摆放方式）。
${sceneImage ? "2. 【场景/风格参考图】（必须100%严格复刻该场景）。\n" : ""}${modelImage ? `${sceneImage ? "3" : "2"}. 【模特参考图】（必须100%还原面容，但可改变姿势动作）。\n` : ""}
商品细节如下：
- 材质：${analysis.material}
- 颜色：${analysis.color}
- 图案：${analysis.pattern}
${sceneImage ? "" : `- 风格：${analysis.style}\n`}- 细节：${analysis.details}
- 核心卖点：${analysis.sellingPoint}

【极其重要的要求】：
1. 【商品还原】：必须 100% 还原【商品原图】中的商品材质、花纹、颜色、细节等，绝对不要改变商品的任何原有设计！
2. 【摆放与视角】：在保持商品100%还原的前提下，${typeDesc}
3. 绝对不要在画面中新增任何商标、Logo、文字、水印 or 多余的装饰物！
4. 【场景与风格】：${sceneImage ? "必须 100% 严格复刻【场景/风格参考图】中的所有场景元素（包括房间结构、背景墙、家具款式、装饰品、光影氛围等），绝对不要改变场景的原有布局，直接将商品自然地融入该场景中。请忽略任何文字描述的风格，完全以这张参考图为准！" : "请大胆改变房间的布局、家具款式、背景墙、装饰品（如地毯、灯具、植物、窗外风景等），以展现不同的家居氛围。"}
${modelImage ? "5. 【模特融入】：必须 100% 还原【模特参考图】中人物的面容长相、五官特征和身材比例！但是，你可以自由改变模特的姿势、神态、表情和肢体动作（例如：坐在床边、躺在床上、整理床铺等），使其与家纺产品产生自然的互动，光影需与场景统一。" : ""}
6. 仅对光影、材质表现力进行高级渲染，使其具备高端家纺品牌的质感。
7. 画质要求：8K超高清，极致细节，电影级画质，摄影级高级打光，超高分辨率。`
    : `作为专业的家纺电商视觉总监和图像后期专家，请根据用户的对话需求，生成一张精美的家纺四件套${typeName}。
${sceneImage ? "【场景/风格参考图】：必须严格参考我上传的场景图，将家纺产品自然融入该空间。\n" : ""}${modelImage ? "【模特参考图】：如画面需要人物，请参考我上传的模特图，并让人物与家纺产品自然互动。\n" : ""}
商品与画面需求如下：
- 材质：${analysis.material}
- 颜色：${analysis.color}
- 图案：${analysis.pattern}
${sceneImage ? "" : `- 风格：${analysis.style}\n`}- 细节：${analysis.details}
- 核心卖点：${analysis.sellingPoint}

【极其重要的要求】：
1. 【画面主体】：必须明确呈现家纺四件套，不能生成无关产品。
2. 【摆放与视角】：${typeDesc}
3. 绝对不要在画面中新增任何商标、Logo、文字、水印 or 多余的装饰物！
4. 【场景与风格】：${sceneImage ? "必须严格参考【场景/风格参考图】中的房间结构、家具款式、装饰品、光影氛围。" : "请构建有高级生活感的卧室场景，布局自然，符合家纺电商视觉。"}
${modelImage ? "5. 【模特融入】：如出现人物，需参考【模特参考图】的面容和身材比例，并保持光影与场景统一。" : ""}
6. 仅对光影、材质表现力进行高级渲染，使其具备高端家纺品牌的质感。
7. 画质要求：8K超高清，极致细节，电影级画质，摄影级高级打光，超高分辨率。`;

  if (extraInstruction?.trim()) {
    basePrompt += `\n【用户对话补充要求】：\n${extraInstruction.trim()}`;
  }
  if (saasInfo?.context) {
    basePrompt += `\n【内容主体补充】：\n${saasInfo.context}`;
  }
  if (saasInfo?.prompt && saasInfo.prompt.length > 0) {
    basePrompt += `\n【补充约束】：\n${saasInfo.prompt.join("，")}`;
  }

  return basePrompt;
};

const readJsonResponse = async (res: Response, fallbackPrefix: string) => {
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return res.json();
  }
  await res.text();
  throw new Error(`${fallbackPrefix} (${res.status}): 请重试`);
};

const analyzeImages = async (images: string[]) => {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images }),
  });
  const data = await readJsonResponse(res, "请求超时或服务端异常");
  if (!res.ok) {
    throw new Error(data.error || "分析失败");
  }
  return data as AnalysisResult;
};

const requestGeneratedImage = async ({
  model,
  prompt,
  images,
  sceneImage,
  modelImage,
  aspectRatio,
  saasInfo,
}: GenerateRequestOptions) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        images,
        sceneImage,
        modelImage,
        aspectRatio,
        saasInfo,
      }),
      signal: controller.signal,
    });
    const data = await readJsonResponse(res, "生成超时或服务端异常");
    if (!res.ok) throw new Error(data.error || "生成失败");

    const url = data.image?.url || data.image || data.url;
    if (!url) throw new Error("生成失败，未返回图片数据");
    return url as string;
  } finally {
    clearTimeout(timeout);
  }
};

export default function Home() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("HOME");
  const [step, setStep] = useState<Step>("UPLOAD");
  const [images, setImages] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [genModel, setGenModel] = useState(DEFAULT_GEN_MODEL);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  const [generationCount, setGenerationCount] = useState<number>(1);
  const [imageTypes, setImageTypes] = useState<ImageType[]>(["main"]);
  const [sceneImage, setSceneImage] = useState<string | null>(null);
  const [modelImage, setModelImage] = useState<string | null>(null);
  const [saasInfo, setSaasInfo] = useState<SaasInfo>(() => {
    if (typeof window === "undefined") return {};
    const params = new URLSearchParams(window.location.search);
    const urlUserId = params.get("userId");
    const urlToolId = params.get("toolId");
    if (urlUserId && urlToolId) {
      return { userId: urlUserId, toolId: urlToolId };
    }
    return {};
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
        id: "welcome",
        role: "assistant",
        content:
        "欢迎来到 AI 对话生图。直接说你想要的家纺画面就行；需要上传图片、选择风格或比例时，我会在对话里给你对应卡片。",
      actions: CHAT_WELCOME_ACTIONS,
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBrief, setChatBrief] = useState("");
  const [chatImages, setChatImages] = useState<string[]>([]);
  const [chatSceneImage, setChatSceneImage] = useState<string | null>(null);
  const [chatModelImage, setChatModelImage] = useState<string | null>(null);
  const [chatAnalysis, setChatAnalysis] = useState<AnalysisResult | null>(null);
  const [chatStyle, setChatStyle] = useState<string | null>(null);
  const [chatAspectRatio, setChatAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  const [chatImageType, setChatImageType] = useState<ImageType>("main");
  const [chatGenerationCount, setChatGenerationCount] = useState<number>(1);
  const [chatGeneratedImages, setChatGeneratedImages] = useState<string[]>([]);
  const [chatIsBusy, setChatIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sceneInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const chatProductInputRef = useRef<HTMLInputElement>(null);
  const chatSceneInputRef = useRef<HTMLInputElement>(null);
  const chatModelInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === "SAAS_INIT") {
        const { 
          userId, 
          toolId, 
          launchUrl, 
          verifyUrl, 
          consumeUrl, 
          uploadTokenUrl, 
          uploadCommitUrl,
          apiBaseUrl
        } = event.data;
        let { context, prompt } = event.data;
        
        // Filter out "null" or "undefined" as required by spec
        if (context === "null" || context === "undefined") context = "";
        
        let validPrompt: string[] = [];
        if (Array.isArray(prompt)) {
          validPrompt = prompt.filter(p => typeof p === 'string' && p !== "null" && p !== "undefined");
        }

        setSaasInfo({
          userId,
          toolId,
          context,
          prompt: validPrompt,
          launchUrl,
          verifyUrl,
          consumeUrl,
          uploadTokenUrl,
          uploadCommitUrl,
          apiBaseUrl
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (workspaceMode !== "CHAT") return;
    const target = chatScrollRef.current;
    if (!target) return;
    target.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
  }, [chatMessages, workspaceMode]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    try {
      const compressPromises = Array.from(files).map((file) => compressImage(file));
      const compressedImages = await Promise.all(compressPromises);
      setImages((prev) => [...prev, ...compressedImages]);
    } catch (err) {
      console.error("Failed to compress images:", err);
      // Fallback or show error
      setError("图片处理失败，请重试");
    }
  };

  const handleSceneUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setSceneImage(compressed);
    } catch (err) {
      console.error("Failed to compress scene image:", err);
    }
  };

  const handleModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setModelImage(compressed);
    } catch (err) {
      console.error("Failed to compress model image:", err);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const startAnalysis = async () => {
    if (images.length === 0) return;
    setStep("ANALYZING");
    setError(null);

    try {
      const data = await analyzeImages(images);
      setAnalysis(data);
      setStep("EDIT");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "分析过程中发生错误，请重试。");
      setStep("UPLOAD");
    }
  };

  const generateImage = async () => {
    if (!analysis) return;

    setStep("GENERATING");
    setError(null);

    try {
      const generatedList: string[] = [];
      let partialError = null;

      try {
        for (const type of imageTypes) {
          const prompt = buildGenerationPrompt({
            analysis,
            imageType: type,
            hasProductImages: images.length > 0,
            sceneImage,
            modelImage,
            saasInfo,
          });
          
          for (let i = 0; i < generationCount; i++) {
            const url = await requestGeneratedImage({
              model: genModel,
              prompt,
              images,
              sceneImage,
              modelImage,
              aspectRatio,
              saasInfo,
            });
            generatedList.push(url);
          }
        }
      } catch (e: any) {
        partialError = e;
      }

      if (generatedList.length > 0) {
        setGeneratedImages((prev) => [...generatedList, ...prev]);
        setSelectedImageIndex(0);
        setStep("RESULT");
        if (partialError) {
          setError("部分生成失败: " + (partialError.message || "未知错误") + "，已为您保留成功的图片");
        }
      } else {
        if (partialError) throw partialError;
        throw new Error("生成失败，未返回图片数据");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "生成图片过程中发生错误，请重试。");
      setStep("EDIT");
    }
  };

  const reset = () => {
    setStep("UPLOAD");
    setImages([]);
    setAnalysis(null);
    setGeneratedImages([]);
    setSelectedImageIndex(0);
    setError(null);
    setGenModel(DEFAULT_GEN_MODEL);
    setAspectRatio(DEFAULT_ASPECT_RATIO);
    setGenerationCount(1);
    setSceneImage(null);
    setModelImage(null);
  };

  const resetChat = () => {
    setChatMessages([
      {
        id: getChatId(),
        role: "assistant",
        content:
          "欢迎来到 AI 对话生图。直接说你想要的家纺画面就行；需要上传图片、选择风格或比例时，我会在对话里给你对应卡片。",
        actions: CHAT_WELCOME_ACTIONS,
      },
    ]);
    setChatInput("");
    setChatBrief("");
    setChatImages([]);
    setChatSceneImage(null);
    setChatModelImage(null);
    setChatAnalysis(null);
    setChatStyle(null);
    setChatAspectRatio(DEFAULT_ASPECT_RATIO);
    setChatImageType("main");
    setChatGenerationCount(1);
    setChatGeneratedImages([]);
    setChatIsBusy(false);
  };

  const addChatMessage = (message: Omit<ChatMessage, "id">) => {
    const id = getChatId();
    setChatMessages((prev) => [...prev, { id, ...message }]);
    return id;
  };

  const updateChatMessage = (id: string, patch: Partial<ChatMessage>) => {
    setChatMessages((prev) =>
      prev.map((message) =>
        message.id === id ? { ...message, ...patch } : message
      )
    );
  };

  const getChatAnalysis = (brief: string, style = chatStyle) => {
    const base = chatAnalysis || createFallbackAnalysis(brief, style);
    if (style && !chatSceneImage) {
      return { ...base, style };
    }
    return base;
  };

  const runChatAnalysis = async (targetImages = chatImages) => {
    if (targetImages.length === 0) {
      addChatMessage({
        role: "assistant",
        content: "先上传商品图，我才能像常规生图一样提取材质、颜色、图案和卖点。",
        actions: [{ type: "uploadProduct", label: "上传商品图" }],
      });
      return null;
    }

    setChatIsBusy(true);
    const statusId = addChatMessage({
      role: "assistant",
      content: "我正在分析商品图，提取材质、颜色、图案和核心卖点。",
    });

    try {
      const data = await analyzeImages(targetImages);
      const nextAnalysis = chatStyle ? { ...data, style: chatStyle } : data;
      setChatAnalysis(nextAnalysis);
      updateChatMessage(statusId, {
        content:
          "商品特征已提取完成。你可以继续补充场景、选择比例或直接生成图片。",
        actions: [
          { type: "generate", label: "生成图片" },
          { type: "uploadScene", label: "上传场景图" },
          { type: "imageType", label: "细节近景", value: "closeup" },
          { type: "aspect", label: "1:1 方图", value: "1:1" },
        ],
      });
      return nextAnalysis;
    } catch (err: any) {
      updateChatMessage(statusId, {
        content: err.message || "商品分析失败，你可以重试，也可以先按文字要求生成。",
        actions: [
          { type: "analyze", label: "重新分析" },
          { type: "generate", label: "先生成" },
        ],
      });
      return null;
    } finally {
      setChatIsBusy(false);
    }
  };

  const handleChatProductUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      setChatIsBusy(true);
      const compressedImages = await Promise.all(
        Array.from(files).map((file) => compressImage(file))
      );
      const nextImages = [...chatImages, ...compressedImages];
      setChatImages(nextImages);
      addChatMessage({
        role: "user",
        content: `已上传 ${compressedImages.length} 张商品图`,
        images: compressedImages,
      });
      setChatIsBusy(false);
      await runChatAnalysis(nextImages);
    } catch (err: any) {
      setChatIsBusy(false);
      addChatMessage({
        role: "assistant",
        content: err.message || "图片处理失败，请重新上传。",
        actions: [{ type: "uploadProduct", label: "重新上传" }],
      });
    } finally {
      e.target.value = "";
    }
  };

  const handleChatSceneUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setChatIsBusy(true);
      const compressed = await compressImage(file);
      setChatSceneImage(compressed);
      addChatMessage({
        role: "user",
        content: "已上传场景参考图",
        images: [compressed],
      });
      addChatMessage({
        role: "assistant",
        content: "收到场景图。生成时我会优先复刻这张图里的空间、家具、光影和氛围。",
        actions: [
          { type: "generate", label: "生成图片" },
          { type: "uploadProduct", label: "补充商品图" },
        ],
      });
    } catch (err: any) {
      addChatMessage({
        role: "assistant",
        content: err.message || "场景图处理失败，请重试。",
      });
    } finally {
      setChatIsBusy(false);
      e.target.value = "";
    }
  };

  const handleChatModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setChatIsBusy(true);
      const compressed = await compressImage(file);
      setChatModelImage(compressed);
      addChatMessage({
        role: "user",
        content: "已上传模特参考图",
        images: [compressed],
      });
      addChatMessage({
        role: "assistant",
        content: "收到模特图。生成时如需要人物，我会让模特与床品自然互动并保持场景光影统一。",
        actions: [{ type: "generate", label: "生成图片" }],
      });
    } catch (err: any) {
      addChatMessage({
        role: "assistant",
        content: err.message || "模特图处理失败，请重试。",
      });
    } finally {
      setChatIsBusy(false);
      e.target.value = "";
    }
  };

  const generateChatImage = async (
    briefOverride?: string,
    settingsOverride?: Partial<ChatGenerationSettings>
  ) => {
    const activeBrief = (briefOverride ?? chatBrief).trim();
    const activeStyle = settingsOverride?.style ?? chatStyle;
    const activeAspectRatio = settingsOverride?.aspectRatio ?? chatAspectRatio;
    const activeImageType = settingsOverride?.imageType ?? chatImageType;
    const activeGenerationCount =
      settingsOverride?.generationCount ?? chatGenerationCount;

    if (!activeBrief && chatImages.length === 0 && !chatSceneImage && !chatModelImage) {
      addChatMessage({
        role: "assistant",
        content:
          "先告诉我你想要什么画面。你也可以上传商品图，我会参考它来保持花色和细节。",
        actions: [
          { type: "uploadProduct", label: "上传商品图" },
          { type: "uploadScene", label: "上传场景图" },
          { type: "style", label: "温馨奶油风", value: PRESET_STYLES[3] },
        ],
      });
      return;
    }

    setChatIsBusy(true);
    const generationId = addChatMessage({
      role: "assistant",
      content: "生成卡片",
      generation: {
        status: "loading",
        note: "正在调用图像模型生成，请稍候...",
      },
    });

    try {
      const prompt = buildGenerationPrompt({
        analysis: getChatAnalysis(activeBrief, activeStyle),
        imageType: activeImageType,
        hasProductImages: chatImages.length > 0,
        sceneImage: chatSceneImage,
        modelImage: chatModelImage,
        saasInfo,
        extraInstruction: activeBrief,
      });
      const generatedList: string[] = [];
      let partialError: any = null;

      try {
        for (let i = 0; i < activeGenerationCount; i++) {
          const url = await requestGeneratedImage({
            model: genModel,
            prompt,
            images: chatImages,
            sceneImage: chatSceneImage,
            modelImage: chatModelImage,
            aspectRatio: activeAspectRatio,
            saasInfo,
          });
          generatedList.push(url);
        }
      } catch (err: any) {
        partialError = err;
      }

      if (generatedList.length === 0) {
        throw partialError || new Error("生成失败，未返回图片数据");
      }

      setChatGeneratedImages((prev) => [...generatedList, ...prev]);
      updateChatMessage(generationId, {
        content: "生成完成",
        generation: {
          status: "success",
          images: generatedList,
          aspectRatio: activeAspectRatio,
          note: partialError
            ? `部分生成失败：${partialError.message || "未知错误"}，成功图片已保留。`
            : "图片已生成在对话中。",
        },
        actions: [
          { type: "generate", label: "再生成一版" },
          {
            type: "imageType",
            label: activeImageType === "main" ? "改成细节近景" : "改成电商主图",
            value: activeImageType === "main" ? "closeup" : "main",
          },
          { type: "uploadScene", label: "更换场景图" },
        ],
      });
    } catch (err: any) {
      updateChatMessage(generationId, {
        content: "生成失败",
        generation: {
          status: "error",
          error: err.message || "生成图片过程中发生错误，请重试。",
        },
        actions: [
          { type: "generate", label: "重试生成" },
          { type: "uploadProduct", label: "补充商品图" },
        ],
      });
    } finally {
      setChatIsBusy(false);
    }
  };

  const handleChatAction = async (action: ChatAction) => {
    if (chatIsBusy && action.type !== "uploadProduct" && action.type !== "uploadScene" && action.type !== "uploadModel") {
      return;
    }

    if (action.type === "uploadProduct") {
      chatProductInputRef.current?.click();
      return;
    }
    if (action.type === "uploadScene") {
      chatSceneInputRef.current?.click();
      return;
    }
    if (action.type === "uploadModel") {
      chatModelInputRef.current?.click();
      return;
    }
    if (action.type === "analyze") {
      await runChatAnalysis();
      return;
    }
    if (action.type === "generate") {
      await generateChatImage();
      return;
    }
    if (action.type === "style" && action.value) {
      setChatStyle(action.value);
      setChatAnalysis((prev) => (prev ? { ...prev, style: action.value || prev.style } : prev));
      addChatMessage({ role: "user", content: `选择风格：${action.value}` });
      addChatMessage({
        role: "assistant",
        content: "风格已记录。你可以继续补充文字，或者直接生成。",
        actions: [{ type: "generate", label: "生成图片" }],
      });
      return;
    }
    if (action.type === "aspect" && action.value) {
      setChatAspectRatio(action.value);
      addChatMessage({ role: "user", content: `选择比例：${action.value}` });
      addChatMessage({
        role: "assistant",
        content: "尺寸比例已更新。",
        actions: [{ type: "generate", label: "生成图片" }],
      });
      return;
    }
    if (action.type === "imageType" && action.value) {
      setChatImageType(action.value as ImageType);
      addChatMessage({
        role: "user",
        content: `选择生成类型：${action.value === "main" ? "电商主图" : "细节近景"}`,
      });
      addChatMessage({
        role: "assistant",
        content: "生成类型已更新。",
        actions: [{ type: "generate", label: "生成图片" }],
      });
      return;
    }
    if (action.type === "count" && action.value) {
      setChatGenerationCount(Number(action.value));
      addChatMessage({ role: "user", content: `生成数量：${action.value} 张` });
      addChatMessage({
        role: "assistant",
        content: "生成数量已更新。",
        actions: [{ type: "generate", label: "生成图片" }],
      });
    }
  };

  const handleChatSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatIsBusy) return;

    setChatInput("");
    addChatMessage({ role: "user", content: text });

    const currentSettings: ChatGenerationSettings = {
      style: chatStyle,
      aspectRatio: chatAspectRatio,
      imageType: chatImageType,
      generationCount: chatGenerationCount,
    };
    const nextSettings = inferChatSettingsFromText(text, currentSettings);
    const parameterActions = getParameterActionsForText(text);
    const shouldGenerate =
      /生成|出图|做图|做一张|来一张|画一张|开始|generate|create/i.test(text);
    const isParameterOnlyRequest =
      !shouldGenerate &&
      parameterActions.length > 0 &&
      !/卧室|床品|家纺|四件套|被套|枕套|面料|颜色|图案|花纹|清晨|自然光|质感|场景/.test(text);
    const uploadActions: ChatAction[] = [];

    if (/商品图|产品图|原图/.test(text)) {
      uploadActions.push({ type: "uploadProduct", label: "上传商品图" });
    }
    if (/场景图|参考图|空间图/.test(text)) {
      uploadActions.push({ type: "uploadScene", label: "上传场景图" });
    }
    if (/模特图|人物图/.test(text)) {
      uploadActions.push({ type: "uploadModel", label: "上传模特图" });
    }

    if (nextSettings.style !== chatStyle) {
      setChatStyle(nextSettings.style);
      setChatAnalysis((prev) =>
        prev && nextSettings.style ? { ...prev, style: nextSettings.style } : prev
      );
    }
    if (nextSettings.aspectRatio !== chatAspectRatio) {
      setChatAspectRatio(nextSettings.aspectRatio);
    }
    if (nextSettings.imageType !== chatImageType) {
      setChatImageType(nextSettings.imageType);
    }
    if (nextSettings.generationCount !== chatGenerationCount) {
      setChatGenerationCount(nextSettings.generationCount);
    }

    if (isParameterOnlyRequest) {
      addChatMessage({
        role: "assistant",
        content: "可以，在这里选就行。",
        actions: parameterActions,
      });
      return;
    }

    if (!shouldGenerate && uploadActions.length > 0) {
      addChatMessage({
        role: "assistant",
        content: "可以，从这里上传对应图片。",
        actions: uploadActions,
      });
      return;
    }

    const nextBrief = chatBrief ? `${chatBrief}\n${text}` : text;
    setChatBrief(nextBrief);

    if (shouldGenerate) {
      await generateChatImage(nextBrief, nextSettings);
      return;
    }

    addChatMessage({
      role: "assistant",
      content:
        chatImages.length > 0
          ? "我已把这句作为补充要求。你可以继续说，也可以现在生成。"
          : "我已记下你的画面要求。可以继续补充，也可以直接按文字生成。",
      actions: [
        { type: "generate", label: "生成图片" },
        ...(chatImages.length === 0
          ? [{ type: "uploadProduct", label: "上传商品图" } as ChatAction]
          : []),
        { type: "uploadScene", label: "上传场景图" },
        { type: "aspect", label: "1:1 方图", value: "1:1" },
      ],
    });
  };

  return (
    <main className="flex-1 flex flex-col">
      {/* Header */}
      <header className="w-full py-6 px-8 border-b border-[#1a1a1a]/10 flex justify-between items-center bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full border border-[#1a1a1a]/20 flex items-center justify-center bg-white">
            <Sparkles className="w-5 h-5 text-[#1a1a1a]" />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-medium leading-none tracking-wide" suppressHydrationWarning>
              LUMINA
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#1a1a1a]/60 mt-1">
              AI Visual Studio
            </p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-4 text-xs uppercase tracking-widest font-medium text-[#1a1a1a]/40">
          {workspaceMode !== "HOME" && (
            <button
              onClick={() => setWorkspaceMode("HOME")}
              className="flex items-center gap-1 hover:text-[#1a1a1a] transition-colors"
            >
              <HomeIcon className="w-3 h-3" /> 入口
            </button>
          )}

          {workspaceMode === "STANDARD" && (
            <>
              <ArrowRight className="w-3 h-3" />
              <button
                onClick={() => setStep("UPLOAD")}
                className={`hover:text-[#1a1a1a] transition-colors ${step === "UPLOAD" ? "text-[#1a1a1a]" : ""}`}
              >
                01. Upload
              </button>
              <ArrowRight className="w-3 h-3" />
              <button
                onClick={() => {
                  if (analysis) setStep("EDIT");
                }}
                disabled={!analysis && step !== "ANALYZING"}
                className={`transition-colors ${analysis || step === "ANALYZING" ? "hover:text-[#1a1a1a] cursor-pointer" : "cursor-not-allowed opacity-50"} ${step === "ANALYZING" || step === "EDIT" ? "text-[#1a1a1a]" : ""}`}
              >
                02. Analyze
              </button>
              <ArrowRight className="w-3 h-3" />
              <button
                onClick={() => {
                  if (generatedImages.length > 0) setStep("RESULT");
                }}
                disabled={generatedImages.length === 0 && step !== "GENERATING"}
                className={`transition-colors ${generatedImages.length > 0 || step === "GENERATING" ? "hover:text-[#1a1a1a] cursor-pointer" : "cursor-not-allowed opacity-50"} ${step === "GENERATING" || step === "RESULT" ? "text-[#1a1a1a]" : ""}`}
              >
                03. Generate
              </button>

              <div className="w-px h-4 bg-[#1a1a1a]/20 ml-2"></div>
              <button
                onClick={reset}
                className="ml-2 flex items-center gap-1 hover:text-red-600 transition-colors"
                title="重新开始"
              >
                <RefreshCw className="w-3 h-3" /> 重置
              </button>
            </>
          )}

          {workspaceMode === "CHAT" && (
            <>
              <ArrowRight className="w-3 h-3" />
              <span className="text-[#1a1a1a]">AI Chat Generate</span>
              <button
                onClick={resetChat}
                className="ml-2 flex items-center gap-1 hover:text-red-600 transition-colors"
                title="重置对话"
              >
                <RefreshCw className="w-3 h-3" /> 重置对话
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center p-6 md:p-12 relative overflow-y-auto">
        <AnimatePresence mode="wait">
          {workspaceMode === "HOME" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-6xl my-auto"
            >
              <div className="mb-10">
                <p className="text-xs uppercase tracking-[0.28em] text-[#1a1a1a]/45 mb-4">
                  Choose Creation Mode
                </p>
                <h2 className="font-serif text-4xl md:text-5xl font-light mb-4">
                  选择生图入口
                </h2>
                <p className="text-[#1a1a1a]/60 max-w-2xl">
                  常规生图保留原有上传、分析、编辑、生成流程；AI 对话生图则通过聊天完成上传、选择和自由描述，最终在对话框里出图。
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <button
                  onClick={() => setWorkspaceMode("STANDARD")}
                  className="group text-left bg-white rounded-[32px] p-8 md:p-10 border border-[#1a1a1a]/5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:-translate-y-1 hover:shadow-[0_18px_45px_rgb(0,0,0,0.08)] transition-all"
                >
                  <div className="w-14 h-14 rounded-full bg-[#f5f2ed] flex items-center justify-center mb-8">
                    <ImageIcon className="w-6 h-6 text-[#1a1a1a]" />
                  </div>
                  <div className="flex items-end justify-between gap-6">
                    <div>
                      <h3 className="font-serif text-3xl font-light mb-3">
                        常规生图
                      </h3>
                      <p className="text-[#1a1a1a]/60 leading-relaxed">
                        上传家纺原图，自动分析商品特征，再编辑细节与参数生成电商图。
                      </p>
                    </div>
                    <ArrowRight className="w-6 h-6 shrink-0 text-[#1a1a1a]/40 group-hover:text-[#1a1a1a] transition-colors" />
                  </div>
                </button>

                <button
                  onClick={() => setWorkspaceMode("CHAT")}
                  className="group text-left bg-[#1a1a1a] text-white rounded-[32px] p-8 md:p-10 border border-[#1a1a1a] shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 hover:shadow-[0_18px_45px_rgb(0,0,0,0.16)] transition-all"
                >
                  <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center mb-8">
                    <MessageCircle className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex items-end justify-between gap-6">
                    <div>
                      <h3 className="font-serif text-3xl font-light mb-3">
                        AI 对话生图
                      </h3>
                      <p className="text-white/65 leading-relaxed">
                        像聊天一样上传图片、选择卡片、补充要求，并在对话里生成结果图。
                      </p>
                    </div>
                    <ArrowRight className="w-6 h-6 shrink-0 text-white/45 group-hover:text-white transition-colors" />
                  </div>
                </button>
              </div>
            </motion.div>
          )}

          {/* UPLOAD STEP */}
          {workspaceMode === "STANDARD" && step === "UPLOAD" && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-4xl flex flex-col items-center my-auto"
            >
              <div className="text-center mb-12">
                <h2 className="font-serif text-4xl md:text-5xl font-light mb-4">
                  Craft Your Vision
                </h2>
                <p className="text-[#1a1a1a]/60 max-w-lg mx-auto">
                  上传家纺四件套的实拍图与细节图，AI将为您提取商品特征，并生成高级质感的电商主图。
                </p>
              </div>

              <div className="w-full bg-white rounded-[32px] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#1a1a1a]/5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Product Image Upload */}
                  <div>
                    <h3 className="font-serif text-xl mb-4">
                      上传家纺原图 (必填)
                    </h3>
                    <div
                      className="border-2 border-dashed border-[#1a1a1a]/15 rounded-[24px] p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-[#1a1a1a]/[0.02] transition-colors min-h-[16rem]"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleImageUpload}
                      />
                      <div className="w-12 h-12 rounded-full bg-[#f5f2ed] flex items-center justify-center mb-4">
                        <Upload className="w-5 h-5 text-[#1a1a1a]/60" />
                      </div>
                      <p className="font-medium mb-1">点击或拖拽上传</p>
                      <p className="text-xs text-[#1a1a1a]/50 text-center">
                        支持 JPG, PNG，建议上传包含整体与细节的多张图片
                      </p>
                    </div>
                  </div>

                  {/* Model Image Upload */}
                  <div>
                    <h3 className="font-serif text-xl mb-4">
                      上传模特图 (可选)
                    </h3>
                    <div
                      className="border-2 border-dashed border-[#1a1a1a]/15 rounded-[24px] p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-[#1a1a1a]/[0.02] transition-colors min-h-[16rem] relative overflow-hidden"
                      onClick={() =>
                        !modelImage && modelInputRef.current?.click()
                      }
                    >
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        ref={modelInputRef}
                        onChange={handleModelUpload}
                      />
                      {modelImage ? (
                        <>
                          <Image
                            src={modelImage}
                            alt="Model Upload"
                            fill
                            className="object-cover"
                            unoptimized
                            referrerPolicy="no-referrer"
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setModelImage(null);
                            }}
                            className="absolute top-4 right-4 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors z-10"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="w-12 h-12 rounded-full bg-[#f5f2ed] flex items-center justify-center mb-4">
                            <ImageIcon className="w-5 h-5 text-[#1a1a1a]/60" />
                          </div>
                          <p className="font-medium mb-1">点击上传模特</p>
                          <p className="text-xs text-[#1a1a1a]/50 text-center">
                            AI会将模特自然融入场景中
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {images.length > 0 && (
                  <div className="mt-8 pt-8 border-t border-[#1a1a1a]/10">
                    <h3 className="text-sm uppercase tracking-widest font-medium text-[#1a1a1a]/60 mb-4">
                      已上传图片 ({images.length})
                    </h3>
                    <div className="flex gap-4 overflow-x-auto pb-4">
                      {images.map((img, idx) => (
                        <div
                          key={idx}
                          className="relative w-24 h-24 flex-shrink-0 rounded-2xl overflow-hidden group border border-[#1a1a1a]/10"
                        >
                          <Image
                            src={img}
                            alt={`Upload ${idx}`}
                            fill
                            className="object-cover"
                            unoptimized
                            referrerPolicy="no-referrer"
                          />
                          <button
                            onClick={() => removeImage(idx)}
                            className="absolute inset-0 bg-black/40 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-sm"
                          >
                            移除
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="mt-8 flex justify-end">
                      <button
                        onClick={startAnalysis}
                        className="bg-[#1a1a1a] text-white px-8 py-4 rounded-full font-medium tracking-wide hover:bg-black transition-colors flex items-center gap-2"
                      >
                        开始AI分析 <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-2xl text-sm">
                    {error}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ANALYZING STEP */}
          {workspaceMode === "STANDARD" && step === "ANALYZING" && (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="flex flex-col items-center justify-center text-center my-auto py-12"
            >
              <div className="relative w-32 h-32 mb-8">
                <div className="absolute inset-0 border-2 border-[#1a1a1a]/10 rounded-full"></div>
                <div className="absolute inset-0 border-2 border-[#1a1a1a] rounded-full border-t-transparent animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-[#1a1a1a] animate-pulse" />
                </div>
              </div>
              <h2 className="font-serif text-3xl font-light mb-2">
                Analyzing Details
              </h2>
              <p className="text-[#1a1a1a]/60 tracking-wide">
                AI正在提取材质、颜色与细节特征...
              </p>
            </motion.div>
          )}

          {/* EDIT STEP */}
          {workspaceMode === "STANDARD" && step === "EDIT" && analysis && (
            <motion.div
              key="edit"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 my-auto py-8"
            >
              <div className="lg:col-span-5 flex flex-col gap-6">
                <div className="bg-white rounded-[32px] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#1a1a1a]/5 h-full">
                  <h3 className="font-serif text-2xl mb-6 flex items-center gap-3">
                    <ImageIcon className="w-5 h-5 opacity-50" />
                    Reference Images
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {images.map((img, idx) => (
                      <div
                        key={idx}
                        className="relative aspect-square rounded-2xl overflow-hidden border border-[#1a1a1a]/10"
                      >
                        <Image
                          src={img}
                          alt={`Ref ${idx}`}
                          fill
                          className="object-cover"
                          unoptimized
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 bg-white rounded-[32px] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#1a1a1a]/5">
                <div className="flex justify-between items-end mb-8">
                  <div>
                    <h2 className="font-serif text-3xl font-light mb-2">
                      Refine Details
                    </h2>
                    <p className="text-[#1a1a1a]/60 text-sm">
                      您可以修改AI提取的特征，以指导最终主图的生成。
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-full bg-[#f5f2ed] flex items-center justify-center">
                    <Check className="w-5 h-5 text-green-600" />
                  </div>
                </div>

                <div className="space-y-5">
                  {Object.entries(analysis).map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-2">
                      <label className="text-xs uppercase tracking-widest font-semibold text-[#1a1a1a]/50">
                        {key === "material" && "材质 (Material)"}
                        {key === "color" && "颜色 (Color)"}
                        {key === "pattern" && "图案 (Pattern)"}
                        {key === "style" && "风格 (Style)"}
                        {key === "details" && "细节 (Details)"}
                        {key === "sellingPoint" && "核心卖点 (Selling Point)"}
                      </label>
                      {key === "style" && (
                        <div className="flex flex-col gap-3 mb-2">
                          <div className="flex flex-wrap gap-2">
                            {PRESET_STYLES.map((preset) => (
                              <button
                                key={preset}
                                onClick={() =>
                                  setAnalysis({ ...analysis, style: preset })
                                }
                                className="text-[10px] px-3 py-1.5 rounded-full border border-[#1a1a1a]/20 hover:bg-[#1a1a1a] hover:text-white transition-colors"
                              >
                                {preset.split(" ")[0]}
                              </button>
                            ))}
                          </div>

                          {/* Scene Reference Image inside Style section */}
                          <div className="flex items-center gap-4 mt-2">
                            {sceneImage && (
                              <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-[#1a1a1a]/10 shrink-0">
                                <Image
                                  src={sceneImage}
                                  alt="Scene Reference"
                                  fill
                                  className="object-cover"
                                />
                                <button
                                  onClick={() => setSceneImage(null)}
                                  className="absolute top-1 right-1 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                            <button
                              onClick={() => sceneInputRef.current?.click()}
                              className="flex-1 border border-dashed border-[#1a1a1a]/20 rounded-xl p-3 flex items-center justify-center gap-2 text-[#1a1a1a]/60 hover:bg-[#f5f2ed]/50 hover:border-[#1a1a1a]/40 transition-colors text-xs"
                            >
                              <Upload className="w-4 h-4" />
                              {sceneImage
                                ? "更换自定义场景图"
                                : "上传自定义场景图 (覆盖预设风格)"}
                            </button>
                            <input
                              type="file"
                              ref={sceneInputRef}
                              onChange={handleSceneUpload}
                              accept="image/*"
                              className="hidden"
                            />
                          </div>
                        </div>
                      )}
                      <textarea
                        value={value as string}
                        onChange={(e) =>
                          setAnalysis({ ...analysis, [key]: e.target.value })
                        }
                        className="w-full bg-[#f5f2ed]/50 border border-[#1a1a1a]/10 rounded-xl p-4 text-sm focus:outline-none focus:border-[#1a1a1a]/30 focus:bg-white transition-colors resize-none"
                        rows={2}
                      />
                    </div>
                  ))}
                </div>

                {error && (
                  <div className="mt-6 p-4 bg-red-50 text-red-600 rounded-2xl text-sm">
                    {error}
                  </div>
                )}

                {/* Generation Settings */}
                <div className="mt-8 pt-8 border-t border-[#1a1a1a]/10">
                  <h3 className="font-serif text-xl mb-6 flex items-center gap-2">
                    <Settings className="w-5 h-5 opacity-50" />
                    Generation Settings
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Aspect Ratio */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs uppercase tracking-widest font-semibold text-[#1a1a1a]/50">
                        尺寸比例 (Aspect Ratio)
                      </label>
                      <select
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value)}
                        className="w-full bg-[#f5f2ed]/50 border border-[#1a1a1a]/10 rounded-xl p-3 text-sm focus:outline-none focus:border-[#1a1a1a]/30 focus:bg-white transition-colors cursor-pointer"
                      >
                        <option value="3:4">3:4 (竖版电商)</option>
                        <option value="1:1">1:1 (方形主图)</option>
                        <option value="4:3">4:3 (横版展示)</option>
                        <option value="16:9">16:9 (宽屏海报)</option>
                      </select>
                    </div>
                    {/* Image Types */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs uppercase tracking-widest font-semibold text-[#1a1a1a]/50">
                        生成类型 (Generation Type)
                      </label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="imageType"
                            checked={imageTypes.includes("main")}
                            onChange={() => setImageTypes(["main"])}
                            className="w-4 h-4 text-[#1a1a1a] focus:ring-[#1a1a1a]"
                          />
                          <span className="text-sm">电商主图 (Main Image)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="imageType"
                            checked={imageTypes.includes("closeup")}
                            onChange={() => setImageTypes(["closeup"])}
                            className="w-4 h-4 text-[#1a1a1a] focus:ring-[#1a1a1a]"
                          />
                          <span className="text-sm">细节近景图 (Close-up)</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-10 flex justify-between items-center">
                  <button
                    onClick={() => setStep("UPLOAD")}
                    className="text-[#1a1a1a]/60 hover:text-[#1a1a1a] transition-colors flex items-center gap-2 font-medium text-sm uppercase tracking-wide"
                  >
                    <ArrowLeft className="w-4 h-4" /> 返回重新上传
                  </button>
                  <button
                    onClick={generateImage}
                    className="bg-[#1a1a1a] text-white px-8 py-4 rounded-full font-medium tracking-wide hover:bg-black transition-colors flex items-center gap-2"
                  >
                    生成商品主图 <Sparkles className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* GENERATING STEP */}
          {workspaceMode === "STANDARD" && step === "GENERATING" && (
            <motion.div
              key="generating"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="flex flex-col items-center justify-center text-center my-auto py-12"
            >
              <div className="relative w-48 h-64 mb-8 rounded-2xl overflow-hidden bg-[#1a1a1a]/5 flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-t from-[#f5f2ed] to-transparent z-10"></div>
                <Loader2 className="w-8 h-8 text-[#1a1a1a]/40 animate-spin z-20" />
              </div>
              <h2 className="font-serif text-3xl font-light mb-2">
                Crafting Masterpiece
              </h2>
              <p className="text-[#1a1a1a]/60 tracking-wide">
                AI正在渲染高级质感商品主图，请稍候...
              </p>
            </motion.div>
          )}

          {/* RESULT STEP */}
          {workspaceMode === "STANDARD" && step === "RESULT" && generatedImages.length > 0 && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-5xl flex flex-col items-center my-auto py-8"
            >
              <div className="w-full bg-white rounded-[32px] p-8 md:p-12 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#1a1a1a]/5">
                <div className="flex flex-col md:flex-row gap-12">
                  <div className="flex-1 flex flex-col gap-4">
                    <div
                      className={`relative ${aspectRatio === "1:1" ? "aspect-square" : aspectRatio === "4:3" ? "aspect-[4/3]" : aspectRatio === "16:9" ? "aspect-video" : "aspect-[3/4]"} w-full rounded-[24px] overflow-hidden shadow-2xl cursor-zoom-in group`}
                      onClick={() => setIsLightboxOpen(true)}
                    >
                      <Image
                        src={generatedImages[selectedImageIndex]}
                        alt="Generated Product Image"
                        fill
                        className="object-cover transition-transform duration-700 group-hover:scale-105"
                        unoptimized
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                        <div className="bg-white/90 backdrop-blur-sm text-[#1a1a1a] px-4 py-2 rounded-full font-medium text-sm opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-4 group-hover:translate-y-0">
                          点击查看大图
                        </div>
                      </div>
                    </div>

                    {/* History Gallery */}
                    {generatedImages.length > 1 && (
                      <div className="flex gap-3 overflow-x-auto pb-2">
                        {generatedImages.map((img, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedImageIndex(idx)}
                            className={`relative w-20 h-24 flex-shrink-0 rounded-xl overflow-hidden border-2 transition-all ${selectedImageIndex === idx ? "border-[#1a1a1a] shadow-md" : "border-transparent hover:border-[#1a1a1a]/30"}`}
                          >
                            <Image
                              src={img}
                              alt={`History ${idx}`}
                              fill
                              className="object-cover"
                              unoptimized
                              referrerPolicy="no-referrer"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col justify-center">
                    <h2 className="font-serif text-4xl font-light mb-6">
                      The Final Result
                    </h2>
                    <p className="text-[#1a1a1a]/60 mb-8 leading-relaxed">
                      基于您提供的细节特征，AI已为您生成这张具备高级质感、光影柔和的电商主图。您可以点击下方按钮生成不同布局和背景的更多版本。
                    </p>

                    <div className="space-y-4">
                      <a
                        href={generatedImages[selectedImageIndex]}
                        download={`product-main-image-${selectedImageIndex}.png`}
                        className="w-full bg-[#1a1a1a] text-white px-8 py-4 rounded-full font-medium tracking-wide hover:bg-black transition-colors flex items-center justify-center gap-2"
                      >
                        <Download className="w-4 h-4" /> 下载当前高清原图
                      </a>
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          onClick={() => setStep("EDIT")}
                          className="w-full bg-white border border-[#1a1a1a]/20 text-[#1a1a1a] px-4 py-4 rounded-full font-medium tracking-wide hover:bg-[#f5f2ed] transition-colors flex items-center justify-center gap-2"
                        >
                          <ArrowLeft className="w-4 h-4" /> 返回修改特征
                        </button>
                        <button
                          onClick={generateImage}
                          className="w-full bg-white border border-[#1a1a1a]/20 text-[#1a1a1a] px-4 py-4 rounded-full font-medium tracking-wide hover:bg-[#f5f2ed] transition-colors flex items-center justify-center gap-2"
                        >
                          <RefreshCw className="w-4 h-4" /> 生成新场景
                        </button>
                      </div>
                      <button
                        onClick={reset}
                        className="w-full text-[#1a1a1a]/60 py-4 font-medium tracking-wide hover:text-red-600 transition-colors text-sm uppercase flex items-center justify-center gap-2"
                      >
                        <RefreshCw className="w-4 h-4" /> 重置并重新开始
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {workspaceMode === "CHAT" && (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-5xl"
            >
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                ref={chatProductInputRef}
                onChange={handleChatProductUpload}
              />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={chatSceneInputRef}
                onChange={handleChatSceneUpload}
              />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={chatModelInputRef}
                onChange={handleChatModelUpload}
              />

              <section className="bg-white rounded-[32px] border border-[#1a1a1a]/5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col min-h-[38rem] max-h-[calc(100vh-12rem)]">
                <div className="px-6 py-5 border-b border-[#1a1a1a]/10 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#1a1a1a] text-white flex items-center justify-center">
                      <Bot className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-serif text-2xl font-light">
                        AI 对话生图
                      </h2>
                      <p className="text-xs text-[#1a1a1a]/50">
                        独立对话工作区，支持自由描述、卡片选择和图片上传
                      </p>
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 text-xs text-[#1a1a1a]/45">
                    <Sparkles className="w-4 h-4" />
                    {chatGeneratedImages.length > 0
                      ? `已生成 ${chatGeneratedImages.length} 张`
                      : "等待创作"}
                  </div>
                </div>

                <div
                  ref={chatScrollRef}
                  className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6 bg-[#faf8f4]"
                >
                  {chatMessages.map((message) => {
                    const isUser = message.role === "user";

                    return (
                      <div
                        key={message.id}
                        className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                      >
                        {!isUser && (
                          <div className="w-9 h-9 rounded-full bg-white border border-[#1a1a1a]/10 flex items-center justify-center shrink-0">
                            <Bot className="w-4 h-4 text-[#1a1a1a]/70" />
                          </div>
                        )}

                        <div
                          className={`max-w-[min(42rem,86%)] flex flex-col ${isUser ? "items-end" : "items-start"}`}
                        >
                          {message.content && (
                            <div
                              className={`rounded-[24px] px-5 py-4 text-sm leading-relaxed ${
                                isUser
                                  ? "bg-[#1a1a1a] text-white"
                                  : "bg-white text-[#1a1a1a] border border-[#1a1a1a]/5"
                              }`}
                            >
                              {message.content}
                            </div>
                          )}

                          {message.images && message.images.length > 0 && (
                            <div
                              className={`mt-3 grid gap-3 ${
                                message.images.length === 1
                                  ? "grid-cols-1"
                                  : "grid-cols-2 sm:grid-cols-3"
                              }`}
                            >
                              {message.images.map((img, idx) => (
                                <div
                                  key={`${message.id}-${idx}`}
                                  className="relative w-28 aspect-square rounded-2xl overflow-hidden border border-[#1a1a1a]/10 bg-white"
                                >
                                  <Image
                                    src={img}
                                    alt={`Chat upload ${idx + 1}`}
                                    fill
                                    className="object-cover"
                                    unoptimized
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {message.generation && (
                            <div className="mt-3 w-full rounded-[24px] bg-white border border-[#1a1a1a]/10 p-4 shadow-[0_8px_24px_rgb(0,0,0,0.04)]">
                              {message.generation.status === "loading" && (
                                <div className="flex items-center gap-4">
                                  <div className="w-16 h-20 rounded-2xl bg-[#f5f2ed] flex items-center justify-center">
                                    <Loader2 className="w-6 h-6 animate-spin text-[#1a1a1a]/50" />
                                  </div>
                                  <div>
                                    <p className="font-medium mb-1">
                                      正在生成图片
                                    </p>
                                    <p className="text-sm text-[#1a1a1a]/55">
                                      {message.generation.note}
                                    </p>
                                  </div>
                                </div>
                              )}

                              {message.generation.status === "error" && (
                                <div className="p-4 rounded-2xl bg-red-50 text-red-600 text-sm">
                                  {message.generation.error}
                                </div>
                              )}

                              {message.generation.status === "success" && (
                                <div className="space-y-4">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <p className="font-medium">生成结果</p>
                                      <p className="text-xs text-[#1a1a1a]/50">
                                        {message.generation.note}
                                      </p>
                                    </div>
                                    <Wand2 className="w-5 h-5 text-[#1a1a1a]/50" />
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {message.generation.images?.map((img, idx) => (
                                      <div key={`${message.id}-result-${idx}`} className="space-y-3">
                                        <div
                                          className={`relative ${getAspectClassName(message.generation?.aspectRatio || chatAspectRatio)} rounded-[20px] overflow-hidden bg-[#f5f2ed] border border-[#1a1a1a]/10`}
                                        >
                                          <Image
                                            src={img}
                                            alt={`Generated chat result ${idx + 1}`}
                                            fill
                                            className="object-cover"
                                            unoptimized
                                            referrerPolicy="no-referrer"
                                          />
                                        </div>
                                        <a
                                          href={img}
                                          download={`chat-generated-${idx + 1}.png`}
                                          className="w-full border border-[#1a1a1a]/15 text-[#1a1a1a] px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#f5f2ed] transition-colors flex items-center justify-center gap-2"
                                        >
                                          <Download className="w-4 h-4" /> 下载
                                        </a>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {message.actions && message.actions.length > 0 && (
                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                              {message.actions.map((action, idx) => (
                                <button
                                  key={`${message.id}-${action.type}-${action.value || idx}`}
                                  onClick={() => handleChatAction(action)}
                                  disabled={chatIsBusy && action.type !== "uploadProduct" && action.type !== "uploadScene" && action.type !== "uploadModel"}
                                  className="text-left rounded-2xl border border-[#1a1a1a]/10 bg-white px-4 py-3 hover:border-[#1a1a1a]/30 hover:bg-[#f5f2ed]/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <span className="text-sm font-medium block">
                                    {action.label}
                                  </span>
                                  {action.description && (
                                    <span className="text-xs text-[#1a1a1a]/50 mt-1 block">
                                      {action.description}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {isUser && (
                          <div className="w-9 h-9 rounded-full bg-[#1a1a1a] text-white flex items-center justify-center shrink-0">
                            <UserRound className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <form
                  onSubmit={handleChatSubmit}
                  className="p-4 border-t border-[#1a1a1a]/10 bg-white flex items-end gap-3"
                >
                  <div className="flex items-center gap-2 pb-1">
                    <button
                      type="button"
                      onClick={() => chatProductInputRef.current?.click()}
                      className="w-10 h-10 rounded-full border border-[#1a1a1a]/10 flex items-center justify-center hover:bg-[#f5f2ed] transition-colors"
                      title="上传商品图"
                    >
                      <Images className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => chatSceneInputRef.current?.click()}
                      className="w-10 h-10 rounded-full border border-[#1a1a1a]/10 flex items-center justify-center hover:bg-[#f5f2ed] transition-colors"
                      title="上传场景图"
                    >
                      <ImageIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => chatModelInputRef.current?.click()}
                      className="w-10 h-10 rounded-full border border-[#1a1a1a]/10 flex items-center justify-center hover:bg-[#f5f2ed] transition-colors"
                      title="上传模特图"
                    >
                      <UserRound className="w-4 h-4" />
                    </button>
                  </div>
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={1}
                    placeholder="描述你想要的画面，例如：奶油风卧室，清晨自然光，床品更蓬松..."
                    className="min-h-10 max-h-28 flex-1 resize-none rounded-[20px] bg-[#f5f2ed]/70 border border-[#1a1a1a]/10 px-4 py-3 text-sm focus:outline-none focus:bg-white focus:border-[#1a1a1a]/30 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={chatIsBusy || !chatInput.trim()}
                    className="w-10 h-10 rounded-full bg-[#1a1a1a] text-white flex items-center justify-center hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed mb-1"
                    title="发送"
                  >
                    {chatIsBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </form>
              </section>

            </motion.div>
          )}
        </AnimatePresence>

        {/* Lightbox */}
        <AnimatePresence>
          {isLightboxOpen && generatedImages.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 md:p-12"
              onClick={() => setIsLightboxOpen(false)}
            >
              <button
                className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors"
                onClick={() => setIsLightboxOpen(false)}
              >
                <X className="w-8 h-8" />
              </button>
              <div
                className="relative w-full h-full max-w-5xl"
                onClick={(e) => e.stopPropagation()}
              >
                <Image
                  src={generatedImages[selectedImageIndex]}
                  alt="Generated Product Image Fullscreen"
                  fill
                  className="object-contain"
                  unoptimized
                  referrerPolicy="no-referrer"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
