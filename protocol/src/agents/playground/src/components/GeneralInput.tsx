import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code, LayoutTemplate } from 'lucide-react';
import { json2md } from '../../../../lib/json2md/json2md';

interface GeneralInputProps {
  // Data
  value: string;
  onChange: (val: string) => void;
  previewValue?: string; // Optional override for markdown preview content

  // Display
  label?: string;
  badge?: string;

  // Modes & Features
  viewMode?: 'edit' | 'preview';
  onViewModeChange?: (mode: 'edit' | 'preview') => void;
  allowPreview?: boolean;
  allowJson2Md?: boolean;
  allowMarkdown?: boolean;

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
  viewMode = 'edit',
  onViewModeChange,
  allowPreview = false,
  allowJson2Md = false,
  allowMarkdown = true,
  headerControls,
  footerActions,
  children
}) => {

  const getExtensions = () => {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return [json()];
    }
    return allowMarkdown ? [markdown()] : [];
  };

  const handleJson2Md = () => {
    try {
      const obj = JSON.parse(value);
      let md = "";
      if (obj.identity || !Array.isArray(obj)) {
        // Object with identity (profile) or single object -> use fromObject
        md = json2md.fromObject(obj);
      } else if (obj.length > 0 && typeof obj[0] === 'object') {
        // Array of objects -> use table format
        const keys = Object.keys(obj[0]);
        const columns = keys.map(k => ({ header: k, key: k }));
        md = json2md.table(obj, { columns });
      } else {
        // Array of primitives -> use list
        md = json2md.list(obj.map(String));
      }
      onChange(md.trim());
    } catch (e) {
      console.error("Failed to convert JSON to MD", e);
    }
  };

  /* CONTENT */
  const renderContent = () => {
    if (viewMode === 'preview') {
      return (
        <div className="markdown-preview" style={{
          color: '#d4d4d4',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '14px',
          lineHeight: '1.6',
          padding: '16px',
          height: '100%',
          overflow: 'auto'
        }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {previewValue || value}
          </ReactMarkdown>
        </div>
      );
    }

    if (children) {
      return children;
    }

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
          {allowPreview && onViewModeChange && (
            <div className="mode-toggle">
              <button
                className={`mode-btn ${viewMode === 'edit' ? 'active' : ''}`}
                onClick={() => onViewModeChange('edit')}
              >
                <Code size={14} /> Write
              </button>
              <button
                className={`mode-btn ${viewMode === 'preview' ? 'active' : ''}`}
                onClick={() => onViewModeChange('preview')}
              >
                <LayoutTemplate size={14} /> Preview
              </button>
            </div>
          )}
          {headerControls}
        </div>
      </div>

      {/* CONTENT */}
      <div className="input-content" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{
          height: '100%',
          width: '100%',
          backgroundColor: 'var(--term-bg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {renderContent()}
        </div>
      </div>

      {/* FOOTER actions */}
      <div className="actions-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="left-actions">
          {allowMarkdown && allowJson2Md && viewMode === 'edit' && (
            <button
              className="action-btn"
              onClick={handleJson2Md}
              style={{
                background: 'transparent',
                border: '1px solid #00ffff',
                color: '#00ffff',
                cursor: 'pointer',
                fontSize: '0.75rem',
                padding: '6px 12px',
                borderRadius: '4px',
                marginRight: 'auto'
              }}
              title="Convert JSON to Markdown"
            >
              JSON → MD
            </button>
          )}
        </div>
        <div className="right-actions">
          {footerActions}
        </div>
      </div>
    </div>
  );
};
