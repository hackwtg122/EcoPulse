import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { warmPilotApi } from './pilot-warmup';

import './index.css';

if (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim()) {
  warmPilotApi(
    window.location.pathname,
    import.meta.env.BASE_URL,
    import.meta.env.VITE_PILOT_API_URL?.trim() || 'http://127.0.0.1:5001',
  );
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
