"use client";

import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/layout/page-container";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CampaignHeader } from "@/components/campaigns/detail/campaign-header";
import { CharactersSection } from "@/components/campaigns/detail/characters-section";
import { SessionsSection } from "@/components/campaigns/detail/sessions-section";
import { JournalSection } from "@/components/campaigns/detail/journal-section";

export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);
  const router = useRouter();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // A ref, not isPending: two clicks in the same tick both see isPending=false.
  const creatingRef = useRef(false);

  const { data: campaign, isLoading: campaignLoading } = trpc.campaigns.get.useQuery({ id: campaignId });
  const { data: characters, isLoading: charactersLoading } = trpc.characters.listByCampaign.useQuery({ campaignId });
  const { data: sessions, isLoading: sessionsLoading } = trpc.sessions.listByCampaign.useQuery({ campaignId });

  const utils = trpc.useUtils();
  // Not invalidating campaigns.get on delete: the layout still mounted would refetch it and flash "not found" before navigating.
  const removeCampaign = trpc.campaigns.delete.useMutation({
    onSuccess: () => utils.campaigns.list.invalidate(),
  });
  const createSession = trpc.sessions.create.useMutation({
    onSuccess: () => utils.sessions.listByCampaign.invalidate({ campaignId }),
  });

  if (campaignLoading || !campaign) {
    return (
      <PageContainer>
        <div className="space-y-4">
          <div className="h-8 w-64 bg-muted animate-pulse rounded" />
          <div className="h-4 w-96 bg-muted animate-pulse rounded" />
          <div className="h-48 bg-muted animate-pulse rounded" />
        </div>
      </PageContainer>
    );
  }

  async function handleDelete() {
    try {
      await removeCampaign.mutateAsync({ id: campaignId });
      router.push("/dashboard");
    } catch {
      // Close the dialog; removeCampaign.error is rendered in the banner below the header.
      setShowDeleteConfirm(false);
    }
  }

  async function handleNewSession() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const session = await createSession.mutateAsync({ campaignId, title: `Session ${(sessions?.length ?? 0) + 1}` });
      router.push(`/campaigns/${campaignId}/sessions/${session.id}`);
    } catch {
      // createSession.error is rendered under the Sessions header
      creatingRef.current = false;
    }
  }

  return (
    <PageContainer>
      <CampaignHeader campaign={campaign} onDelete={() => setShowDeleteConfirm(true)} />

      {removeCampaign.error && (
        <p role="alert" className="mb-6 text-sm text-destructive">
          Could not delete the campaign: {removeCampaign.error.message}
        </p>
      )}

      {/* World Description */}
      {campaign.worldDescription && (
        <div className="mb-8 p-4 border border-border/40 rounded-md bg-card/50">
          <p className="text-sm text-muted-foreground prose-narrator leading-relaxed">
            {campaign.worldDescription}
          </p>
        </div>
      )}

      {/* Two-column: Characters and Sessions */}
      <div className="grid md:grid-cols-[1fr_1.2fr] gap-8">
        <CharactersSection campaignId={campaignId} characters={characters} isLoading={charactersLoading} />
        <SessionsSection
          campaignId={campaignId}
          sessions={sessions}
          isLoading={sessionsLoading}
          onNewSession={handleNewSession}
          isCreating={createSession.isPending}
          createError={createSession.error?.message}
        />
      </div>

      <JournalSection journal={campaign.campaignJournal} />

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Campaign"
        description={
          <>
            This will permanently delete &ldquo;{campaign.name}&rdquo; and all its characters, sessions, and messages.
            This action cannot be undone.
          </>
        }
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        pending={removeCampaign.isPending || removeCampaign.isSuccess}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </PageContainer>
  );
}
