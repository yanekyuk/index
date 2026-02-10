import type { ChannelData, ChannelResponse, ChannelFilters, PartialUpdateChannel, ChannelMemberResponse } from 'stream-chat';

// Extended types for custom channel fields
export interface CustomChannelData extends ChannelData {
  pending?: boolean;
  requestedBy?: string;
  declined?: boolean;
  skipped?: boolean;
}

export interface CustomChannelResponse extends ChannelResponse {
  pending?: boolean;
  requestedBy?: string;
  declined?: boolean;
  skipped?: boolean;
}

export interface CustomChannelFilters extends ChannelFilters {
  pending?: boolean;
}

export interface CustomPartialUpdateChannel extends Omit<PartialUpdateChannel, 'set' | 'unset'> {
  set?: Partial<CustomChannelResponse>;
  unset?: Array<keyof ChannelResponse | 'requestedBy' | 'pending' | 'declined' | 'skipped'>;
}

// Extended member type with user info
export type CustomChannelMember = ChannelMemberResponse & {
  user_id: string;
};
