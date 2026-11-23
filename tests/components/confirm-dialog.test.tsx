// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";

function setup(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Delete Campaign"
      description="This cannot be undone."
      confirmLabel="Delete"
      pendingLabel="Deleting..."
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog open={false} title="T" description="D" confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onConfirm / onCancel from the buttons", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape", () => {
    const { onCancel } = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("while pending: disables both buttons, ignores Escape and shows the pending label", () => {
    const { onCancel } = setup({ pending: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("names the alertdialog after its title", () => {
    setup();
    expect(screen.getByRole("alertdialog", { name: "Delete Campaign" })).toBeInTheDocument();
  });

  it("does not steal focus when the parent re-renders with a new onCancel", () => {
    const props = { open: true, title: "T", description: "D", confirmLabel: "Delete", onConfirm: () => {} };
    const { rerender } = render(<ConfirmDialog {...props} onCancel={() => {}} />);
    const confirm = screen.getByRole("button", { name: "Delete" });
    confirm.focus();
    rerender(<ConfirmDialog {...props} onCancel={() => {}} />);
    expect(document.activeElement).toBe(confirm);
  });

  it("restores focus to the previously focused element on close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const props = { title: "T", description: "D", confirmLabel: "Delete", onConfirm: () => {}, onCancel: () => {} };
    const { rerender } = render(<ConfirmDialog {...props} open />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    rerender(<ConfirmDialog {...props} open={false} />);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
