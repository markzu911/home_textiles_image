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
type ChatStage = "chooseType" | "uploadProduct" | "optionalRefs" | "ready";
type ChatImageCategory = "product" | "scene" | "model";
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
  prompt?: string;
}

interface ChatGeneration {
  status: "loading" | "success" | "error" | "pending";
  images?: string[];
  error?: string;
  note?: string;
  aspectRatio?: string;
  title?: string;
  imageType?: ImageType;
  style?: string | null;
  count?: number;
  hasScene?: boolean;
  hasModel?: boolean;
}

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  content?: string;
  images?: string[];
  imageCategory?: ChatImageCategory;
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

type ChatIntentActionName = "analyze_image" | "generate_smart" | "update_config" | "none";
type ChatDetectedImageType = "product" | "scene" | "model" | "none";

interface ChatIntentAction {
  action: ChatIntentActionName;
  actionExplanation?: string;
  detectedImageType?: ChatDetectedImageType;
  directGenerate?: boolean;
  smartParams?: {
    type?: ImageType;
    config?: Partial<ChatGenerationSettings> & {
      imageType?: ImageType;
    };
    analysis?: Partial<AnalysisResult>;
    extraInstruction?: string;
  };
}

const DEFAULT_GEN_MODEL = "gemini-3.1-flash-image-preview";
const DEFAULT_ASPECT_RATIO = "3:4";
const GENERATE_REQUEST_TIMEOUT_MS = 300000;
const MAX_PRODUCT_REFERENCE_IMAGES = 1;

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
  { type: "uploadProduct", label: "上传商品图", description: "先识别花型、颜色和材质" },
  {
    type: "imageType",
    label: "定制商品主图",
    value: "main",
    description: "整体场景和电商首图",
    prompt: "定制家纺商品主图，先帮我确认画幅、风格、商品参考图和生成参数",
  },
  {
    type: "imageType",
    label: "定制细节近景",
    value: "closeup",
    description: "面料纹理、刺绣和做工",
    prompt: "定制家纺细节近景图，先帮我确认面料纹理、花型、构图和生成参数",
  },
  { type: "uploadScene", label: "场景参考", description: "可选，锁定卧室结构和光影" },
];

const CHAT_WELCOME_CONTENT =
  "直接描述你想要的家纺画面，或先上传商品、场景、模特参考图。我会帮你整理需求，生成商品主图或细节近景。";

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

const isValidAspectRatio = (value: unknown): value is string => {
  return typeof value === "string" && ASPECT_RATIO_OPTIONS.some((option) => option.value === value);
};

const isValidImageType = (value: unknown): value is ImageType => {
  return value === "main" || value === "closeup";
};

const normalizeGenerationCount = (value: unknown, fallback: number) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(4, Math.max(1, Math.round(numericValue)));
};

const extractChatReply = (raw: string) => {
  const actionIndex = raw.indexOf("[ACTION]");
  let reply = actionIndex >= 0 ? raw.slice(0, actionIndex) : raw;
  reply = reply.replace(/^\s*\[REPLY\]\s*/i, "").trim();
  return reply;
};

const parseChatIntentAction = (raw: string): ChatIntentAction | null => {
  const actionIndex = raw.indexOf("[ACTION]");
  if (actionIndex < 0) return null;

  let actionText = raw.slice(actionIndex + "[ACTION]".length).trim();
  actionText = actionText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  const firstBrace = actionText.indexOf("{");
  const lastBrace = actionText.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  try {
    const parsed = JSON.parse(actionText.slice(firstBrace, lastBrace + 1));
    if (
      parsed?.action === "analyze_image" ||
      parsed?.action === "generate_smart" ||
      parsed?.action === "update_config" ||
      parsed?.action === "none"
    ) {
      return parsed as ChatIntentAction;
    }
  } catch (error) {
    console.error("Failed to parse chat ACTION:", error, actionText);
  }

  return null;
};

const getSettingsFromChatIntent = (
  intent: ChatIntentAction | null,
  text: string,
  current: ChatGenerationSettings
): ChatGenerationSettings => {
  const next = inferChatSettingsFromText(text, current);
  const smartParams = intent?.smartParams;
  const config = smartParams?.config || {};

  if (isValidImageType(smartParams?.type)) next.imageType = smartParams.type;
  if (isValidImageType(config.imageType)) next.imageType = config.imageType;
  if (isValidAspectRatio(config.aspectRatio)) next.aspectRatio = config.aspectRatio;
  if (typeof config.style === "string" && config.style.trim()) next.style = config.style.trim();
  if (config.generationCount !== undefined) {
    next.generationCount = normalizeGenerationCount(config.generationCount, next.generationCount);
  }

  return next;
};

const serializeChatMessagesForApi = (messages: ChatMessage[]) => {
  return messages.map((message, index) => ({
    role: message.role,
    content:
      message.role === "assistant"
        ? `[REPLY]\n${message.content || ""}`
        : message.content || "",
    images: index === messages.length - 1 ? message.images || [] : [],
  }));
};

const createFallbackAnalysis = (instruction: string, style?: string | null): AnalysisResult => ({
  material: "根据用户描述选择适合家纺电商展示的高级面料质感",
  color: "根据用户描述确定主色，未说明时使用柔和、高级、耐看的配色",
  pattern: "根据用户描述确定图案，未说明时使用克制纹理或低饱和花型",
  style: style || "现代高级家居电商风",
  details: instruction || "高级质感家纺四件套，画面干净，细节清晰",
  sellingPoint: "舒适触感、高端质感、生活方式氛围与电商转化友好",
});

const getTypeSelectedActions = (): ChatAction[] => [
  { type: "uploadProduct", label: "上传商品图", description: "用于还原花型、颜色、材质和细节" },
  {
    type: "style",
    label: "温馨奶油风",
    value: PRESET_STYLES[3],
    prompt: "把家纺画面风格切换为温馨奶油风，并继续帮我确认下一步生成参数",
  },
  {
    type: "generate",
    label: "按文字直接生成",
    prompt: "按当前文字需求直接生成一张家纺图片",
  },
];

const getOptionalReferenceActions = (): ChatAction[] => [
  { type: "uploadScene", label: "上传自定义场景", description: "可选，复刻房间结构、家具和光影" },
  { type: "uploadModel", label: "上传模特图", description: "可选，生成真人互动场景" },
  {
    type: "style",
    label: "极简原木风",
    value: PRESET_STYLES[0],
    prompt: "把家纺画面风格切换为极简原木风，并继续帮我确认下一步生成参数",
  },
  {
    type: "style",
    label: "现代轻奢风",
    value: PRESET_STYLES[2],
    prompt: "把家纺画面风格切换为现代轻奢风，并继续帮我确认下一步生成参数",
  },
  {
    type: "generate",
    label: "不用补充，直接生成",
    prompt: "不用再补充参考图，按当前参数直接生成家纺图片",
  },
];

