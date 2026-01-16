import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code, LayoutTemplate } from 'lucide-react';
import { json2md } from '../../../../lib/json2md/json2md';

/** 
 * Available operations for GeneralInput:
 * - 'json2md': Enables JSON→Markdown conversion (implies markdown mode + preview)
 * - 'select': Enables dropdown selection from provided options
 */
export type InputOperation = 'json2md' | 'select';

/** Option item for select operation */
export interface SelectOption {
  label: string;
  value: string;
}

interface GeneralInputProps {
  // Data
  value: string;
  onChange: (val: string) => void;
  previewValue?: string;

  // Display
  label?: string;
  badge?: string;

  // Operations
  operations?: InputOperation[];
  selectOptions?: SelectOption[];
  onSelectChange?: (value: string) => void;

  // View Mode
  viewMode?: 'edit' | 'preview';
  onViewModeChange?: (mode: 'edit' | 'preview') => void;

  // Custom Controls
  headerControls?: React.ReactNode;
  footerActions?: React.ReactNode;

  // Content Overrides
  children?: React.ReactNode;
}

export const GeneralInput: React.FC<GeneralInputProps> = ({
  value,
  onChange,
  previewValue,
  label = 'INPUT_BUFFER',
  badge,
  operations = [],
  selectOptions = [],
  onSelectChange,
  viewMode = 'edit',
  onViewModeChange,
  headerControls,
  footerActions,
  children
}) => {
  const hasJson2Md = operations.includes('json2md');
  const hasSelect = operations.includes('select');
  const allowPreview = hasJson2Md;

  const [internalViewMode, setInternalViewMode] = React.useState<'edit' | 'preview'>(viewMode);
  const isControlled = !!onViewModeChange;
  const currentViewMode = isControlled ? viewMode : internalViewMode;

  const handleModeChange = (mode: 'edit' | 'preview') => {
    isControlled ? onViewModeChange?.(mode) : setInternalViewMode(mode);
  };

  const getExtensions = () => {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return [json()];
    return hasJson2Md ? [markdown()] : [];
  };

  const handleJson2Md = () => {
    try {
      let obj;
      try {
        obj = JSON.parse(value);
      } catch (e) {
        try { obj = new Function('return ' + value)(); } catch { throw e; }
      }
      onChange(json2md.toMarkdown(obj).trim());
    } catch (e: unknown) {
      console.error("Failed to convert JSON to MD", e);
      alert(`Failed to convert: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const renderContent = () => {
    if (currentViewMode === 'preview' && allowPreview) {
      return (
        <div className="markdown-preview" style={{
          color: '#d4d4d4', fontFamily: "'JetBrains Mono', monospace",
          fontSize: '14px', lineHeight: '1.6', padding: '16px', height: '100%', overflow: 'auto'
        }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewValue || value}</ReactMarkdown>
        </div>
      );
    }
    if (children) return children;
    return (
      <CodeMirror
        value={value}
        height="100%"
        theme={vscodeDark}
        extensions={getExtensions()}
        onChange={onChange}
        style={{ fontSize: '14px', height: '100%', fontFamily: "'JetBrains Mono', monospace" }}
      />
    );
  };

  return (
    <div className="panel input-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* HEADER */}
      <div className="panel-header">
        <div className="title-group">
          <span className="panel-label">{label}</span>
          {badge && <span className="badge">{badge}</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {allowPreview && (
            <div className="mode-toggle">
              <button className={`mode-btn ${currentViewMode === 'edit' ? 'active' : ''}`} onClick={() => handleModeChange('edit')}>
                <Code size={14} /> Write
              </button>
              <button className={`mode-btn ${currentViewMode === 'preview' ? 'active' : ''}`} onClick={() => handleModeChange('preview')}>
                <LayoutTemplate size={14} /> Preview
              </button>
            </div>
          )}
          {headerControls}
        </div>
      </div>

      {/* CONTENT */}
      <div className="input-content" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ height: '100%', width: '100%', backgroundColor: 'var(--term-bg)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {renderContent()}
        </div>
      </div>

      {/* FOOTER */}
      <div className="actions-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="left-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {hasJson2Md && currentViewMode === 'edit' && (
            <button
              className="action-btn"
              onClick={handleJson2Md}
              style={{
                background: 'transparent', border: '1px solid #00ffff', color: '#00ffff',
                cursor: 'pointer', fontSize: '0.75rem', padding: '6px 12px', borderRadius: '4px'
              }}
              title="Convert JSON to Markdown"
            >
              JSON → MD
            </button>
          )}
          {hasSelect && selectOptions.length > 0 && (
            <select
              style={{ background: '#333', color: '#fff', border: '1px solid #555', padding: '4px 8px', fontSize: '0.75rem', borderRadius: '4px' }}
              onChange={(e) => onSelectChange?.(e.target.value)}
              defaultValue=""
            >
              <option value="">Select...</option>
              {selectOptions.map((opt, idx) => (
                <option key={idx} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
        </div>
        <div className="right-actions">{footerActions}</div>
      </div>
    </div>
  );
};
