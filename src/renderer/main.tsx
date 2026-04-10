import React, { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] React crash:', error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#020617', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'sans-serif' }}>
          <div style={{ maxWidth: '800px', width: '100%' }}>
            <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', color: '#f87171' }}>Renderer crashed</div>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>A JavaScript error occurred while loading the UI. Check the DevTools Console for details.</div>
            <pre style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '12px', fontSize: '12px', color: '#cbd5e1', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {this.state.error.message}{'\n'}{this.state.error.stack}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

console.log('[Main] Renderer entry point started');

const root = createRoot(document.getElementById('root')!);
console.log('[Main] Root element created');
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
console.log('[Main] App rendered');
