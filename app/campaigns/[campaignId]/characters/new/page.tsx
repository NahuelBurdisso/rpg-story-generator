"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/layout/page-container";
import { CharacterForm } from "@/components/characters/character-form";

import type { CharacterFormData } from "@/components/characters/character-form";

export default function NewCharacterPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);
  const router = useRouter();

  const { data: campaign, isLoading: campaignLoading } = trpc.campaigns.get.useQuery({ id: campaignId });
  const utils = trpc.useUtils();
  const createCharacter = trpc.characters.create.useMutation({
    onSuccess: () => utils.characters.listByCampaign.invalidate({ campaignId }),
  });

  if (campaignLoading || !campaign) {
    return (
      <PageContainer className="max-w-3xl">
        <div className="space-y-4">
          <div className="h-8 w-48 bg-muted animate-pulse rounded" />
          <div className="h-64 bg-muted animate-pulse rounded" />
        </div>
      </PageContainer>
    );
  }

  async function handleSubmit(data: CharacterFormData) {
    await createCharacter.mutateAsync({
      campaignId,
      name: data.name,
      role: data.role,
      backstory: data.backstory,
      stats: data.stats,
      inventory: data.inventory,
      appearance: data.appearance,
      statusNotes: data.statusNotes,
    });
    router.push(`/campaigns/${campaignId}`);
  }

  return (
    <PageContainer className="max-w-3xl">
      <h1 className="text-xl font-bold tracking-tight mb-6">
        New Character
      </h1>
      <CharacterForm
        statDefinitions={campaign.statDefinitions}
        campaignId={campaignId}
        onSubmit={handleSubmit}
        error={createCharacter.error?.message}
      />
    </PageContainer>
  );
}
