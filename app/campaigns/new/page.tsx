"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/layout/page-container";
import { AppHeader } from "@/components/layout/app-header";
import { CampaignForm, type CampaignFormData } from "@/components/campaigns/campaign-form";
import { toCampaignInput } from "@/lib/campaign-input";

export default function NewCampaignPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const createCampaign = trpc.campaigns.create.useMutation({
    onSuccess: () => utils.campaigns.list.invalidate(),
  });

  async function handleSubmit(data: CampaignFormData) {
    const created = await createCampaign.mutateAsync(toCampaignInput(data));
    router.push(`/campaigns/${created.id}`);
  }

  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="flex-1">
        <PageContainer className="max-w-3xl">
          <h1 className="text-xl font-bold tracking-tight mb-6">
            Create Campaign
          </h1>
          <CampaignForm onSubmit={handleSubmit} error={createCampaign.error?.message} />
        </PageContainer>
      </main>
    </div>
  );
}
