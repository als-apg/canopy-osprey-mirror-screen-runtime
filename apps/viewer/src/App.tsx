// Route table. main.tsx wraps this in BrowserRouter + ServicesContext;
// tests use MemoryRouter and mock services.

import { Route, Routes } from 'react-router-dom';
import { BrowsePage } from './pages/BrowsePage.js';
import { ScreenPage } from './pages/ScreenPage.js';
import { ErrorPanel } from './ErrorPanel.js';

export function App({ screensBaseUrl }: { screensBaseUrl: string }) {
  return (
    <Routes>
      <Route path="/" element={<BrowsePage screensBaseUrl={screensBaseUrl} />} />
      {/* splat, not :id, so slashed ids like "CBXFEL/Landing" match */}
      <Route path="/s/:category/*" element={<ScreenPage screensBaseUrl={screensBaseUrl} />} />
      <Route path="*" element={<ErrorPanel title="Page not found" />} />
    </Routes>
  );
}
