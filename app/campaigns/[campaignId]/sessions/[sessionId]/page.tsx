"use client";

import { use } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useSessionMessages } from "@/hooks/use-session-messages";
import { ChatContainer } from "@/components/chat/chat-container";

function LoadingSession() {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-7rem)]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-5 w-5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">
          Loading session...
        </span>
      </div>
    </div>
  );
}

function SessionNotFound({ campaignId, notFound, message }: { campaignId: string; notFound: boolean; message: string }) {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-7rem)]">
      <div className="text-center px-4">
        <h2 className="text-lg font-semibold text-zinc-200 mb-2">
          {notFound ? "Session not found" : "Could not load the session"}
        </h2>
        <p className="text-sm text-zinc-500 mb-4">
          {notFound ? "This session may have been deleted or the link is invalid." : message}
        </p>
        <Link href={`/campaigns/${campaignId}`} className="text-sm text-blue-400 hover:text-blue-300 underline">
          Back to the campaign
        </Link>
      </div>
    </div>
  );
}

export default function SessionPage({
  params,
}: {
  params: Promise<{ campaignId: string; sessionId: string }>;
}) {
  const { campaignId, sessionId } = use(params);

  // All four requests start in the same render, so the tRPC batch link sends them together.
  const sessionQ = trpc.sessions.get.useQuery({ id: sessionId });
  const campaignQ = trpc.campaigns.get.useQuery({ id: campaignId });
  const charactersQ = trpc.characters.listByCampaign.useQuery({ campaignId });
  const history = useSessionMessages(sessionId);

  // A failed background refetch keeps the data on screen; only a session that never loaded is an error page.
  if (sessionQ.error && !sessionQ.data) {
    return (
      <SessionNotFound
        campaignId={campaignId}
        notFound={sessionQ.error.data?.code === "NOT_FOUND"}
        message={sessionQ.error.message}
      />
    );
  }
  if (sessionQ.isLoading || campaignQ.isLoading || charactersQ.isLoading || !sessionQ.data || !campaignQ.data) {
    return <LoadingSession />;
  }

  return (
    <ChatContainer
      session={sessionQ.data}
      campaign={campaignQ.data}
      characters={charactersQ.data ?? []}
      history={history}
    />
  );
}
