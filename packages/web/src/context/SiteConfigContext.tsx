import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiClient } from '../api/client';

interface SiteConfigContextValue {
  siteTitle: string;
  updateSiteTitle: (title: string) => Promise<void>;
}

const SiteConfigContext = createContext<SiteConfigContextValue | null>(null);

const DEFAULT_TITLE = '心靈日記';

export function SiteConfigProvider({ children }: { children: ReactNode }) {
  const [siteTitle, setSiteTitle] = useState(DEFAULT_TITLE);

  useEffect(() => {
    apiClient
      .get<{ site_title: string }>('/api/settings/config')
      .then((data) => setSiteTitle(data.site_title || DEFAULT_TITLE))
      .catch(() => {/* keep default */});
  }, []);

  useEffect(() => {
    document.title = siteTitle;
  }, [siteTitle]);

  async function updateSiteTitle(title: string) {
    const data = await apiClient.put<{ site_title: string }>('/api/settings/config', { site_title: title });
    setSiteTitle(data.site_title);
  }

  return (
    <SiteConfigContext.Provider value={{ siteTitle, updateSiteTitle }}>
      {children}
    </SiteConfigContext.Provider>
  );
}

export function useSiteConfig(): SiteConfigContextValue {
  const ctx = useContext(SiteConfigContext);
  if (!ctx) throw new Error('useSiteConfig must be used within SiteConfigProvider');
  return ctx;
}
