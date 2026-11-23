import { z } from "zod";
import { runPipeline } from "@/server/pipeline/orchestrator";
import { clientMessageMetadataSchema } from "@/server/db/jsonSchemas";
import { db } from "@/server/db";
import { prepareOpener } from "@/server/pipeline/sessionOpener";
import { MAX_MESSAGE_LENGTH } from "@/lib/constants";
import type { MessageMetadata } from "@/types";

// Only what the player's input can carry (dice roll, action): `mechanics` and
// `imageId` are written server-side and are stripped from client metadata.
const sessionIdSchema = z
  .string({ required_error: "sessionId is required", invalid_type_error: "sessionId is required" })
  .min(1, "sessionId is required");

const bodySchema = z.object({
  sessionId: sessionIdSchema,
  message: z
    .string({ required_error: "message is required", invalid_type_error: "message is required" })
    .min(1, "message is required")
    .max(MAX_MESSAGE_LENGTH, `message is too long (max ${MAX_MESSAGE_LENGTH} characters)`),
  metadata: clientMessageMetadataSchema.nullish(),
});

// `{ sessionId, opener: true }`: the server writes the hidden first turn of a session.
const openerBodySchema = z.object({ sessionId: sessionIdSchema, opener: z.literal(true) });

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const badRequest = (error: string): Response => jsonError(error, 400);

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return badRequest("Invalid JSON body");

  let sessionId: string;
  let message: string;
  let metadata: MessageMetadata | undefined;
  if ((raw as { opener?: unknown }).opener === true) {
    const parsedOpener = openerBodySchema.safeParse(raw);
    if (!parsedOpener.success) return badRequest(parsedOpener.error.issues[0].message);
    sessionId = parsedOpener.data.sessionId;
    const prepared = prepareOpener(db, sessionId);
    if (!prepared.ok) return jsonError(prepared.error, prepared.status);
    message = prepared.message;
    metadata = { opener: true };
  } else {
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return badRequest(issue.path[0] === "metadata" ? "metadata is invalid" : issue.message);
    }
    sessionId = parsed.data.sessionId;
    message = parsed.data.message;
    metadata = parsed.data.metadata ?? undefined;
  }

  // A client that closes the tab (or presses Stop) cancels the turn in flight.
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream already closed by the client
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      };
      try {
        await runPipeline({
          sessionId,
          message,
          metadata,
          signal: abort.signal,
          onToken: (token) => send({ type: "token", text: token }),
          onReset: () => send({ type: "reset" }),
          onComplete: (finalText, messageId) => {
            send({ type: "done", text: finalText, messageId });
            close();
          },
          onError: (error, details) => {
            send({ type: "error", message: error, restoreInput: details?.restoreInput });
            close();
          },
        });
      } catch (err: unknown) {
        send({ type: "error", message: err instanceof Error ? err.message : "Pipeline failed" });
      } finally {
        // An aborted turn returns without onComplete/onError.
        close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
