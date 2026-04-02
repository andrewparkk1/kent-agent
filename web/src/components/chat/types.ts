export interface Message {
  id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata?: string | null;
  created_at: number;
}
