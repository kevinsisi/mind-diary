import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SiteConfigProvider } from './context/SiteConfigContext';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SiteConfigProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </SiteConfigProvider>
    </BrowserRouter>
  </StrictMode>,
);
