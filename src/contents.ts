export interface ContentsEntry {
  url: string;
  title?: string;
  body: string;
  status?: "ready" | "failed";
}
