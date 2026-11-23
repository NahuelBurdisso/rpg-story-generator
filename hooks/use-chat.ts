"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import type { MessageMetadata } from "@/types";

/** The part of a message's metadata the player's input can carry. */
export type SendMetadata = Pick<MessageMetadata, "diceRoll" | "action">;

export interface SendResult {
  ok: boolean;
  /** Text to put back in the input box: the turn left no trace on the server. */
  restoreInput?: string;
  /** The request was aborted client-side (Stop, or the component unmounted). */
  aborted?: boolean;
  /** The abort came from the player pressing Stop (not from leaving the page / a dev remount). */
  stoppedByUser?: boolean;
  /** HTTP status when the server rejected the request before the stream started. */
  status?: number;
  /** The message shown to the player when the turn failed server-side. */
  error?: string;
}

type StreamEvent = { type: string; text?: string; message?: string; restoreInput?: string; messageId?: string };

const requestFrame = (cb: () => void): number =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : window.setTimeout(cb, 16);
const cancelFrame = (id: number): void =>
  typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : window.clearTimeout(id);

export function useChat(campaignId?: string) {
  const [streamingText, setStreamingText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** The latest turn's controller. Unlike abortRef it is not cleared when the turn ends, so a late callback can tell
   *  whether a newer turn has started since. */
  const turnRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  /** The id of the message the last finished turn saved; the streamed text stands in for it until it is listed. */
  const [committedMessageId, setCommittedMessageId] = useState<string | null>(null);
  const bufferRef = useRef("");
  const frameRef = useRef<number | null>(null);
  const utils = trpc.useUtils();

  /** Replaces the streamed text now (drops a pending frame). */
  const setText = useCallback((text: string) => {
    bufferRef.current = text;
    if (frameRef.current !== null) {
      cancelFrame(frameRef.current);
      frameRef.current = null;
    }
    setStreamingText(text);
  }, []);

  /** Appends a token; React sees at most one update per animation frame. */
  const appendText = useCallback((delta: string) => {
    bufferRef.current += delta;
    if (frameRef.current === null) {
      frameRef.current = requestFrame(() => {
        frameRef.current = null;
        setStreamingText(bufferRef.current);
      });
    }
  }, []);

  // Leaving the page cancels the turn in flight and any pending frame.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (frameRef.current !== null) {
        cancelFrame(frameRef.current);
        frameRef.current = null;
      }
    },
    []
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }, []);

  /** Runs one turn: `body` is what the stream route receives, `draft` what goes back to the input if nothing was saved. */
  const runTurn = useCallback(
    async (sessionId: string, body: object, draft: string): Promise<SendResult> => {
      const controller = new AbortController();
      abortRef.current = controller;
      turnRef.current = controller;
      stoppedRef.current = false;
      setIsSending(true);
      setText("");
      setCommittedMessageId(null);
      setError(null);

      let result: SendResult = { ok: false };
      // Set once the server says the turn ended (done or error); a stream that closes without it was cut off.
      let finished = false;

      const handleEvent = (event: StreamEvent) => {
        if (event.type === "token") {
          appendText(event.text ?? "");
        } else if (event.type === "reset") {
          setText("");
        } else if (event.type === "done") {
          finished = true;
          result = { ok: true };
          // Flush and keep the text: the container hides it once the saved message is in the list (same render).
          setText(event.text ?? bufferRef.current); // the server's cleaned final text, not the raw tokens
          setCommittedMessageId(event.messageId ?? null);
          const refreshed = utils.messages.listBySession.invalidate({ sessionId });
          if (campaignId) void utils.characters.listByCampaign.invalidate({ campaignId });
          // The turn lock was released: a refocus refetch mid-turn may have cached processingStartedAt as set.
          void utils.sessions.get.invalidate({ id: sessionId });
          // An older server sends no id: fall back to clearing the text once the refetch landed.
          // Only if no newer turn started meanwhile: it would wipe that turn's streamed text.
          if (!event.messageId) {
            void Promise.resolve(refreshed).then(() => {
              if (turnRef.current === controller) setText("");
            });
          }
        } else if (event.type === "error") {
          finished = true;
          result = { ok: false, restoreInput: event.restoreInput, error: event.message };
          setText("");
          setError(event.message ?? "Failed to send message");
          // Cache refreshes are fire-and-forget: a failed refetch is reported by the query itself.
          void utils.sessions.get.invalidate({ id: sessionId });
          void utils.messages.listBySession.invalidate({ sessionId });
        }
      };

      /** Handle one SSE frame (the text between blank lines); `data:` may or may not be followed by a space. */
      const handleFrame = (frame: string) => {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          let event;
          try {
            event = JSON.parse(line.replace(/^data: ?/, ""));
          } catch {
            // ignore malformed SSE line
            continue;
          }
          handleEvent(event); // outside the try: a handler bug must not pass as a malformed line
        }
      };

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          // Rejected before the turn started (e.g. 400): nothing was saved, so hand the draft back.
          // Another tab may have changed the session (e.g. a 409 "already started"): refresh what we show.
          void utils.messages.listBySession.invalidate({ sessionId });
          void utils.sessions.get.invalidate({ id: sessionId });
          const errBody = await response.json().catch(() => null);
          const message = typeof errBody?.error === "string" ? errBody.error : `Request failed (${response.status})`;
          result = { ok: false, restoreInput: draft, status: response.status, error: message };
          throw new Error(message);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) handleFrame(frame);
        }

        // Flush the decoder and process any remaining buffered frame
        buffer = (buffer + decoder.decode()).replace(/\r\n/g, "\n");
        if (buffer.trim()) handleFrame(buffer);

        if (!finished) {
          // Closed without done/error: the server may or may not have committed the turn.
          setText("");
          setError("The connection closed before the narrator finished.");
          void utils.messages.listBySession.invalidate({ sessionId });
          void utils.sessions.get.invalidate({ id: sessionId });
        }
      } catch (e: unknown) {
        if (finished) {
          // done/error was already handled: a late abort or network error must not overwrite its result (nor drop
          // the text that stands in for the saved message until the refetch lands).
          return result;
        }
        setText("");
        if (e instanceof DOMException && e.name === "AbortError") {
          // The player stopped the turn (or left): the server dropped it, so hand the text back.
          result = { ok: false, restoreInput: draft, aborted: true, stoppedByUser: stoppedRef.current };
          // A Stop that lands after the server committed the turn must not hide the saved turn.
          void utils.messages.listBySession.invalidate({ sessionId });
          void utils.sessions.get.invalidate({ id: sessionId });
        } else {
          setError(e instanceof Error ? e.message : "Failed to send message");
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsSending(false);
      }
      return result;
    },
    [utils, campaignId, setText, appendText]
  );

  const sendMessage = useCallback(
    (sessionId: string, content: string, metadata?: SendMetadata): Promise<SendResult> =>
      runTurn(sessionId, { sessionId, message: content, metadata }, content),
    [runTurn]
  );

  /** Starts a brand-new session: the server builds and stores the hidden opening turn. */
  const sendOpener = useCallback(
    (sessionId: string): Promise<SendResult> => runTurn(sessionId, { sessionId, opener: true }, ""),
    [runTurn]
  );

  const clearError = useCallback(() => setError(null), []);

  return { sendMessage, sendOpener, stop, streamingText, committedMessageId, isSending, error, clearError };
}
