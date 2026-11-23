import { describe, it, expect } from "vitest";
import { classifyInput } from "../../server/pipeline/classifier";

describe("classifyInput", () => {
  it("classifies OOC messages as trivial", () => {
    expect(classifyInput("OOC: what level am I?")).toBe("trivial");
    expect(classifyInput("(out of character question)")).toBe("trivial");
  });

  it("classifies acknowledgments as trivial", () => {
    expect(classifyInput("yes")).toBe("trivial");
    expect(classifyInput("ok")).toBe("trivial");
    expect(classifyInput("sure")).toBe("trivial");
  });

  it("classifies scene-continuation phrases as standard (preserves scene context)", () => {
    expect(classifyInput("continue")).toBe("standard");
    expect(classifyInput("go ahead")).toBe("standard");
    expect(classifyInput("go on")).toBe("standard");
  });

  it("classifies state queries as trivial", () => {
    expect(classifyInput("what's my hp")).toBe("trivial");
    expect(classifyInput("What is my inventory")).toBe("trivial");
  });

  it("classifies location queries as trivial", () => {
    expect(classifyInput("where am I")).toBe("trivial");
  });

  it("classifies recap requests as trivial", () => {
    expect(classifyInput("recap")).toBe("trivial");
    expect(classifyInput("what happened")).toBe("trivial");
  });

  it("classifies actions as standard", () => {
    expect(classifyInput("I attack the goblin")).toBe("standard");
    expect(classifyInput("I try to pick the lock")).toBe("standard");
    expect(classifyInput("Let's explore the dungeon")).toBe("standard");
  });

  it("defaults to standard for ambiguous input", () => {
    expect(classifyInput("hello")).toBe("standard");
    expect(classifyInput("I look around carefully")).toBe("standard");
  });

  it("handles slash commands as trivial", () => {
    expect(classifyInput("/help")).toBe("trivial");
    expect(classifyInput("/stats")).toBe("trivial");
  });

  it("classifies RP actions as standard", () => {
    expect(classifyInput("I nod")).toBe("standard");
    expect(classifyInput("*smiles*")).toBe("standard");
    expect(classifyInput('"Get out of my way."')).toBe("standard");
    expect(classifyInput("I shake my head slowly")).toBe("standard");
  });

  it("classifies session start as standard", () => {
    expect(classifyInput("[SESSION START — set the opening scene]")).toBe("standard");
  });

  it("classifies bare yes/no as trivial but yes with context as standard", () => {
    expect(classifyInput("yes")).toBe("trivial");
    expect(classifyInput("no")).toBe("trivial");
    expect(classifyInput("yes, I agree to the deal")).toBe("standard");
  });

  // Spanish support
  it("classifies Spanish state queries as trivial", () => {
    expect(classifyInput("cuál es mi hp")).toBe("trivial");
    expect(classifyInput("cuánto hp tengo")).toBe("trivial");
    expect(classifyInput("dónde estoy")).toBe("trivial");
    expect(classifyInput("resumen")).toBe("trivial");
  });

  it("classifies Spanish RP actions as standard", () => {
    expect(classifyInput("asiento con la cabeza")).toBe("standard");
    expect(classifyInput("sonrío")).toBe("standard");
    expect(classifyInput("—No te acerques más.")).toBe("standard");
    expect(classifyInput("sí, acepto el trato")).toBe("standard");
  });

  it("classifies bare Spanish acknowledgments as trivial", () => {
    expect(classifyInput("sí")).toBe("trivial");
    expect(classifyInput("dale")).toBe("trivial");
    expect(classifyInput("bien")).toBe("trivial");
  });
});
