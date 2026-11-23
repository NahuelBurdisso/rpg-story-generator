// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StringListEditor } from "../../components/ui/string-list-editor";

function setup(props: Partial<React.ComponentProps<typeof StringListEditor>> = {}) {
  const onChange = vi.fn();
  render(<StringListEditor items={["Sword"]} onChange={onChange} placeholder="Add item..." {...props} />);
  return { onChange, input: screen.getByPlaceholderText("Add item...") as HTMLInputElement };
}

describe("StringListEditor", () => {
  it("adds a trimmed item on Enter and clears the draft", () => {
    const { onChange, input } = setup();
    fireEvent.change(input, { target: { value: "  Shield  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Sword", "Shield"]);
    expect(input.value).toBe("");
  });

  it("adds from the Add button, which stays disabled while the draft is blank", () => {
    const { onChange, input } = setup();
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    fireEvent.change(input, { target: { value: "Torch" } });
    fireEvent.click(add);
    expect(onChange).toHaveBeenCalledWith(["Sword", "Torch"]);
  });

  it("rejects a duplicate unless allowDuplicates is set", () => {
    const first = setup();
    fireEvent.change(first.input, { target: { value: "Sword" } });
    fireEvent.keyDown(first.input, { key: "Enter" });
    expect(first.onChange).not.toHaveBeenCalled();
  });

  it("accepts a duplicate with allowDuplicates", () => {
    const { onChange, input } = setup({ allowDuplicates: true });
    fireEvent.change(input, { target: { value: "Sword" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Sword", "Sword"]);
  });

  it("remove calls onChange without that item", () => {
    const { onChange } = setup({ items: ["Sword", "Shield", "Torch"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove Shield" }));
    expect(onChange).toHaveBeenCalledWith(["Sword", "Torch"]);
  });
});
