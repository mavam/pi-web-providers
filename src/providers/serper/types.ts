import type { Provider } from "../contract.js";
export const SERPER_SEARCH_MODE_VALUES = {
  search: "search",
  images: "images",
  videos: "videos",
  places: "places",
  maps: "maps",
  reviews: "reviews",
  news: "news",
  shopping: "shopping",
  productReviews: "product-reviews",
  lens: "lens",
  scholar: "scholar",
  patents: "patents",
  autocomplete: "autocomplete",
  webpage: "webpage",
} as const;

export type SerperSearchMode =
  (typeof SERPER_SEARCH_MODE_VALUES)[keyof typeof SERPER_SEARCH_MODE_VALUES];

export interface Serper extends Provider {
  baseUrl?: string;
}
