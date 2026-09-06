import type { Provider } from "../contract.js";
export interface Cloudflare extends Provider {
  accountId?: string;
}
