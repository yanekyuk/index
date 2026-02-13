import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

export interface SystemMessagePresentation {
  headline: string;
  personalizedSummary: string;
  suggestedAction: string;
}

interface SystemMessageCardProps {
  text?: string;
  introType?: string;
  presentation?: SystemMessagePresentation;
}

/**
 * Renders system / Index-bot messages inside the chat view.
 *
 * Three visual variants:
 *  1. Rich presenter card (headline + summary + action) – used for accepted-opportunity intros.
 *  2. Amber "opportunity_update" card – used for injected new-opportunity notifications.
 *  3. Plain markdown fallback – everything else (generic system messages).
 */
export function SystemMessageCard({ text, introType, presentation }: SystemMessageCardProps) {
  const containerClass = cn(
    'max-w-[80%] rounded-xl px-4 py-3 text-sm',
    presentation ? 'bg-gray-100 text-gray-700 text-left shadow-sm' : introType === 'opportunity_update' ? 'bg-amber-50 border border-amber-200 text-amber-900 text-left' : 'bg-gray-100 text-gray-600 text-center',
  );

  return (
    <div className="flex justify-center">
      <div className={containerClass}>
        {presentation ? (
          <div className="space-y-2">
            <p className="font-semibold text-gray-900">{presentation.headline}</p>
            <p className="text-gray-600">{presentation.personalizedSummary}</p>
            <p className="text-gray-500 italic">{presentation.suggestedAction}</p>
            <p className="text-xs text-gray-400 pt-1">via Index</p>
          </div>
        ) : introType === 'opportunity_update' ? (
          <div className="space-y-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || ''}</ReactMarkdown>
            <p className="text-xs text-amber-600 pt-1">New opportunity</p>
          </div>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || ''}</ReactMarkdown>
        )}
      </div>
    </div>
  );
}
