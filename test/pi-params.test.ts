import { describe, expect, it } from "vitest";
import { callParameters } from "../src/pi-params.js";

describe("tool-call parameter previews", () => {
  it.each(["search", "contents", "answer", "research"] as const)(
    "shows explicit model options for %s without input text",
    (capability) => {
      expect(
        callParameters(capability, {
          queries: ["hidden query"],
          urls: ["https://hidden.test"],
          input: "hidden brief",
          options: {
            model: "gemini-2.5-flash",
            config: { temperature: 0, maxOutputTokens: 512 },
            thinking: { type: "adaptive" },
          },
        }),
      ).toBe(
        "model=gemini-2.5-flash config.temperature=0 config.maxOutputTokens=512 thinking.type=adaptive",
      );
    },
  );

  it("preserves booleans, empty values, arrays, and strings needing quotes", () => {
    expect(
      callParameters("search", {
        maxResults: 2,
        options: {
          enabled: false,
          count: 0,
          category: "research paper",
          empty: "",
          none: null,
          text: "true",
          numeric: "123",
          flags: [],
          object: {},
          domains: ["example.com", "example.org"],
          limit: 3,
        },
      }),
    ).toBe(
      'limit=2 enabled=false count=0 category="research paper" empty="" none=null text="true" numeric="123" flags=[] object={} domains=["example.com","example.org"] options.limit=3',
    );
  });

  it.each([undefined, null, [], "bad", 42, {}])(
    "omits absent or malformed option containers: %j",
    (options) => {
      expect(callParameters("search", { options })).toBe("");
    },
  );

  it("omits undefined values and non-finite limits", () => {
    expect(
      callParameters("search", {
        maxResults: NaN,
        options: { omitted: undefined, model: "chosen" },
      }),
    ).toBe("model=chosen");
    expect(callParameters("answer", { maxResults: 3 })).toBe("");
  });

  it("redacts sensitive keys recursively but preserves token budgets", () => {
    const options = {
      apiKey: "do-not-show",
      access_token: "do-not-show",
      password: "do-not-show",
      credentials: { value: "do-not-show" },
      headers: { authorization: "do-not-show" },
      nested: { clientSecret: "do-not-show", token: "do-not-show" },
      steps: [{ authorization: "do-not-show", count: 1 }],
      maxTokens: 500,
      maxThinkingTokens: 100,
      max_output_tokens: 600,
    };
    const text = callParameters("research", { options });
    expect(text).not.toContain("do-not-show");
    expect(text).toContain('apiKey="[redacted]"');
    expect(text).toContain('nested.token="[redacted]"');
    expect(text).toContain('steps=[{"authorization":"[redacted]","count":1}]');
    expect(text).toContain(
      "maxTokens=500 maxThinkingTokens=100 max_output_tokens=600",
    );
    expect(options.apiKey).toBe("do-not-show");
  });

  it("escapes control characters and sanitizes terminal sequences in keys and values", () => {
    const text = callParameters("answer", {
      options: {
        "\u001b[31mmodel": "\u001b[31mhello\nworld\u0007",
        "a.b": { "two words": 'a"b' },
      },
    });
    expect(text).toBe('model="hello\\nworld\\u0007" "a.b"."two words"="a\\"b"');
    expect(text).not.toMatch(/[\u001b\n\u0007]/);
  });

  it("tolerates cyclic values and repeated references without mutating arguments", () => {
    const options: Record<string, unknown> = { model: "chosen" };
    options.self = options;
    expect(callParameters("research", { options })).toBe(
      'model=chosen self="[Circular]"',
    );
    expect(options.self).toBe(options);
    const shared = { text: true };
    expect(
      callParameters("contents", {
        options: { first: shared, second: shared },
      }),
    ).toBe("first.text=true second.text=true");
  });
});
