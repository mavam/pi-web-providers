import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { optionSchema } from "../src/configuration/planning.js";
import { exaProvider } from "../src/providers/exa/definition.js";
import { prepareToolArguments } from "../src/pi-validation.js";

const schema = Type.Object(
  {
    queries: Type.Array(Type.String()),
    maxResults: Type.Optional(Type.Integer({ minimum: 1 })),
    options: Type.Optional(optionSchema(exaProvider, "search")!),
  },
  { additionalProperties: false },
);

describe("unknown tool parameter diagnostics", () => {
  it("identifies misplaced Exa highlights and suggests their supported location", () => {
    const args = {
      queries: ["private query"],
      options: { highlights: { query: "private value" }, userLocation: "US" },
    };
    const original = structuredClone(args);
    expect(() => prepareToolArguments(schema, args)).toThrow(
      "Invalid parameter: options.highlights. Use options.contents.highlights instead.",
    );
    expect(args).toEqual(original);
  });

  it("accepts corrected options without rewriting them", () => {
    const args = {
      queries: ["q"],
      options: {
        contents: {
          highlights: { query: "q", maxCharacters: 500 },
          text: { maxCharacters: 1200, verbosity: "compact" },
        },
        userLocation: "US",
      },
    };
    expect(prepareToolArguments(schema, args)).toBe(args);
  });

  it("reports unknown nested properties across boolean/object unions without echoing values", () => {
    const args = {
      queries: ["private query"],
      options: { contents: { text: { unknown: "private credential" } } },
    };
    expect(() => prepareToolArguments(schema, args)).toThrow(
      "Invalid parameter: options.contents.text.unknown. Check the tool's parameter schema.",
    );
    try {
      prepareToolArguments(schema, args);
    } catch (error) {
      expect(String(error)).not.toContain("private");
      expect(String(error)).not.toContain("Received arguments");
    }
  });

  it("reports multiple unsupported fields with a bounded diagnostic", () => {
    expect(() =>
      prepareToolArguments(schema, { queries: ["q"], a: 1, b: 2, c: 3, d: 4 }),
    ).toThrow("Invalid parameter: a.");
    try {
      prepareToolArguments(schema, { queries: ["q"], a: 1, b: 2, c: 3, d: 4 });
    } catch (error) {
      expect((error as Error).message.split("\n")).toHaveLength(3);
      expect((error as Error).message).not.toContain("parameter: d");
    }
  });

  it("does not suggest a location when the property name is ambiguous", () => {
    const ambiguous = Type.Object(
      {
        first: Type.Optional(Type.Object({ model: Type.String() })),
        second: Type.Optional(Type.Object({ model: Type.String() })),
      },
      { additionalProperties: false },
    );
    expect(() => prepareToolArguments(ambiguous, { model: "chosen" })).toThrow(
      "Invalid parameter: model. Check the tool's parameter schema.",
    );
  });

  it("does not misidentify known properties from a different union branch", () => {
    const union = Type.Union([
      Type.Object(
        { kind: Type.Literal("a"), first: Type.Number() },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal("b"), second: Type.Number() },
        { additionalProperties: false },
      ),
    ]);
    const args = { kind: "b", second: "wrong type" };
    expect(prepareToolArguments(union, args)).toBe(args);
  });

  it("respects open objects and pattern properties", () => {
    const open = Type.Object({
      arbitrary: Type.Object({}, { additionalProperties: true }),
      records: Type.Record(Type.String(), Type.Number()),
    });
    const args = {
      arbitrary: { anything: true },
      records: { chosen: "wrong type" },
    };
    expect(prepareToolArguments(open, args)).toBe(args);
  });

  it("identifies array item paths and escapes special property names", () => {
    const array = Type.Object({
      steps: Type.Array(Type.Object({}, { additionalProperties: false })),
    });
    expect(() =>
      prepareToolArguments(array, { steps: [{ "a/b~\n": "private" }] }),
    ).toThrow('Invalid parameter: steps[0]["a/b~\\n"].');
  });

  it("leaves required-field checks and coercion to Pi", () => {
    const args = { queries: ["q"], maxResults: "2" };
    expect(prepareToolArguments(schema, args)).toBe(args);
    const tool = { name: "web_search", description: "", parameters: schema };
    expect(
      validateToolArguments(tool, {
        type: "toolCall",
        id: "test",
        name: tool.name,
        arguments: args,
      }),
    ).toMatchObject({ maxResults: 2 });
    for (const invalid of [
      null,
      {},
      { queries: 42 },
      { queries: ["q"], options: { type: "invalid" } },
    ])
      expect(prepareToolArguments(schema, invalid)).toBe(invalid);
  });
});
