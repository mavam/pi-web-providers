import type {
  ContentsAnswer as DocumentContents,
  ProviderId,
  SerializedError,
} from "./domain.js";
import { WebMuxError } from "./errors.js";

/** Internal normalized page, before the adapter associates its request index. */
export interface ContentsAnswer extends DocumentContents {
  error?: string | SerializedError;
  inputIndex?: number;
}
export interface ContentsResponse {
  provider: ProviderId;
  answers: ContentsAnswer[];
}
export interface IndexedContentsResponse {
  provider: ProviderId;
  answers: Array<
    DocumentContents & { inputIndex: number; error?: SerializedError }
  >;
}
/** Only adapters that themselves assemble pages in request order use this helper. */
export function orderedContents(
  response: ContentsResponse,
): IndexedContentsResponse {
  return {
    provider: response.provider,
    answers: response.answers.map((answer, inputIndex) => ({
      ...answer,
      inputIndex,
      ...(answer.error
        ? {
            error:
              typeof answer.error === "string"
                ? new WebMuxError("PROVIDER_FAILURE", answer.error).toJSON()
                : answer.error,
          }
        : { error: undefined }),
    })),
  };
}
