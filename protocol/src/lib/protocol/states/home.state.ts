import { Annotation } from '@langchain/langgraph';
import type { Opportunity } from '../interfaces/database.interface';

/**
 * Home view card item: one opportunity with full presenter-driven display contract.
 */
export interface HomeCardItem {
  opportunityId: string;
  userId: string;
  name: string;
  avatar: string | null;
  mainText: string;
  cta: string;
  headline?: string;
  /** Presenter-generated; primary button (accept) and secondary button (dismiss). */
  primaryActionLabel: string;
  secondaryActionLabel: string;
  /** Presenter-generated subtitle under the other party name (e.g. "1 mutual intent"). */
  mutualIntentsLabel: string;
  /** e.g. { name: 'Index', text: '...' } or introducer name + remark; avatar set when narrator is a user */
  narratorChip?: { name: string; text: string; avatar?: string | null };
  /** Viewer's role in this opportunity (e.g. 'introducer', 'party', 'agent', 'patient', 'peer'). */
  viewerRole?: string;
  /** For section assignment from LLM */
  _cardIndex: number;
}

/**
 * Dynamic section from LLM categorization.
 */
export interface HomeSectionProposal {
  id: string;
  title: string;
  subtitle?: string;
  iconName: string;
  itemIndices: number[];
}

/** Card item as returned in API (no internal _cardIndex). */
export type HomeSectionItem = Omit<HomeCardItem, '_cardIndex'>;

/**
 * Final section for API response.
 */
export interface HomeSection {
  id: string;
  title: string;
  subtitle?: string;
  iconName: string;
  items: HomeSectionItem[];
}

/**
 * Home Graph State (Annotation-based).
 * Flow: loadOpportunities → generateCardText → categorizeDynamically → normalizeAndSort → finalizeResponse.
 */
export const HomeGraphState = Annotation.Root({
  userId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => '',
  }),
  indexId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  limit: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 50,
  }),

  /** Raw opportunities visible to the viewer (after visibility filter). */
  opportunities: Annotation<Opportunity[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Cards with presenter output and narrator chip. */
  cards: Annotation<HomeCardItem[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** LLM output: dynamic sections with icon and item indices. */
  sectionProposals: Annotation<HomeSectionProposal[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Final sections for response. */
  sections: Annotation<HomeSection[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Expired or excluded opportunities (optional for future "Show expired" UI). */
  expired: Annotation<Opportunity[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  error: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Meta for response (e.g. totalOpportunities, totalSections). */
  meta: Annotation<{ totalOpportunities: number; totalSections: number }>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ totalOpportunities: 0, totalSections: 0 }),
  }),
});
