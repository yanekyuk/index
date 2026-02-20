'use client';

interface ThinkingStep {
  content: string;
  step?: string;
  timestamp: Date;
}

interface ThinkingDropdownProps {
  thinking: ThinkingStep[];
  isStreaming?: boolean;
}

export default function ThinkingDropdown({ thinking, isStreaming }: ThinkingDropdownProps) {
  if (!thinking || thinking.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 border-l-2 border-gray-300 pl-3 space-y-2">
      {thinking.map((step, index) => {
        const stepName = step.step?.replace(/_/g, ' ') ?? null;
        const isCompleted =
          step.step?.toLowerCase() === 'completed' ||
          step.step?.toLowerCase().startsWith('completed');

        return (
          <div key={index} className="flex items-start gap-2">
            <span className="mt-[6px] flex-shrink-0 w-1.5 h-1.5 rounded-full bg-gray-400" />
            <div>
              {isCompleted ? (
                <p className="text-sm text-gray-500">
                  <span className="font-medium text-gray-600">Completed:</span>{' '}
                  {step.content}
                </p>
              ) : (
                <>
                  {stepName && (
                    <p className="text-sm font-medium text-gray-500 capitalize">
                      {stepName}
                    </p>
                  )}
                  <p className="text-sm text-gray-500">{step.content}</p>
                </>
              )}
            </div>
          </div>
        );
      })}
      {isStreaming && (
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
          <span className="text-sm text-gray-400">Thinking…</span>
        </div>
      )}
    </div>
  );
}
