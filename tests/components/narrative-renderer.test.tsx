// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NarrativeRenderer } from "../../components/chat/narrative-renderer";

describe("NarrativeRenderer", () => {
  it("renders plain text without markers as markdown", () => {
    render(<NarrativeRenderer content="The warrior advances." />);
    expect(screen.getByText("The warrior advances.")).toBeInTheDocument();
  });

  it("a stored message hides markers and STATE_UPDATE blocks", () => {
    render(
      <NarrativeRenderer
        content={'The door opens. [MECHANIC:damage:2d6]\n\n<!-- STATE_UPDATE {"characters":{}} STATE_UPDATE -->'}
      />
    );
    expect(screen.getByText(/The door opens\./)).toBeInTheDocument();
    expect(screen.queryByText(/STATE_UPDATE/)).toBeNull();
    expect(screen.queryByText(/MECHANIC/)).toBeNull();
  });

  it("a cut-off marker never shows while streaming", () => {
    render(<NarrativeRenderer content="You swing [MECHAN" isStreaming />);
    expect(screen.queryByText(/MECHAN/)).toBeNull();
    expect(screen.getByText(/You swing/)).toBeInTheDocument();
  });
});
