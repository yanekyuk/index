import { ISODateString, UUID } from './common.types';
import { UserSummary } from './users.types';
import { FileRecord } from './files.types';

export type IndexJoinPolicy = 'anyone' | 'invite_only';

export interface IndexPermissions {
  joinPolicy: IndexJoinPolicy;
  allowGuestVibeCheck?: boolean;
  invitationLink?: {
    code: string;
  } | null;
}

export interface IndexMember {
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

export interface Index {
  id: UUID;
  title: string;
  prompt?: string | null;
  imageUrl?: string | null;
  permissions?: IndexPermissions | null;
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
  members?: IndexMember[];
  isMember?: boolean; // Computed field for discovery
}

export interface CreateIndexRequest {
  title: string;
  prompt?: string;
  imageUrl?: string | null;
  joinPolicy?: IndexJoinPolicy;
}

export interface UpdateIndexRequest {
  title?: string;
  prompt?: string | null;
  imageUrl?: string | null;
  permissions?: {
    joinPolicy?: IndexJoinPolicy;
    allowGuestVibeCheck?: boolean;
  };
}

export interface IndexSummary<TIntent = unknown> {
  totalIntents: number;
  exampleIntents: TIntent[];
  members: UserSummary[];
}
