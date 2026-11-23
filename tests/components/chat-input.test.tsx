// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatInput } from "../../components/chat/chat-input";
import { MAX_MESSAGE_LENGTH } from "../../lib/constants";

describe("ChatInput", () => {
  it("caps the textarea at the length the server accepts", () => {
    render(<ChatInput onSend={() => {}} />);
    expect(screen.getByLabelText("Message input")).toHaveAttribute("maxlength", String(MAX_MESSAGE_LENGTH));
    expect(MAX_MESSAGE_LENGTH).toBe(8000);
  });
});
