import { EMPLOYEES, type EmployeeId, type Modality } from "./registry";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "video_url"; video_url: { url: string } }
  | { type: "file"; file: unknown };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/** Non-text modalities present in the messages (drives capability filtering and vision routing). */
export function detectMedia(messages: ChatMessage[]): Modality[] {
  const found = new Set<Modality>();
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const p of m.content) {
      if (p.type === "image_url") found.add("image");
      else if (p.type === "input_audio") found.add("audio");
      else if (p.type === "video_url") found.add("video");
      else if (p.type === "file") found.add("file");
    }
  }
  return [...found];
}

const TASK_MAP: Record<string, EmployeeId> = {
  research: "scout",
  opportunity_analysis: "business_analyst",
  business_analysis: "business_analyst",
  long_reasoning: "ceo_master_planner",
  planning: "ceo_master_planner",
  mission_decomposition: "ceo_master_planner",
  tool_coordination: "ceo_master_planner",
  quick_response: "fast_worker",
  coding: "coding_engineer",
  writing: "writer",
  routing: "mission_router",
  image: "vision_employee",
  video: "vision_employee",
  audio: "vision_employee",
  ocr: "document_analyst",
  document: "document_analyst",
};

export interface RouteResult {
  employee: EmployeeId;
  reason: "explicit_employee" | "media" | "task_type" | "default";
}

/**
 * Precedence: explicit employee > attached media > taskType > default (fast_worker).
 * An unknown explicit employee throws so callers return a clear 4xx instead of silently rerouting.
 */
export function routeTask(input: { employee?: string; taskType?: string; media?: Modality[] }): RouteResult {
  if (input.employee !== undefined) {
    if (!(EMPLOYEES as readonly string[]).includes(input.employee)) {
      throw Object.assign(new Error(`Unknown employee "${input.employee}"`), { code: "EMPLOYEE_NOT_FOUND", status: 404 });
    }
    return { employee: input.employee as EmployeeId, reason: "explicit_employee" };
  }
  const media = input.media ?? [];
  if (media.includes("image") || media.includes("video") || media.includes("audio")) return { employee: "vision_employee", reason: "media" };
  if (media.includes("file")) return { employee: "document_analyst", reason: "media" };
  const mapped = input.taskType ? TASK_MAP[input.taskType] : undefined;
  if (mapped) return { employee: mapped, reason: "task_type" };
  return { employee: "fast_worker", reason: "default" };
}
