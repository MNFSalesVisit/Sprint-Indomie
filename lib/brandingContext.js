import React, { createContext, useContext, useState, useCallback } from 'react';

const DEFAULTS = {
  company_name:     'Indomie',
  company_logo:     '/indomie-logo.png',
  system_name:      'Sales Visit System',
  theme_color:      '#e11d48', // Red
  accent_color:     '#fbbf24', // Yellow/Gold accent
  contact_email:    '',
  contact_phone:    '',
  business_address: '',
};

const BrandingContext = createContext({
  branding: DEFAULTS,
  setBranding: () => {},
  mergeBranding: () => {},
});

export function BrandingProvider({ children }) {
  const [branding, setBrandingState] = useState(DEFAULTS);

  const setBranding = useCallback((cfg) => {
    setBrandingState({ ...DEFAULTS, ...cfg });
  }, []);

  // Merge a partial update (e.g. after saving only identity or only branding)
  const mergeBranding = useCallback((partial) => {
    setBrandingState(prev => ({ ...prev, ...partial }));
  }, []);

  return (
    <BrandingContext.Provider value={{ branding, setBranding, mergeBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
