// ACP Tool Bubble Component
// This component renders tool bubbles for ACP tool type (90)
// Injected into Cursor's rendering pipeline

(function() {
  'use strict';

  // Create ACP Tool Bubble renderer
  window.acpToolBubbleRenderer = {
    // Render an ACP tool bubble
    render: function(container, toolData) {
      const status = toolData.status || 'loading';
      const toolName = toolData.name || toolData.additionalData?.acpToolName || 'ACP Tool';
      const params = toolData.params ? (typeof toolData.params === 'string' ? JSON.parse(toolData.params) : toolData.params) : {};
      const result = toolData.result ? (typeof toolData.result === 'string' ? JSON.parse(toolData.result) : toolData.result) : null;

      // Create the tool bubble container
      const bubble = document.createElement('div');
      bubble.className = 'acp-tool-bubble tool-call-block';
      bubble.style.cssText = `
        margin: 8px 0;
        border: 1px solid var(--vscode-widget-border, #454545);
        border-radius: 6px;
        overflow: hidden;
        background: var(--vscode-editor-background);
      `;

      // Header
      const header = document.createElement('div');
      header.className = 'acp-tool-header tool-call-header';
      header.style.cssText = `
        display: flex;
        align-items: center;
        padding: 8px 12px;
        background: var(--vscode-sideBar-background, #252526);
        cursor: pointer;
        gap: 8px;
      `;

      // Status icon
      const icon = document.createElement('span');
      icon.style.cssText = 'font-size: 14px;';
      if (status === 'loading' || status === 'pending') {
        icon.innerHTML = '⏳';
        icon.className = 'acp-loading-spinner';
      } else if (status === 'completed' || status === 'success') {
        icon.innerHTML = '✅';
      } else if (status === 'error' || status === 'failed') {
        icon.innerHTML = '❌';
      } else {
        icon.innerHTML = '🔧';
      }

      // Title
      const title = document.createElement('span');
      title.style.cssText = `
        font-weight: 500;
        color: var(--vscode-foreground);
        flex: 1;
      `;
      title.textContent = toolName;

      // Status badge
      const badge = document.createElement('span');
      badge.style.cssText = `
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
        background: ${status === 'completed' ? 'var(--vscode-testing-iconPassed, #89d185)' :
                      status === 'error' ? 'var(--vscode-testing-iconFailed, #f14c4c)' :
                      'var(--vscode-badge-background, #4d4d4d)'};
        color: ${status === 'completed' || status === 'error' ? '#000' : 'var(--vscode-badge-foreground)'};
      `;
      badge.textContent = status;

      header.appendChild(icon);
      header.appendChild(title);
      header.appendChild(badge);

      // Content (collapsible)
      const content = document.createElement('div');
      content.className = 'acp-tool-content tool-call-body';
      content.style.cssText = `
        padding: 12px;
        display: none;
        border-top: 1px solid var(--vscode-widget-border, #454545);
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
      `;

      // Input section
      if (params && Object.keys(params).length > 0) {
        const inputSection = document.createElement('div');
        inputSection.style.cssText = 'margin-bottom: 12px;';

        const inputLabel = document.createElement('div');
        inputLabel.style.cssText = 'color: var(--vscode-descriptionForeground); margin-bottom: 4px; font-weight: 500;';
        inputLabel.textContent = '📥 Input';

        const inputCode = document.createElement('pre');
        inputCode.style.cssText = `
          background: var(--vscode-textCodeBlock-background, #1e1e1e);
          padding: 8px;
          border-radius: 4px;
          overflow-x: auto;
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 200px;
          overflow-y: auto;
        `;
        inputCode.textContent = JSON.stringify(params.input || params, null, 2);

        inputSection.appendChild(inputLabel);
        inputSection.appendChild(inputCode);
        content.appendChild(inputSection);
      }

      // Result section
      if (result) {
        const resultSection = document.createElement('div');

        const resultLabel = document.createElement('div');
        resultLabel.style.cssText = 'color: var(--vscode-descriptionForeground); margin-bottom: 4px; font-weight: 500;';
        resultLabel.textContent = '📤 Output';

        const resultCode = document.createElement('pre');
        resultCode.style.cssText = `
          background: var(--vscode-textCodeBlock-background, #1e1e1e);
          padding: 8px;
          border-radius: 4px;
          overflow-x: auto;
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 300px;
          overflow-y: auto;
        `;
        const output = result.output || result;
        resultCode.textContent = typeof output === 'string' ? output : JSON.stringify(output, null, 2);

        resultSection.appendChild(resultLabel);
        resultSection.appendChild(resultCode);
        content.appendChild(resultSection);
      }

      // Toggle content on header click
      let isExpanded = false;
      header.addEventListener('click', () => {
        isExpanded = !isExpanded;
        content.style.display = isExpanded ? 'block' : 'none';
      });

      bubble.appendChild(header);
      bubble.appendChild(content);
      container.appendChild(bubble);

      return bubble;
    },

    // Check if this is an ACP tool bubble
    isACPTool: function(toolData) {
      return toolData && toolData.tool === 90;
    },

    // Update an existing bubble
    update: function(bubble, toolData) {
      if (!bubble) return;

      const status = toolData.status || 'loading';
      const icon = bubble.querySelector('.acp-tool-header span:first-child');
      const badge = bubble.querySelector('.acp-tool-header span:last-child');

      if (icon) {
        if (status === 'loading' || status === 'pending') {
          icon.innerHTML = '⏳';
        } else if (status === 'completed' || status === 'success') {
          icon.innerHTML = '✅';
        } else if (status === 'error' || status === 'failed') {
          icon.innerHTML = '❌';
        }
      }

      if (badge) {
        badge.textContent = status;
        badge.style.background = status === 'completed' ? 'var(--vscode-testing-iconPassed, #89d185)' :
                                 status === 'error' ? 'var(--vscode-testing-iconFailed, #f14c4c)' :
                                 'var(--vscode-badge-background, #4d4d4d)';
      }
    }
  };

  // Add CSS for loading animation
  const style = document.createElement('style');
  style.textContent = `
    .acp-loading-spinner {
      animation: acp-spin 1s linear infinite;
    }
    @keyframes acp-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .acp-tool-bubble:hover {
      border-color: var(--vscode-focusBorder, #007fd4);
    }
  `;
  document.head.appendChild(style);

  console.log('[ACP] Tool bubble renderer initialized');
})();
