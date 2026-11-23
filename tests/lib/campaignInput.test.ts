import { describe, it, expect } from "vitest";
import { toCampaignInput, type CampaignFormData } from "@/lib/campaign-input";

const form: CampaignFormData = {
  name: "Eldara", genre: "fantasy", tone: "serious", difficulty: "normal", worldDescription: "",
  statDefinitions: ["Strength"], quickActions: [], plotHooks: [], imageEnabled: true,
  imageStyle: "dark-ink",
};

describe("toCampaignInput", () => {
  it("carries the form fields through unchanged", () => {
    const input = toCampaignInput(form);
    expect(input.name).toBe("Eldara");
    expect(input.imageStyle).toBe("dark-ink");
    expect(input.imageEnabled).toBe(true);
    expect(input.statDefinitions).toEqual(["Strength"]);
  });
  it("does not touch the stored custom image config", () => {
    expect(toCampaignInput(form)).not.toHaveProperty("customImageConfig");
  });
});
