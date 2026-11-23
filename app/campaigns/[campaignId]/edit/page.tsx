"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/layout/page-container";
import { CampaignForm, type CampaignFormData } from "@/components/campaigns/campaign-form";
import { toCampaignInput } from "@/lib/campaign-input";

export default function EditCampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);
  const router = useRouter();

  const { data: campaign, isLoading: campaignLoading } = trpc.campaigns.get.useQuery({ id: campaignId });
  const utils = trpc.useUtils();
  const updateCampaign = trpc.campaigns.update.useMutation({
    onSuccess: (updated) => {
      utils.campaigns.get.setData({ id: updated.id }, updated);
      void utils.campaigns.list.invalidate();
    },
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

  async function handleSubmit(data: CampaignFormData) {
    await updateCampaign.mutateAsync({
      id: campaignId,
      ...toCampaignInput(data),
    });
    router.push(`/campaigns/${campaignId}`);
  }

  return (
    <PageContainer className="max-w-3xl">
      <h1 className="text-xl font-bold tracking-tight mb-6">Edit Campaign</h1>
      <CampaignForm
        initialData={{
          name: campaign.name,
          genre: campaign.genre,
          customGenre: campaign.customGenre ?? undefined,
          tone: campaign.tone,
          difficulty: campaign.difficulty,
          worldDescription: campaign.worldDescription,
          customRules: campaign.customRules ?? undefined,
          statDefinitions: campaign.statDefinitions,
          quickActions: campaign.quickActions,
          plotHooks: campaign.plotHooks ?? [],
          imageEnabled: campaign.imageEnabled ?? false,
          imageStyle: campaign.imageStyle ?? undefined,
        }}
        onSubmit={handleSubmit}
        submitLabel="Save Changes"
        error={updateCampaign.error?.message}
      />
    </PageContainer>
  );
}
