import { describe, expect, it } from "bun:test";
import { extractJson } from "../../src/llm/json-extract.ts";

describe("extractJson", () => {
  it("parses a plain JSON object string", () => {
    const result = extractJson('{"name": "alice", "age": 30}');
    expect(result).toEqual({ name: "alice", age: 30 });
  });

  it("parses fenced JSON with leading/trailing whitespace inside the fence", () => {
    const input = '```\n\n  { "key": "value" }  \n\n```';
    const result = extractJson(input);
    expect(result).toEqual({ key: "value" });
  });

  it("parses fenced JSON with json info-string", () => {
    const input = '```json\n{"foo": 42}\n```';
    const result = extractJson(input);
    expect(result).toEqual({ foo: 42 });
  });

  it("extracts JSON after prose (no fences)", () => {
    const input = 'Here is the result:\n\n{"status": "ok"}';
    const result = extractJson(input);
    expect(result).toEqual({ status: "ok" });
  });

  it("returns undefined for invalid JSON", () => {
    expect(extractJson("not json at all")).toBeUndefined();
    expect(extractJson("{bad json")).toBeUndefined();
    expect(extractJson("")).toBeUndefined();
  });

  it("parses JSON containing a literal } inside a string", () => {
    const input = '{"text": "a } b", "count": 1}';
    const result = extractJson(input);
    expect(result).toEqual({ text: "a } b", count: 1 });
  });

  it("parses JSON containing nested braces in strings", () => {
    const input = '{"template": "{greeting}", "count": 2}';
    const result = extractJson(input);
    expect(result).toEqual({ template: "{greeting}", count: 2 });
  });

  it("parses JSON with escaped quotes in strings", () => {
    const input = '{"msg": "she said \\"yes\\""}';
    const result = extractJson(input);
    expect(result).toEqual({ msg: 'she said "yes"' });
  });

  it("parses a JSON array", () => {
    const input = "[1, 2, 3]";
    const result = extractJson(input);
    expect(result).toEqual([1, 2, 3]);
  });

  it("extracts a JSON array after prose", () => {
    const input = 'The items are:\n["a", "b"]';
    const result = extractJson(input);
    expect(result).toEqual(["a", "b"]);
  });
});
