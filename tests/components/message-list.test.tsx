// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Message } from "@/types";

const renders = vi.fn();
vi.mock("@/components/chat/narrative-renderer", () => ({
  NarrativeRenderer: ({ content }: { content: string }) => {
    renders(content);
    return <p>{content}</p>;
  },
}));

import { MessageList } from "@/components/chat/message-list";

const msg = (id: string, content: string, over: Partial<Message> = {}): Message =>
  ({ id, sessionId: "s1", role: "assistant", content, streamingText: null, isStreaming: false, metadata: null, createdAt: 1, ...over }) as Message;

const loadMore = () => {};

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});
beforeEach(() => {
  renders.mockReset();
});

const countOf = (content: string) => renders.mock.calls.filter(([c]) => c === content).length;

describe("MessageList", () => {
  it("re-renders only the streaming bubble when a token arrives", () => {
    const messages = [msg("m1", "old one"), msg("m2", "old two")];
    const { rerender } = render(
      <MessageList messages={messages} streamingText="a" loadMore={loadMore} isLoadingMore={false} canLoadMore={false} />
    );
    rerender(<MessageList messages={messages} streamingText="ab" loadMore={loadMore} isLoadingMore={false} canLoadMore={false} />);
    expect(countOf("old one")).toBe(1);
    expect(countOf("old two")).toBe(1);
    expect(countOf("ab")).toBe(1);
  });

  it("swaps the streamed text for the saved message without showing it twice or replaying the entry", () => {
    const before = [msg("m1", "old one")];
    const { rerender } = render(
      <MessageList messages={before} streamingText="new turn" loadMore={loadMore} isLoadingMore={false} canLoadMore={false} />
    );
    rerender(
      <MessageList
        messages={[...before, msg("m2", "new turn")]}
        streamingText=""
        settledMessageId="m2"
        loadMore={loadMore}
        isLoadingMore={false}
        canLoadMore={false}
      />
    );
    const shown = screen.getAllByText("new turn");
    expect(shown).toHaveLength(1);
    expect(shown[0].closest(".animate-narrator-slide")).toBeNull();
    expect(screen.getByText("old one").closest(".animate-narrator-slide")).not.toBeNull();
  });

  it("drops the streaming indicator once the turn behind the stand-in text has finished", () => {
    const props = { messages: [msg("m1", "old one")], streamingText: "done text", loadMore, isLoadingMore: false, canLoadMore: false };
    const { rerender } = render(<MessageList {...props} />);
    expect(screen.getByText("The narrator is writing")).toBeInTheDocument();
    rerender(<MessageList {...props} streamingSettled />);
    expect(screen.queryByText("The narrator is writing")).toBeNull();
    expect(screen.getByText("done text")).toBeInTheDocument();
  });

  it("hides the session-start trigger message", () => {
    render(
      <MessageList
        messages={[msg("u1", "[SESSION START — set the opening scene.]", { role: "user" }), msg("a1", "The tale begins")]}
        loadMore={loadMore}
        isLoadingMore={false}
        canLoadMore={false}
      />
    );
    expect(screen.queryByText(/SESSION START/)).toBeNull();
    expect(screen.getByText("The tale begins")).toBeInTheDocument();
  });

  it("hides a user turn flagged metadata.opener even without the prefix", () => {
    render(
      <MessageList
        messages={[msg("u1", "server-built opener text", { role: "user", metadata: { opener: true } }), msg("a1", "The tale begins")]}
        loadMore={loadMore}
        isLoadingMore={false}
        canLoadMore={false}
      />
    );
    expect(screen.queryByText("server-built opener text")).toBeNull();
    expect(screen.getByText("The tale begins")).toBeInTheDocument();
  });

  it("shows the empty state when only hidden messages exist and nothing streams", () => {
    render(
      <MessageList
        messages={[msg("u1", "[SESSION START — set the opening scene.]", { role: "user" })]}
        loadMore={loadMore}
        isLoadingMore={false}
        canLoadMore={false}
        isPreparing
      />
    );
    expect(screen.getByText(/setting the scene/)).toBeInTheDocument();
  });
});
