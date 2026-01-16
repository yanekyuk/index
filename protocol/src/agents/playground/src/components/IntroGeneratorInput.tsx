import React from 'react';
import { GeneralInput } from './GeneralInput';

interface IntroGeneratorInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

/**
 * Safely parse JSON, returning empty object on failure.
 */
const safeParse = (str: string) => {
  try { return JSON.parse(str); } catch { return {}; }
};

/**
 * IntroGeneratorInput Component
 *
 * Provides structured input for the IntroGenerator agent with:
 * - Sender (Source) section: name + reasonings
 * - Recipient (Target) section: name + reasonings
 *
 * Clicking users in Context_Memory fills sender first, then recipient.
 * The format matches IntroGeneratorInput schema: { sender: { name, reasonings[] }, recipient: { name, reasonings[] } }
 */
export const IntroGeneratorInput: React.FC<IntroGeneratorInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {
  if (inputMode === 'raw') {
    return null;
  }

  const parsed = safeParse(inputVal);

  // Extract values from parsed input - use empty defaults if not present
  const senderName = parsed?.sender?.name || '';
  const senderReasonings = Array.isArray(parsed?.sender?.reasonings)
    ? parsed.sender.reasonings.join('\n')
    : '';
  const recipientName = parsed?.recipient?.name || '';
  const recipientReasonings = Array.isArray(parsed?.recipient?.reasonings)
    ? parsed.recipient.reasonings.join('\n')
    : '';



  // View Modes
  const [senderViewMode, setSenderViewMode] = React.useState<'edit' | 'preview'>('edit');
  const [recipientViewMode, setRecipientViewMode] = React.useState<'edit' | 'preview'>('edit');

  /**
   * Builds a displayable JSON string for the sender/recipient sections.
   */
  const formatPersonJson = (name: string, reasonings: string) => {
    return JSON.stringify({
      name: name || '',
      reasonings: reasonings ? reasonings.split('\n').map(r => r.trim()).filter(r => r) : []
    }, null, 2);
  };

  /**
   * Parses JSON back to name + reasonings.
   */
  const parsePersonJson = (jsonStr: string): { name: string; reasonings: string } => {
    try {
      const obj = JSON.parse(jsonStr);
      return {
        name: obj.name || '',
        reasonings: Array.isArray(obj.reasonings) ? obj.reasonings.join('\n') : ''
      };
    } catch {
      return { name: '', reasonings: '' };
    }
  };

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>

      {/* Sender Section */}
      <div style={{ minHeight: '280px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
        <GeneralInput
          value={formatPersonJson(senderName, senderReasonings)}
          onChange={(val) => {
            const { name, reasonings } = parsePersonJson(val);
            const current = safeParse(inputVal);
            current.sender = {
              name,
              reasonings: reasonings.split('\n').map(r => r.trim()).filter(r => r)
            };
            setInputVal(JSON.stringify(current, null, 2));
          }}
          label="SENDER (SOURCE)"
          badge="Source"
          operations={[]}
          viewMode={senderViewMode}
          onViewModeChange={setSenderViewMode}
        />
      </div>

      {/* Recipient Section */}
      <div style={{ minHeight: '280px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={formatPersonJson(recipientName, recipientReasonings)}
          onChange={(val) => {
            const { name, reasonings } = parsePersonJson(val);
            const current = safeParse(inputVal);
            current.recipient = {
              name,
              reasonings: reasonings.split('\n').map(r => r.trim()).filter(r => r)
            };
            setInputVal(JSON.stringify(current, null, 2));
          }}
          label="RECIPIENT (TARGET)"
          badge="Target"
          operations={[]}
          viewMode={recipientViewMode}
          onViewModeChange={setRecipientViewMode}
        />
      </div>

    </div>
  );
};