const getReadyToGenerateActions = (): ChatAction[] => [
  {
    type: "aspect",
    label: "3:4 竖版",
    value: "3:4",
    prompt: "把输出画幅切换为 3:4 竖版，并继续准备生成",
  },
  {
    type: "aspect",
    label: "1:1 方图",
    value: "1:1",
    prompt: "把输出画幅切换为 1:1 方图，并继续准备生成",
  },
  {
    type: "count",
    label: "生成 1 张",
    value: "1",
    prompt: "把生成数量设置为 1 张，并继续准备生成",
  },
  {
    type: "count",
    label: "生成 2 张",
    value: "2",
    prompt: "把生成数量设置为 2 张，并继续准备生成",
  },
  {
    type: "generate",
    label: "生成图片",
    prompt: "按当前参数直接生成家纺图片",
  },
];

const getChatGenerationActions = (): ChatAction[] => {
  return [
    {
      type: "imageType",
      label: "定制商品主图",
      value: "main",
      description: "整体视觉效果",
      prompt: "定制家纺商品主图，先帮我确认画幅、风格、参考图和生成参数",
    },
    {
      type: "imageType",
      label: "定制细节近景",
      value: "closeup",
      description: "面料与做工特写",
      prompt: "定制家纺细节近景图，先帮我确认面料纹理、花型、构图和生成参数",
    },
    { type: "uploadScene", label: "上传自定义场景", description: "可选，覆盖默认风格" },
    { type: "uploadModel", label: "上传模特图", description: "可选，生成真人互动效果" },
    {
      type: "style",
      label: "温馨奶油风",
      value: PRESET_STYLES[3],
      prompt: "把家纺画面风格切换为温馨奶油风，并继续帮我确认下一步生成参数",
    },
    {
      type: "aspect",
      label: "1:1 方图",
      value: "1:1",
      prompt: "把输出画幅切换为 1:1 方图，并继续准备生成",
    },
    {
      type: "generate",
      label: "生成图片",
      prompt: "按当前参数直接生成家纺图片",
    },
  ];
};

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
  if (/定制|参数|设置|选项|确认/.test(text)) {
    return [
      { type: "uploadProduct", label: "上传商品图", description: "还原花型、颜色和材质" },
      { type: "uploadScene", label: "上传场景图", description: "锁定卧室结构和光影" },
      {
        type: "style",
        label: "温馨奶油风",
        value: PRESET_STYLES[3],
        description: "柔和低饱和家居氛围",
        prompt: "把家纺画面风格切换为温馨奶油风，并继续帮我确认下一步生成参数",
      },
      {
        type: "aspect",
        label: "1:1 方图",
        value: "1:1",
        description: "适合电商方形主图",
        prompt: "把输出画幅切换为 1:1 方图，并继续准备生成",
      },
      {
        type: "count",
        label: "生成 2 张",
        value: "2",
        description: "一次输出两版选择",
        prompt: "把生成数量设置为 2 张，并继续准备生成",
      },
      {
        type: "generate",
        label: "按当前参数生成",
        description: "确认配置并开始出图",
        prompt: "按当前参数直接生成家纺图片",
      },
    ];
  }
  if (/风格/.test(text)) {
    return PRESET_STYLES.map((preset) => ({
      type: "style",
      label: preset.split(" ")[0],
      value: preset,
      prompt: `把家纺画面风格切换为${preset}，并继续帮我确认下一步生成参数`,
    }));
  }
  if (/比例|尺寸|大小|画幅/.test(text)) {
    return ASPECT_RATIO_OPTIONS.map((option) => ({
      type: "aspect",
      label: `${option.label} ${option.description}`,
      value: option.value,
      prompt: `把输出画幅切换为 ${option.value}，并继续准备生成`,
    }));
  }
  if (/类型|主图|细节|近景|特写/.test(text)) {
    return IMAGE_TYPE_OPTIONS.map((option) => ({
      type: "imageType",
      label: option.label,
      value: option.value,
      description: option.description,
      prompt:
        option.value === "main"
          ? "定制家纺商品主图，先帮我确认画幅、风格、参考图和生成参数"
          : "定制家纺细节近景图，先帮我确认面料纹理、花型、构图和生成参数",
    }));
  }
  if (/数量|几张/.test(text)) {
    return [1, 2, 4].map((count) => ({
      type: "count",
      label: `${count} 张`,
      value: String(count),
      prompt: `把生成数量设置为 ${count} 张，并继续准备生成`,
    }));
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
  const productFidelityRules = `【商品还原优先级（最高）】：
1. 只要提供了【商品原图】，商品本身的花型、主色/辅色、面料纹理、包边、刺绣、走线、厚薄、蓬松度和细节结构必须严格按照商品原图还原。
2. 【商品原图】优先级高于场景图、模特图、文字风格、预设风格和补充约束；任何风格变化都只能改变背景、光影、摆放和摄影表达，不能改变商品设计。
3. 场景参考图只用于空间结构、家具、背景、光影和氛围，不允许把场景图里的床品花纹、颜色或款式套用到商品上。
4. 不要新增、删除、替换或重绘商品原有花型元素；不要把条纹变成纯色、把碎花变成几何、把浅色改深色、把材质改成其他面料。
5. 如果商品原图中有属于商品设计的一部分的图案、文字或品牌标识，应保持其原有位置和外观；但不要额外新增任何 Logo、文字、水印或装饰标识。`;

  let basePrompt = hasProductImages
    ? `作为专业的家纺电商视觉总监和图像后期专家，请基于我提供的原图，生成一张精美的家纺四件套${typeName}。
【注意】：我提供了以下图片：
1. 【商品原图】（最高优先级，必须100%还原商品样式和细节，但可改变摆放方式）。
${sceneImage ? "2. 【场景/风格参考图】（必须100%严格复刻该场景）。\n" : ""}${modelImage ? `${sceneImage ? "3" : "2"}. 【模特参考图】（必须100%还原面容，但可改变姿势动作）。\n` : ""}
商品细节如下：
- 材质：${analysis.material}
- 颜色：${analysis.color}
- 图案：${analysis.pattern}
${sceneImage ? "" : `- 风格：${analysis.style}\n`}- 细节：${analysis.details}
- 核心卖点：${analysis.sellingPoint}

${productFidelityRules}

【极其重要的要求】：
1. 【商品还原】：必须 100% 还原【商品原图】中的商品材质、花纹、颜色、版型、边缘、刺绣/走线和全部细节，绝对不要改变商品的任何原有设计！
2. 【摆放与视角】：在保持商品100%还原的前提下，${typeDesc}
3. 绝对不要在画面中新增任何商标、Logo、文字、水印 or 多余的装饰物；若原商品自带设计元素，请原样保留，不要替换。
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
  if (res.status === 413) {
    throw new Error("图片体积过大：已自动压缩，但当前参考图数量或尺寸仍超出服务端限制。请减少参考图后重试。");
  }
  if (res.status === 504) {
    throw new Error("GENERATION_RESULT_PENDING: 当前请求被网关中断，后台可能已经生成并保存，请到生成记录中确认；如果记录中没有结果，再重新生成。");
  }
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return res.json();
  }
  await res.text();
  throw new Error(`${fallbackPrefix} (${res.status}): 请重试`);
};

const extractGeneratedImageUrl = (data: any) => {
  const image = data?.image ?? data?.url;
  if (typeof image === "string") return image;
  if (image && typeof image === "object") {
    return (
      image.url ||
      image.publicUrl ||
      image.ossUrl ||
      image.imageUrl ||
      image.previewUrl ||
      image.src ||
      null
    );
  }
  return null;
};

const isGenerationResultPendingError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    /GENERATION_RESULT_PENDING|网关中断|504|生成请求超时/i.test(message) ||
    (/执行后续流程失败/.test(message) &&
      /(oss-upload|upload-commit|图片入库|OSS 上传).*?(timeout|aborted|超时)/i.test(message))
  );
};

const getFriendlyChatErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/GEMINI_API_KEY|API_KEY|api key/i.test(message)) {
    return "AI 对话服务未配置 Gemini API Key，请配置后重试。";
  }
  return message || "AI 对话解析失败，请稍后重试。";
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
  const timeout = setTimeout(() => controller.abort(), GENERATE_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        images: images.slice(-MAX_PRODUCT_REFERENCE_IMAGES),
        sceneImage,
        modelImage,
        aspectRatio,
        saasInfo,
      }),
      signal: controller.signal,
    });
    const data = await readJsonResponse(res, "生成超时或服务端异常");
    if (!res.ok) throw new Error(data.error || "生成失败");

    const url = extractGeneratedImageUrl(data);
    if (!url) throw new Error("生成失败，未返回图片数据");
    return url;
  } catch (err: any) {
    if (err?.name === "AbortError" || /aborted|timeout/i.test(err?.message || "")) {
      throw new Error(`生成请求超时(${Math.round(GENERATE_REQUEST_TIMEOUT_MS / 1000)}s)：请稍后重试。`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
};

function ChatGenerationLoadingCard({ generation }: { generation: ChatGeneration }) {
  const [progress, setProgress] = useState(8);
  const imageTypeLabel = generation.imageType === "closeup" ? "细节近景" : "商品主图";
  const steps =
    generation.imageType === "closeup"
      ? [
          "解析面料纹理、花型边界和刺绣走线...",
          "构建微距镜头景深与褶皱层次...",
          "融合商品参考图、场景光影和材质触感...",
          "执行电商级清晰度校准与细节锐化...",
        ]
      : [
          "解析床品材质、花型和整体轮廓...",
          "构建卧室空间构图与商品摆放关系...",
          "融合参考图、自然光影和家居氛围...",
          "执行电商主图级质感渲染与色彩校准...",
        ];
  const currentStep = progress < 28 ? 0 : progress < 58 ? 1 : progress < 84 ? 2 : 3;

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((value) => {
        if (value < 28) return Math.min(28, value + Math.floor(Math.random() * 5) + 2);
        if (value < 58) return Math.min(58, value + Math.floor(Math.random() * 4) + 1);
        if (value < 84) return Math.min(84, value + Math.floor(Math.random() * 3) + 1);
        if (value < 97) return Math.min(97, value + 0.6);
        return value;
      });
    }, 520);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mt-3 w-full max-w-[34rem] rounded-[28px] border border-[#1a1a1a]/8 bg-white p-5 shadow-[0_14px_36px_rgb(0,0,0,0.06)] space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-[#f5f2ed] flex items-center justify-center text-[#1a1a1a]/65 shrink-0">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-[#1a1a1a] leading-tight">
              {generation.title || "AI 对话生图生成中"}
              <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-[#1a1a1a]/38">
                Creating
              </span>
            </p>
            <p className="text-xs text-[#1a1a1a]/45 mt-1">{imageTypeLabel}</p>
          </div>
        </div>
        <span className="rounded-full bg-[#f5f2ed] px-3 py-1.5 text-xs font-medium text-[#1a1a1a]/55 shrink-0">
          光影渲染中
        </span>
      </div>

      <div className="rounded-2xl bg-[#faf8f4] border border-[#1a1a1a]/6 p-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-[11px] text-[#1a1a1a]/40 mb-1">渲染画幅</p>
          <p className="font-semibold">{generation.aspectRatio || DEFAULT_ASPECT_RATIO}</p>
        </div>
        <div>
          <p className="text-[11px] text-[#1a1a1a]/40 mb-1">生成类型</p>
          <p className="font-semibold">{imageTypeLabel}</p>
        </div>
        <div>
          <p className="text-[11px] text-[#1a1a1a]/40 mb-1">模特参考</p>
          <p className="font-semibold">{generation.hasModel ? "已上传" : "未使用"}</p>
        </div>
        <div>
          <p className="text-[11px] text-[#1a1a1a]/40 mb-1">场景参考</p>
          <p className="font-semibold">{generation.hasScene ? "已上传" : "默认生成"}</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-[11px] font-medium">
          <span className="text-[#1a1a1a]/45">整体渲染进度</span>
          <span className="text-[#1a1a1a]">{Math.floor(progress)}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-[#1a1a1a]/8 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#1a1a1a] transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="space-y-2 pt-1">
          {steps.map((stepText, stepIndex) => {
            const isCompleted = stepIndex < currentStep;
            const isActive = stepIndex === currentStep;
            return (
              <div key={stepText} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 w-4 h-4 rounded-full border border-[#1a1a1a]/15 flex items-center justify-center shrink-0">
                  {isCompleted ? (
                    <Check className="w-3 h-3 text-[#1a1a1a]/70" />
                  ) : isActive ? (
                    <span className="w-2 h-2 rounded-full bg-[#1a1a1a] animate-pulse" />
                  ) : null}
                </span>
                <span
                  className={
                    isCompleted
                      ? "text-[#1a1a1a]/38 line-through"
                      : isActive
                        ? "text-[#1a1a1a] font-medium"
                        : "text-[#1a1a1a]/42"
                  }
                >
                  {stepText}
                </span>
              </div>
            );
          })}
        </div>
        {generation.note && (
          <p className="text-xs text-[#1a1a1a]/50 pt-1">{generation.note}</p>
        )}
      </div>
    </div>
  );
}

function ChatGenerationPendingCard({ message }: { message?: string }) {
  return (
    <div className="mt-3 w-full max-w-[34rem] rounded-[24px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-2">
      <p className="font-semibold">生成状态待确认</p>
      <p className="leading-relaxed">
        {message ||
          "当前请求被网关中断，但后台可能已经生成并保存成功。请先到生成记录中确认；如果记录中没有结果，再重新生成。"}
      </p>
    </div>
  );
}

function ChatGenerationResultCard({
  generation,
  fallbackAspectRatio,
  onPreview,
}: {
  generation: ChatGeneration;
  fallbackAspectRatio: string;
  onPreview: (images: string[], index: number) => void;
}) {
  const images = generation.images || [];
  const imageTypeLabel = generation.imageType === "closeup" ? "细节近景" : "商品主图";

  return (
    <div className="mt-3 w-full max-w-[34rem] rounded-[28px] border border-[#1a1a1a]/8 bg-white p-5 shadow-[0_14px_36px_rgb(0,0,0,0.06)] space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#1a1a1a]">生成结果</p>
          <p className="text-xs text-[#1a1a1a]/45 mt-1">
            {generation.note || "图片已生成在对话中。"}
          </p>
        </div>
        <span className="rounded-full bg-[#f5f2ed] px-3 py-1.5 text-[11px] font-medium text-[#1a1a1a]/55 shrink-0">
          {imageTypeLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {images.map((img, idx) => (
          <div key={`${img}-${idx}`} className="space-y-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => onPreview(images, idx)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPreview(images, idx);
                }
              }}
              className={`relative ${getAspectClassName(generation.aspectRatio || fallbackAspectRatio)} rounded-[20px] overflow-hidden bg-[#f5f2ed] border border-[#1a1a1a]/10 cursor-zoom-in group`}
              title="预览生成图"
            >
              <Image
                src={img}
                alt={`Generated chat result ${idx + 1}`}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                unoptimized
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/18 transition-colors flex items-center justify-center">
                <span className="rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-[#1a1a1a] opacity-0 group-hover:opacity-100 transition-opacity">
                  点击预览高清图
                </span>
              </div>
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
  );
}

