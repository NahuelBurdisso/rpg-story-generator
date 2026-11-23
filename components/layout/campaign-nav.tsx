"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CampaignNavProps {
  campaignId: string;
  campaignName: string;
  currentSection?: string;
}

export function CampaignNav({
  campaignId,
  campaignName,
  currentSection,
}: CampaignNavProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="border-b border-border/40 bg-background"
    >
      <div className="max-w-6xl mx-auto px-4 py-2.5">
        <ol className="flex items-center gap-1 text-sm text-muted-foreground">
          <li>
            <Link
              href="/dashboard"
              className="hover:text-foreground transition-colors"
            >
              Dashboard
            </Link>
          </li>
          <li>
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li>
            {currentSection ? (
              <Link
                href={`/campaigns/${campaignId}`}
                className="hover:text-foreground transition-colors"
              >
                {campaignName}
              </Link>
            ) : (
              <span className={cn("text-foreground font-medium")}>
                {campaignName}
              </span>
            )}
          </li>
          {currentSection && (
            <>
              <li>
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
              <li>
                <span className="text-foreground font-medium">
                  {currentSection}
                </span>
              </li>
            </>
          )}
        </ol>
      </div>
    </nav>
  );
}
