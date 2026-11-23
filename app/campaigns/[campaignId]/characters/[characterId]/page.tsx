"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/layout/page-container";
import { CharacterForm } from "@/components/characters/character-form";

import type { CharacterFormData } from "@/components/characters/character-form";

export default function EditCharacterPage({
  params,
}: {
  params: Promise<{ campaignId: string; characterId: string }>;
}) {
  const { campaignId, characterId } = use(params);
  const router = useRouter();

  const { data: campaign, isLoading: campaignLoading } = trpc.campaigns.get.useQuery({ id: campaignId });
  const { data: character, isLoading: characterLoading } = trpc.characters.get.useQuery({ id: characterId });
  const utils = trpc.useUtils();
  const updateCharacter = trpc.characters.update.useMutation({
    onSuccess: (c) => {
      utils.characters.get.setData({ id: c.id }, c);
      void utils.characters.listByCampaign.invalidate({ campaignId });
    },
  });
  const removeCharacter = trpc.characters.delete.useMutation({
    onSuccess: () => utils.characters.listByCampaign.invalidate({ campaignId }),
  });

  if (campaignLoading || characterLoading || !campaign || !character) {
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
    await updateCharacter.mutateAsync({
      id: characterId,
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

  async function handleDelete() {
    await removeCharacter.mutateAsync({ id: characterId });
    router.push(`/campaigns/${campaignId}`);
  }

  return (
    <PageContainer className="max-w-3xl">
      <h1 className="text-xl font-bold tracking-tight mb-6">
        Edit Character
      </h1>
      <CharacterForm
        statDefinitions={campaign.statDefinitions}
        campaignId={campaignId}
        characterId={characterId}
        initialData={{
          name: character.name,
          role: character.role,
          backstory: character.backstory,
          appearance: character.appearance ?? undefined,
          stats: character.stats,
          inventory: character.inventory,
          statusNotes: character.statusNotes ?? undefined,
        }}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
        error={updateCharacter.error?.message ?? removeCharacter.error?.message}
        submitLabel="Save Changes"
      />
    </PageContainer>
  );
}