export default function Home() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("HOME");
  const [chatShellHeight, setChatShellHeight] = useState("100dvh");
  const [step, setStep] = useState<Step>("UPLOAD");
  const [images, setImages] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
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
      content: CHAT_WELCOME_CONTENT,
      actions: CHAT_WELCOME_ACTIONS,
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBrief, setChatBrief] = useState("");
  const [chatImages, setChatImages] = useState<string[]>([]);
  const [chatSceneImage, setChatSceneImage] = useState<string | null>(null);
  const [chatModelImage, setChatModelImage] = useState<string | null>(null);
  const [chatAnalysis, setChatAnalysis] = useState<AnalysisResult | null>(null);
  const [chatStage, setChatStage] = useState<ChatStage>("chooseType");
  const [chatStyle, setChatStyle] = useState<string | null>(null);
  const [chatAspectRatio, setChatAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  const [chatImageType, setChatImageType] = useState<ImageType>("main");
  const [chatGenerationCount, setChatGenerationCount] = useState<number>(1);
  const [chatGeneratedImages, setChatGeneratedImages] = useState<string[]>([]);
  const [chatIsBusy, setChatIsBusy] = useState(false);
  const [isChatUploadMenuOpen, setIsChatUploadMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sceneInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const chatProductInputRef = useRef<HTMLInputElement>(null);
  const chatSceneInputRef = useRef<HTMLInputElement>(null);
  const chatModelInputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const openImagePreview = (items: string[], index = 0) => {
    if (items.length === 0) return;
    setPreviewImages(items);
    setPreviewImageIndex(Math.min(Math.max(index, 0), items.length - 1));
    setIsLightboxOpen(true);
  };

  const closeImagePreview = () => {
    setIsLightboxOpen(false);
  };

  const showPreviousPreview = () => {
    setPreviewImageIndex((prev) => (prev <= 0 ? previewImages.length - 1 : prev - 1));
  };

  const showNextPreview = () => {
    setPreviewImageIndex((prev) => (prev >= previewImages.length - 1 ? 0 : prev + 1));
  };

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

  useEffect(() => {
    if (workspaceMode !== "CHAT") {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    const updateChatShellHeight = () => {
      const top = Math.max(0, mainRef.current?.getBoundingClientRect().top || 0);
      setChatShellHeight(`calc(100dvh - ${Math.round(top)}px)`);
    };

    updateChatShellHeight();
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("resize", updateChatShellHeight);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("resize", updateChatShellHeight);
    };
  }, [workspaceMode]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const compressed = await compressImage(files[0]);
      const isReplacing = images.length > 0;
      setImages([compressed]);
      setAnalysis(null);
      setError(
        files.length > MAX_PRODUCT_REFERENCE_IMAGES
          ? "每类参考图只保留 1 张，已使用本次选择的第一张商品图替换旧图。"
          : isReplacing
            ? "商品图已替换为最新上传图片。"
            : null
      );
    } catch (err) {
      console.error("Failed to compress images:", err);
      setError("图片处理失败，请重试");
    } finally {
      e.target.value = "";
    }
  };

  const handleSceneUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setSceneImage(compressed);
      setError(null);
    } catch (err) {
      console.error("Failed to compress scene image:", err);
      setError("场景图处理失败，请重试");
    } finally {
      e.target.value = "";
    }
  };

  const handleModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setModelImage(compressed);
      setError(null);
    } catch (err) {
      console.error("Failed to compress model image:", err);
      setError("模特图处理失败，请重试");
    } finally {
      e.target.value = "";
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
      setError(
        isGenerationResultPendingError(err)
          ? "生成状态待确认：当前请求在后置上传或入库阶段超时，但后台可能已经生成并保存成功。请先到生成记录中确认；如果记录中没有结果，再重新生成。"
          : err.message || "生成图片过程中发生错误，请重试。"
      );
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
        content: CHAT_WELCOME_CONTENT,
        actions: CHAT_WELCOME_ACTIONS,
      },
    ]);
    setChatInput("");
    setChatBrief("");
    setChatImages([]);
    setChatSceneImage(null);
    setChatModelImage(null);
    setChatAnalysis(null);
    setChatStage("chooseType");
    setChatStyle(null);
    setChatAspectRatio(DEFAULT_ASPECT_RATIO);
    setChatImageType("main");
    setChatGenerationCount(1);
    setChatGeneratedImages([]);
    setChatIsBusy(false);
    setIsChatUploadMenuOpen(false);
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

  const markReplacedChatReference = (category: ChatImageCategory) => {
    const labels: Record<ChatImageCategory, string> = {
      product: "商品参考图",
      scene: "场景参考图",
      model: "模特参考图",
    };

    setChatMessages((prev) =>
      prev.map((message) =>
        message.imageCategory === category
          ? {
              ...message,
              content: `此前${labels[category]}已被最新上传替换`,
              images: undefined,
            }
          : message
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
      setChatStage("optionalRefs");
      updateChatMessage(statusId, {
        content:
          "商品图已分析完成。我会按常规生图逻辑保留商品材质、颜色、图案和细节。你可以选择生成商品主图或细节近景，也可以继续上传自定义场景或模特图。",
        actions: getChatGenerationActions(),
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
      const compressed = await compressImage(files[0]);
      const isReplacing = chatImages.length > 0;
      const nextImages = [compressed];
      if (isReplacing) {
        markReplacedChatReference("product");
      }
      setChatImages(nextImages);
      setChatAnalysis(null);
      addChatMessage({
        role: "user",
        content:
          files.length > MAX_PRODUCT_REFERENCE_IMAGES
            ? "已上传商品参考图。每类只保留 1 张，本次使用第一张替换旧图。"
            : isReplacing
              ? "已替换商品参考图"
              : "已上传商品参考图",
        images: [compressed],
        imageCategory: "product",
      });
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
      if (chatSceneImage) {
        markReplacedChatReference("scene");
      }
      setChatSceneImage(compressed);
      addChatMessage({
        role: "user",
        content: chatSceneImage ? "已替换场景参考图" : "已上传场景参考图",
        images: [compressed],
        imageCategory: "scene",
      });
      addChatMessage({
        role: "assistant",
        content: "收到自定义场景图。生成时我会优先参考这张图里的空间、家具、光影和氛围。",
        actions: [
          ...(chatModelImage
            ? []
            : [
                {
                  type: "uploadModel",
                  label: "上传模特图",
                  description: "可选，用于真人互动效果",
                } as ChatAction,
              ]),
          { type: "imageType", label: "商品主图", value: "main" },
          { type: "imageType", label: "细节近景", value: "closeup" },
          { type: "aspect", label: "3:4 竖版", value: "3:4" },
          { type: "generate", label: "生成图片" },
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
      if (chatModelImage) {
        markReplacedChatReference("model");
      }
      setChatModelImage(compressed);
      addChatMessage({
        role: "user",
        content: chatModelImage ? "已替换模特参考图" : "已上传模特参考图",
        images: [compressed],
        imageCategory: "model",
      });
      addChatMessage({
        role: "assistant",
        content: "收到模特图。生成时我会让模特与床品自然互动，并保持光影统一。",
        actions: [
          ...(chatSceneImage
            ? []
            : [
                {
                  type: "uploadScene",
                  label: "上传场景图",
                  description: "可选，用于锁定房间结构和风格",
                } as ChatAction,
              ]),
          { type: "imageType", label: "商品主图", value: "main" },
          { type: "imageType", label: "细节近景", value: "closeup" },
          { type: "aspect", label: "3:4 竖版", value: "3:4" },
          { type: "generate", label: "生成图片" },
        ],
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
    settingsOverride?: Partial<ChatGenerationSettings>,
    analysisOverride?: AnalysisResult | null
  ) => {
    const activeBrief = (briefOverride ?? chatBrief).trim();
    const activeStyle = settingsOverride?.style ?? chatStyle;
    const activeAspectRatio = settingsOverride?.aspectRatio ?? chatAspectRatio;
    const activeImageType = settingsOverride?.imageType ?? chatImageType;
    const activeGenerationCount =
      settingsOverride?.generationCount ?? chatGenerationCount;
    const activeTypeLabel =
      activeImageType === "closeup" ? "细节近景图" : "商品主图";

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
        title: "AI 对话生图生成中",
        aspectRatio: activeAspectRatio,
        imageType: activeImageType,
        style: activeStyle,
        count: activeGenerationCount,
        hasScene: !!chatSceneImage,
        hasModel: !!chatModelImage,
        note: "正在解析商品材质、构图和参考图，请稍候...",
      },
    });

    try {
      const prompt = buildGenerationPrompt({
        analysis: analysisOverride || getChatAnalysis(activeBrief, activeStyle),
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
          title: `已生成${activeTypeLabel}`,
          aspectRatio: activeAspectRatio,
          imageType: activeImageType,
          style: activeStyle,
          count: activeGenerationCount,
          hasScene: !!chatSceneImage,
          hasModel: !!chatModelImage,
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
      const pendingResult = isGenerationResultPendingError(err);
      updateChatMessage(generationId, {
        content: pendingResult ? "生成状态待确认" : "生成失败",
        generation: {
          status: pendingResult ? "pending" : "error",
          error: pendingResult
            ? "当前请求被网关中断，但后台可能已经生成并保存成功。请先到生成记录中确认；如果记录中没有结果，再重新生成。"
            : err.message || "生成图片过程中发生错误，请重试。",
        },
        actions: [
          { type: "generate", label: "重试生成" },
          { type: "uploadProduct", label: "更换商品图" },
        ],
      });
    } finally {
      setChatIsBusy(false);
    }
  };

  const handleChatAction = async (action: ChatAction) => {
    if (chatIsBusy) {
      return;
    }

    if (action.prompt) {
      await handleChatSubmit(undefined, action.prompt);
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
      const nextType = action.value as ImageType;
      setChatImageType(nextType);
      setChatStage(chatImages.length > 0 ? "optionalRefs" : "uploadProduct");
      addChatMessage({
        role: "user",
        content: `选择生成类型：${nextType === "main" ? "商品主图" : "细节近景"}`,
      });
      addChatMessage({
        role: "assistant",
        content:
          nextType === "main"
            ? "已切换为商品主图。可以上传商品图，也可以补充场景、模特或文字要求。"
            : "已切换为细节近景。生成时会更强调面料纹理、花型和做工细节。",
        actions: chatImages.length > 0 ? getOptionalReferenceActions() : getTypeSelectedActions(),
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

  const getActionsForChatIntent = (intent: ChatIntentAction | null, text: string): ChatAction[] => {
    const uploadActions: ChatAction[] = [];
    if (/商品图|产品图|原图|上传商品|上传产品|传商品|传产品/.test(text)) {
      uploadActions.push({ type: "uploadProduct", label: "上传商品图" });
    }
    if (/场景图|参考图|空间图|上传场景|传场景/.test(text)) {
      uploadActions.push({ type: "uploadScene", label: "上传场景图" });
    }
    if (/模特图|人物图|真人图|上传模特|传模特/.test(text)) {
      uploadActions.push({ type: "uploadModel", label: "上传模特图" });
    }

    if (intent?.action === "analyze_image" && chatImages.length === 0) {
      return [{ type: "uploadProduct", label: "上传商品图" }];
    }

    if (intent?.action === "generate_smart") {
      return intent.directGenerate ? [] : getReadyToGenerateActions();
    }

    if (intent?.action === "update_config") {
      const parameterActions = getParameterActionsForText(text);
      return parameterActions.length > 0
        ? [...parameterActions, { type: "generate", label: "按当前参数生成" }]
        : getReadyToGenerateActions();
    }

    if (uploadActions.length > 0) return uploadActions;

    return chatImages.length > 0 ? getReadyToGenerateActions() : getChatGenerationActions();
  };

  const applyChatIntentSettings = (
    settings: ChatGenerationSettings,
    analysisPatch?: Partial<AnalysisResult>,
    instruction = ""
  ) => {
    if (settings.style !== chatStyle) {
      setChatStyle(settings.style);
    }
    if (settings.aspectRatio !== chatAspectRatio) {
      setChatAspectRatio(settings.aspectRatio);
    }
    if (settings.imageType !== chatImageType) {
      setChatImageType(settings.imageType);
      setChatStage(chatImages.length > 0 ? "optionalRefs" : "uploadProduct");
    }
    if (settings.generationCount !== chatGenerationCount) {
      setChatGenerationCount(settings.generationCount);
    }

    const hasAnalysisPatch = analysisPatch && Object.values(analysisPatch).some(Boolean);
    if (hasAnalysisPatch) {
      const base = chatAnalysis || createFallbackAnalysis(instruction, settings.style);
      const nextAnalysis: AnalysisResult = {
        material: analysisPatch?.material || base.material,
        color: analysisPatch?.color || base.color,
        pattern: analysisPatch?.pattern || base.pattern,
        style: analysisPatch?.style || settings.style || base.style,
        details: analysisPatch?.details || base.details,
        sellingPoint: analysisPatch?.sellingPoint || base.sellingPoint,
      };
      setChatAnalysis(nextAnalysis);
      return nextAnalysis;
    }

    if (settings.style) {
      setChatAnalysis((prev) => (prev ? { ...prev, style: settings.style || prev.style } : prev));
    }

    return null;
  };

  const handleChatSubmit = async (
    e?: React.FormEvent<HTMLFormElement>,
    overrideText?: string
  ) => {
    e?.preventDefault();
    const text = (overrideText ?? chatInput).trim();
    if (!text || chatIsBusy) return;

    const currentSettings: ChatGenerationSettings = {
      style: chatStyle,
      aspectRatio: chatAspectRatio,
      imageType: chatImageType,
      generationCount: chatGenerationCount,
    };
    const userMessage: ChatMessage = {
      id: getChatId(),
      role: "user",
      content: text,
    };
    const assistantId = getChatId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "正在理解你的画面需求...",
    };
    const nextMessages = [...chatMessages, userMessage];
    let handedOffToGeneration = false;

    setChatInput("");
    setIsChatUploadMenuOpen(false);
    setChatIsBusy(true);
    setChatMessages((prev) => [...prev, userMessage, assistantMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: serializeChatMessagesForApi(nextMessages),
          currentSettings,
          currentAnalysis: chatAnalysis,
          hasProductImages: chatImages.length > 0,
          hasSceneImage: !!chatSceneImage,
          hasModelImage: !!chatModelImage,
          saasInfo,
        }),
      });

      if (!response.ok) {
        let errorMessage = `AI 对话解析失败 (${response.status})`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {}
        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error("AI 对话未返回可读流");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let accumulatedText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        accumulatedText += decoder.decode(value, { stream: true });
        const reply = extractChatReply(accumulatedText);
        updateChatMessage(assistantId, {
          content: reply || "正在理解你的画面需求...",
        });
      }

      accumulatedText += decoder.decode();
      const streamErrorIndex = accumulatedText.indexOf("[ERROR]");
      if (streamErrorIndex >= 0) {
        const streamError = accumulatedText.slice(streamErrorIndex + "[ERROR]".length).trim();
        throw new Error(streamError || "AI 对话解析中断，请重试。");
      }

      const intent = parseChatIntentAction(accumulatedText);
      const reply = extractChatReply(accumulatedText) || "我已理解你的需求。";
      const nextSettings = getSettingsFromChatIntent(intent, text, currentSettings);
      const actionInstruction = intent?.smartParams?.extraInstruction?.trim() || text;
      const nextBrief = chatBrief ? `${chatBrief}\n${actionInstruction}` : actionInstruction;
      const isUploadOnlyRequest =
        intent?.action === "none" && /上传|补充|传/.test(text) && /商品图|产品图|原图|场景图|参考图|空间图|模特图|人物图|真人图/.test(text);
      const analysisOverride = applyChatIntentSettings(
        nextSettings,
        intent?.smartParams?.analysis,
        actionInstruction
      );
      const actions = getActionsForChatIntent(intent, text);

      if (
        intent?.action === "generate_smart" ||
        intent?.action === "update_config" ||
        (intent?.action === "none" && !isUploadOnlyRequest)
      ) {
        setChatBrief(nextBrief);
      }

      updateChatMessage(assistantId, {
        content: reply,
        actions,
      });

      if (!intent) {
        return;
      }

      if (intent.action === "analyze_image") {
        if (chatImages.length === 0) {
          return;
        }
        setChatIsBusy(false);
        await runChatAnalysis();
        return;
      }

      if (intent.action === "generate_smart" && intent.directGenerate) {
        handedOffToGeneration = true;
        setChatIsBusy(false);
        await generateChatImage(nextBrief, nextSettings, analysisOverride);
      }
    } catch (err: any) {
      updateChatMessage(assistantId, {
        content: getFriendlyChatErrorMessage(err),
        actions: getChatGenerationActions(),
      });
    } finally {
      if (!handedOffToGeneration) {
        setChatIsBusy(false);
      }
    }
  };

  const latestAssistantMessageId = chatMessages.reduce<string | null>(
    (latestId, message) => (message.role === "assistant" ? message.id : latestId),
    null
  );

  return (
    <main
      ref={mainRef}
      style={workspaceMode === "CHAT" ? { height: chatShellHeight } : undefined}
      className={`flex flex-col ${
        workspaceMode === "CHAT"
          ? "min-h-0 overflow-hidden"
          : "min-h-screen overflow-visible"
      }`}
    >
      {/* Header */}
      <header className="w-full shrink-0 py-6 px-8 border-b border-[#1a1a1a]/10 flex justify-between items-center bg-white/50 backdrop-blur-md sticky top-0 z-50">
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
      <div
        className={`flex-1 flex flex-col relative ${
          workspaceMode === "CHAT"
            ? "min-h-0 items-center overflow-hidden p-3 sm:p-4 lg:p-6 xl:p-8"
            : "items-center overflow-y-auto p-6 md:p-12"
        }`}
      >
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
                        支持 JPG, PNG，每次保留最新 1 张商品图
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
                      onClick={() => modelInputRef.current?.click()}
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
                          <div className="absolute inset-x-0 bottom-0 bg-black/45 py-2 text-center text-xs font-medium text-white">
                            点击更换模特图
                          </div>
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
                      当前商品图
                    </h3>
                    <div className="flex gap-4 overflow-x-auto pb-4">
                      {images.map((img, idx) => (
                        <div
                          key={idx}
                          role="button"
                          tabIndex={0}
                          onClick={() => openImagePreview(images, idx)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openImagePreview(images, idx);
                            }
                          }}
                          className="relative w-24 h-24 flex-shrink-0 rounded-2xl overflow-hidden group border border-[#1a1a1a]/10 cursor-zoom-in"
                          title="预览图片"
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
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeImage(idx);
                            }}
                            className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                            title="移除图片"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <span className="absolute inset-x-0 bottom-0 bg-black/45 py-1 text-[11px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                            预览
                          </span>
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
                      onClick={() => openImagePreview(generatedImages, selectedImageIndex)}
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
              className="w-full max-w-[92rem] flex flex-1 min-h-0"
            >
              <input
                type="file"
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

              <section className="w-full flex-1 min-h-0 bg-white rounded-[24px] sm:rounded-[32px] border border-[#1a1a1a]/5 shadow-[0_12px_38px_rgb(0,0,0,0.05)] overflow-hidden flex flex-col">
                <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-5 border-b border-[#1a1a1a]/10 flex items-center justify-between gap-4">
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
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 lg:p-8 space-y-5 lg:space-y-6 bg-[#faf8f4]"
                >
                  {chatMessages.map((message, index) => {
                    const isUser = message.role === "user";
                    const isWelcomeActions = !isUser && index === 0;
                    const isLatestAssistantActions =
                      !isUser && !isWelcomeActions && message.id === latestAssistantMessageId;
                    const shouldShowActions =
                      !!message.actions?.length &&
                      ((isWelcomeActions && chatMessages.length === 1) || isLatestAssistantActions);

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
                          className={`max-w-[min(58rem,88%)] flex flex-col ${isUser ? "items-end" : "items-start"}`}
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
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => openImagePreview(message.images || [], idx)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      openImagePreview(message.images || [], idx);
                                    }
                                  }}
                                  className="relative w-28 aspect-square rounded-2xl overflow-hidden border border-[#1a1a1a]/10 bg-white cursor-zoom-in group"
                                  title="预览图片"
                                >
                                  <Image
                                    src={img}
                                    alt={`Chat upload ${idx + 1}`}
                                    fill
                                    className="object-cover"
                                    unoptimized
                                    referrerPolicy="no-referrer"
                                  />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/18 transition-colors flex items-center justify-center">
                                    <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-[#1a1a1a] opacity-0 group-hover:opacity-100 transition-opacity">
                                      预览
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {message.generation && (
                            <>
                              {message.generation.status === "loading" && (
                                <ChatGenerationLoadingCard generation={message.generation} />
                              )}
                              {message.generation.status === "error" && (
                                <div className="mt-3 w-full max-w-[34rem] rounded-[24px] border border-red-100 bg-red-50 p-4 text-sm text-red-600">
                                  {message.generation.error}
                                </div>
                              )}
                              {message.generation.status === "pending" && (
                                <ChatGenerationPendingCard message={message.generation.error} />
                              )}
                              {message.generation.status === "success" && (
                                <ChatGenerationResultCard
                                  generation={message.generation}
                                  fallbackAspectRatio={chatAspectRatio}
                                  onPreview={openImagePreview}
                                />
                              )}
                            </>
                          )}

                          {shouldShowActions && message.actions && (
                            <div
                              className={
                                isWelcomeActions
                                  ? "mt-3 w-full rounded-2xl border border-[#1a1a1a]/8 bg-white/75 p-3 shadow-[0_8px_22px_rgb(0,0,0,0.035)]"
                                  : isLatestAssistantActions
                                    ? "mt-3 w-full rounded-2xl border border-[#1a1a1a]/8 bg-white/75 p-3 shadow-[0_8px_22px_rgb(0,0,0,0.035)]"
                                    : "mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full"
                              }
                            >
                              {isWelcomeActions && (
                                <div className="mb-2.5 flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <Wand2 className="w-3.5 h-3.5 text-[#1a1a1a]/55" />
                                    <span className="text-[11px] font-semibold text-[#1a1a1a]/60">
                                      快捷入口
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-[#1a1a1a]/38">
                                    也可以直接打字描述
                                  </span>
                                </div>
                              )}
                              {isLatestAssistantActions && (
                                <div className="mb-2.5 flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <Settings className="w-3.5 h-3.5 text-[#1a1a1a]/55" />
                                    <span className="text-[11px] font-semibold text-[#1a1a1a]/60">
                                      智能参数调节与下一步操作
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-[#1a1a1a]/38">
                                    当前 {chatAspectRatio} · {chatImageType === "closeup" ? "细节近景" : "商品主图"}
                                  </span>
                                </div>
                              )}
                              <div className={isWelcomeActions || isLatestAssistantActions ? "grid grid-cols-2 gap-2" : "contents"}>
                              {message.actions.map((action, idx) => (
                                <button
                                  key={`${message.id}-${action.type}-${action.value || idx}`}
                                  onClick={() => handleChatAction(action)}
                                  disabled={chatIsBusy}
                                  className={
                                    isWelcomeActions || isLatestAssistantActions
                                      ? "min-h-[4.25rem] text-left rounded-xl border border-[#1a1a1a]/8 bg-white px-3 py-2.5 hover:border-[#1a1a1a]/25 hover:bg-[#f5f2ed]/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                      : "text-left rounded-2xl border border-[#1a1a1a]/10 bg-white px-4 py-3 hover:border-[#1a1a1a]/30 hover:bg-[#f5f2ed]/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  }
                                >
                                  <span className={isWelcomeActions || isLatestAssistantActions ? "flex items-start gap-2" : "block"}>
                                    {(isWelcomeActions || isLatestAssistantActions) && (
                                      <span className="mt-0.5 w-7 h-7 rounded-full bg-[#f5f2ed] border border-[#1a1a1a]/6 flex items-center justify-center shrink-0">
                                        {action.type === "uploadProduct" && <Images className="w-3.5 h-3.5 text-[#1a1a1a]/62" />}
                                        {action.type === "uploadScene" && <ImageIcon className="w-3.5 h-3.5 text-[#1a1a1a]/62" />}
                                        {action.type === "uploadModel" && <UserRound className="w-3.5 h-3.5 text-[#1a1a1a]/62" />}
                                        {action.type === "imageType" && action.value === "main" && <Sparkles className="w-3.5 h-3.5 text-[#1a1a1a]/62" />}
                                        {action.type === "imageType" && action.value === "closeup" && <ImageIcon className="w-3.5 h-3.5 text-[#1a1a1a]/62" />}
                                        {action.type === "style" && <Wand2 className="w-3.5 h-3.5 text-[#1a1a1a]/62" />}
                                        {action.type === "aspect" && <Settings className="w-3.5 h-3.5 text-[#1a1a1a]/62" />}
                                        {action.type === "count" && <Images className="w-3.5 h-3.5 text-[#1a1a1a]/62" />}
                                        {action.type === "generate" && <Sparkles className="w-3.5 h-3.5 text-[#1a1a1a]/62" />}
                                      </span>
                                    )}
                                    <span className="min-w-0">
                                      <span className={isWelcomeActions || isLatestAssistantActions ? "text-[13px] font-semibold block text-[#1a1a1a]" : "text-sm font-medium block"}>
                                        {action.label}
                                      </span>
                                      {action.description && (
                                        <span className={isWelcomeActions || isLatestAssistantActions ? "text-[11px] leading-snug text-[#1a1a1a]/45 mt-0.5 block" : "text-xs text-[#1a1a1a]/50 mt-1 block"}>
                                          {action.description}
                                        </span>
                                      )}
                                    </span>
                                  </span>
                                </button>
                              ))}
                              </div>
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
                  className="p-3 sm:p-4 lg:px-6 border-t border-[#1a1a1a]/10 bg-white flex items-end gap-3"
                >
                  <div className="relative pb-1">
                    <AnimatePresence>
                      {isChatUploadMenuOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 8, scale: 0.98 }}
                          transition={{ duration: 0.15 }}
                          className="absolute bottom-full left-0 mb-3 w-48 overflow-hidden rounded-2xl border border-[#1a1a1a]/10 bg-white shadow-[0_18px_50px_rgb(0,0,0,0.12)] z-20"
                        >
                          <button
                            type="button"
                            disabled={chatIsBusy}
                            onClick={() => {
                              setIsChatUploadMenuOpen(false);
                              chatProductInputRef.current?.click();
                            }}
                            className="w-full px-4 py-3 text-left text-sm font-medium text-[#1a1a1a] hover:bg-[#f5f2ed] transition-colors flex items-center gap-3"
                          >
                            <Images className="w-4 h-4 text-[#1a1a1a]/65" />
                            {chatImages.length > 0 ? "更换商品图" : "商品图"}
                          </button>
                          <button
                            type="button"
                            disabled={chatIsBusy}
                            onClick={() => {
                              setIsChatUploadMenuOpen(false);
                              chatSceneInputRef.current?.click();
                            }}
                            className="w-full px-4 py-3 text-left text-sm font-medium text-[#1a1a1a] hover:bg-[#f5f2ed] transition-colors flex items-center gap-3 border-t border-[#1a1a1a]/5"
                          >
                            <ImageIcon className="w-4 h-4 text-[#1a1a1a]/65" />
                            {chatSceneImage ? "更换场景图" : "场景图"}
                          </button>
                          <button
                            type="button"
                            disabled={chatIsBusy}
                            onClick={() => {
                              setIsChatUploadMenuOpen(false);
                              chatModelInputRef.current?.click();
                            }}
                            className="w-full px-4 py-3 text-left text-sm font-medium text-[#1a1a1a] hover:bg-[#f5f2ed] transition-colors flex items-center gap-3 border-t border-[#1a1a1a]/5"
                          >
                            <UserRound className="w-4 h-4 text-[#1a1a1a]/65" />
                            {chatModelImage ? "更换模特图" : "模特图"}
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <button
                      type="button"
                      onClick={() => setIsChatUploadMenuOpen((open) => !open)}
                      disabled={chatIsBusy}
                      className="w-10 h-10 rounded-full border border-[#1a1a1a]/10 flex items-center justify-center hover:bg-[#f5f2ed] transition-colors"
                      title="上传参考图"
                      aria-label="上传参考图"
                      aria-expanded={isChatUploadMenuOpen}
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                  </div>
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onFocus={() => setIsChatUploadMenuOpen(false)}
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
          {isLightboxOpen && previewImages.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 md:p-12"
              onClick={closeImagePreview}
            >
              <button
                className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors"
                onClick={closeImagePreview}
                title="关闭预览"
              >
                <X className="w-8 h-8" />
              </button>
              {previewImages.length > 1 && (
                <>
                  <button
                    className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors flex items-center justify-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      showPreviousPreview();
                    }}
                    title="上一张"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <button
                    className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors flex items-center justify-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      showNextPreview();
                    }}
                    title="下一张"
                  >
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </>
              )}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
                {previewImages.length > 1 && (
                  <span className="rounded-full bg-white/10 px-3 py-2 text-xs text-white/75">
                    {previewImageIndex + 1} / {previewImages.length}
                  </span>
                )}
                <a
                  href={previewImages[previewImageIndex]}
                  download={`preview-image-${previewImageIndex + 1}.png`}
                  className="rounded-full bg-white text-[#1a1a1a] px-4 py-2 text-sm font-medium hover:bg-white/90 transition-colors flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download className="w-4 h-4" /> 下载
                </a>
              </div>
              <div
                className="relative w-full h-full max-w-5xl"
                onClick={(e) => e.stopPropagation()}
              >
                <Image
                  src={previewImages[previewImageIndex]}
                  alt="Preview Image Fullscreen"
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
