'use client';

import { MentionsInput as ReactMentionsInput, Mention, SuggestionDataItem } from 'react-mentions';
import { useMentionableUsers, MentionableUser } from '@/hooks/useMentionableUsers';
import Image from 'next/image';
import { getAvatarUrl } from '@/lib/file-utils';

interface MentionsInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputRef?: React.RefObject<any>;
}

// Custom styles for react-mentions to match existing design
const mentionsInputStyle = {
  control: {
    backgroundColor: 'transparent',
    fontSize: 14,
    fontWeight: 'normal',
  },
  '&singleLine': {
    display: 'inline-block',
    width: '100%',
    highlighter: {
      padding: 0,
      border: 'none',
    },
    input: {
      padding: 0,
      border: 'none',
      outline: 'none',
      backgroundColor: 'transparent',
      color: '#000000',
    },
  },
  suggestions: {
    list: {
      backgroundColor: 'white',
      border: '1px solid #E9E9E9',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
      maxHeight: '200px',
      overflowY: 'auto' as const,
      position: 'absolute' as const,
      top: '100%',
      marginTop: '8px',
      zIndex: 100,
    },
    item: {
      padding: '8px 12px',
      cursor: 'pointer',
      '&focused': {
        backgroundColor: '#F5F5F5',
      },
    },
  },
};

// Style for highlighted mentions in the input
// Note: react-mentions overlays a highlighter on the input, the background shows through
const mentionStyle = {
  backgroundColor: '#EFE4F5',
};

function renderSuggestion(
  suggestion: SuggestionDataItem,
  _search: string,
  _highlightedDisplay: React.ReactNode,
  _index: number,
  focused: boolean
): React.ReactNode {
  const user = suggestion as MentionableUser & SuggestionDataItem;
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${
        focused ? 'bg-gray-100' : 'bg-white'
      }`}
    >
      <div className="w-6 h-6 rounded-full overflow-hidden bg-gray-300 flex-shrink-0">
        <Image
          src={getAvatarUrl({ avatar: user.avatar, name: user.display })}
          alt=""
          width={24}
          height={24}
          className="w-full h-full object-cover"
        />
      </div>
      <span className="text-sm text-gray-900 truncate">{user.display}</span>
    </div>
  );
}

export function MentionsTextInput({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  onKeyDown,
  inputRef,
}: MentionsInputProps) {
  const { searchUsers } = useMentionableUsers({ enabled: true });

  return (
    <ReactMentionsInput
      value={value}
      onChange={(e, newValue) => onChange(newValue)}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      style={mentionsInputStyle}
      singleLine
      a11ySuggestionsListLabel="Suggested users"
      className="flex-1"
      inputRef={inputRef}
    >
      <Mention
        trigger="@"
        data={searchUsers}
        markup="@[__display__](__id__)"
        style={mentionStyle}
        displayTransform={(_id: string, display: string) => `@${display}`}
        renderSuggestion={renderSuggestion}
        appendSpaceOnAdd
      />
    </ReactMentionsInput>
  );
}

export default MentionsTextInput;
