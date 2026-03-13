import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";

import { useIndexes } from "@/contexts/APIContext";
import { useIndexesState } from "@/contexts/IndexesContext";

import IndexAvatar from "@/components/IndexAvatar";
import { Button } from "@/components/ui/button";
import type { Index } from "@/lib/types";

interface NetworksPanelProps {
  onJoin: (networkId: string, networkTitle: string) => void;
  pendingJoinIds?: Set<string>;
}

/**
 * Inline network join panel rendered by the agent's networks_panel block.
 * Shows already-joined networks with a badge and public networks with a Join button.
 * Works in any chat context — onboarding or regular chat.
 */
export default function NetworksPanel({ onJoin, pendingJoinIds = new Set() }: NetworksPanelProps) {
  const indexesService = useIndexes();
  const { indexes: joinedIndexes } = useIndexesState();

  const [publicNetworks, setPublicNetworks] = useState<(Index & { isMember?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    indexesService
      .discoverPublicIndexes(1, 50)
      .then((res) => setPublicNetworks(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [indexesService]);

  const joinedIds = new Set(joinedIndexes.filter((i) => !i.isPersonal).map((i) => i.id));
  const joined = publicNetworks.filter((n) => joinedIds.has(n.id));
  const joinable = publicNetworks.filter((n) => !joinedIds.has(n.id));

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  if (publicNetworks.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-4">No public networks available</p>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-[#E8E8E8] bg-[#FAFAFA] overflow-hidden">
      {joined.length > 0 && (
        <div>
          <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-400 font-medium">
            Joined
          </p>
          <div className="divide-y divide-gray-100">
            {joined.map((network) => (
              <div key={network.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-9 h-9 rounded-full overflow-hidden shrink-0">
                  <IndexAvatar
                    id={network.id}
                    title={network.title}
                    imageUrl={network.imageUrl}
                    size={36}
                    rounded="full"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-black truncate">{network.title}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                    <Users className="w-3 h-3" />
                    {network._count?.members ?? 0} members
                  </p>
                </div>
                <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-sm font-medium shrink-0">
                  Joined
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {joinable.length > 0 && (
        <div>
          {joined.length > 0 && <div className="border-t border-gray-100" />}
          <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-400 font-medium">
            Discover
          </p>
          <div className="divide-y divide-gray-100">
            {joinable.map((network) => {
              const isPending = pendingJoinIds.has(network.id);
              return (
                <div key={network.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-9 h-9 rounded-full overflow-hidden shrink-0">
                    <IndexAvatar
                      id={network.id}
                      title={network.title}
                      imageUrl={network.imageUrl}
                      size={36}
                      rounded="full"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-black truncate">{network.title}</p>
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                      <Users className="w-3 h-3" />
                      {network._count?.members ?? 0} members
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onJoin(network.id, network.title)}
                    disabled={isPending}
                    className="text-xs h-7 shrink-0"
                  >
                    {isPending ? "Joining…" : "Join"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
