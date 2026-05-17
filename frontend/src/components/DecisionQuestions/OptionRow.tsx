import { cn } from '@/lib/utils';

interface OptionRowProps {
  name: string;
  value: string;
  /** "radio" for single-select, "checkbox" for multi-select. */
  type: 'radio' | 'checkbox';
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

export function OptionRow({
  name,
  value,
  type,
  label,
  description,
  checked,
  disabled,
  onChange,
}: OptionRowProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 px-3 py-2 rounded-lg border border-[#E8E8E8] cursor-pointer',
        'hover:bg-[#FAFAFA] transition-colors',
        checked && 'bg-[#FAFAFA] border-[#3D3D3D]',
        disabled && 'opacity-50 cursor-not-allowed hover:bg-transparent',
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 accent-black"
      />
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-gray-900">{label}</span>
        <span className="text-xs text-gray-500">{description}</span>
      </span>
    </label>
  );
}
