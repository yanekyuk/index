import { ISODateString, UUID } from './common.types';
import { UserSummary } from './users.types';
import { FileRecord } from './files.types';

export type NetworkJoinPolicy = 'anyone' | 'invite_only';

export interface NetworkPermissions {
  joinPolicy: NetworkJoinPolicy;
  allowGuestVibeCheck?: boolean;
  invitationLink?: {
    code: string;
  } | null;
}

export interface NetworkMember {
  id: UUID; // This is the userId
  name: string;
  email?: string; // Made optional as protocol doesn't always return it
  avatar: string | null;
  permissions: string[];
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
  prompt?: string | null;
  autoAssign?: boolean;
}

export interface Network {
  id: UUID;
  title: string;
  prompt?: string | null;
  imageUrl?: string | null;
  isPersonal?: boolean;
  permissions?: NetworkPermissions | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString | null;
  user: UserSummary; // Owner
  _count?: {
    files?: number;
    members: number;
    intents?: number;
  };
  files?: FileRecord[];
  members?: NetworkMember[];
  isMember?: boolean; // Computed field for discovery
}

export interface CreateNetworkRequest {
  title: string;
  prompt?: string;
  imageUrl?: string | null;
  joinPolicy?: NetworkJoinPolicy;
}

export interface UpdateNetworkRequest {
  title?: string;
  prompt?: string | null;
  imageUrl?: string | null;
  permissions?: {
    joinPolicy?: NetworkJoinPolicy;
    allowGuestVibeCheck?: boolean;
  };
}

export interface NetworkSummary<TIntent = unknown> {
  totalIntents: number;
  exampleIntents: TIntent[];
  members: UserSummary[];
}
