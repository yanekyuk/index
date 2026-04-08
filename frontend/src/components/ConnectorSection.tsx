import { useState, useEffect, useCallback } from "react";
import { useOpportunities } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import OpportunityCard, {
  OpportunitySkeleton,
  type OpportunityCardData,
} from "@/components/chat/OpportunityCardInChat";
import type { HomeViewCardItem } from "@/services/opportunities";

interface ConnectorSectionProps {
  profileUserId: string;
  profileFirstName: string;
}

export default function ConnectorSection({
  profileUserId,
  profileFirstName,
}: ConnectorSectionProps) {
  const opportunitiesService = useOpportunities();
  const { error: showError, success: showSuccess } = useNotifications();
  const [connectorCards, setConnectorCards] = useState<HomeViewCardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [actionStatus, setActionStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const fetchConnectorOpportunities = async () => {
      try {
        setIsLoading(true);
        const data = await opportunitiesService.getHomeView();
        if (cancelled) return;
        const introducerCards = data.sections
          .flatMap((s) => s.items)
          .filter(
            (item) =>
              item.viewerRole === "introducer" &&
              (item.userId === profileUserId ||
                item.secondParty?.userId === profileUserId)
          );
        setConnectorCards(introducerCards);
      } catch {
        if (!cancelled) setConnectorCards([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchConnectorOpportunities();
    return () => {
      cancelled = true;
    };
  }, [opportunitiesService, profileUserId]);

  const handleAction = useCallback(
    async (
      opportunityId: string,
      action: "accepted" | "rejected",
      _userId?: string,
      viewerRole?: string,
      counterpartName?: string,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _isGhost?: boolean,
    ) => {
      const isIntroducer = viewerRole === "introducer";
      setActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
      try {
        const effectiveStatus =
          isIntroducer && action === "accepted" ? "pending" : action;
        await opportunitiesService.updateStatus(opportunityId, effectiveStatus);
        setActionStatus((prev) => ({
          ...prev,
          [opportunityId]: effectiveStatus,
        }));

        if (action === "accepted" && isIntroducer) {
          showSuccess(
            "Introduction sent",
            `${counterpartName || "They"} will be notified and can accept to start the conversation.`,
          );
        }

        setConnectorCards((prev) =>
          prev.filter((c) => c.opportunityId !== opportunityId)
        );
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Failed to update opportunity"
        );
      } finally {
        setActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
      }
    },
    [opportunitiesService, showError, showSuccess]
  );

  if (isLoading) {
    return (
      <div>
        <h3 className="text-base font-bold text-gray-900 font-ibm-plex-mono mb-0.5">
          You&apos;re the connector
        </h3>
        <p className="text-xs text-gray-400 mb-3">
          Intros you could make with {profileFirstName}
        </p>
        <div className="space-y-2">
          <OpportunitySkeleton />
          <OpportunitySkeleton />
        </div>
      </div>
    );
  }

  if (connectorCards.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="text-base font-bold text-gray-900 font-ibm-plex-mono mb-0.5">
        You&apos;re the connector
      </h3>
      <p className="text-xs text-gray-400 mb-3">
        Intros you could make with {profileFirstName}
      </p>
      <div className="space-y-2">
        {connectorCards.map((card) => (
          <OpportunityCard
            key={card.opportunityId}
            card={card as OpportunityCardData}
            onPrimaryAction={handleAction}
            onSecondaryAction={handleAction}
            isLoading={actionLoading[card.opportunityId]}
            currentStatus={
              actionStatus[card.opportunityId] ?? card.status
            }
          />
        ))}
      </div>
    </div>
  );
}