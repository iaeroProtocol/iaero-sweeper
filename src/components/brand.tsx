'use client';

import {createContext, useContext, useSyncExternalStore, type ReactNode} from 'react';

export type BrandTheme = 'light' | 'dark';
const themeKey = 'iaero.sweeper.theme';
const themeEvent = 'iaero:sweeper-theme';
const BrandThemeContext = createContext<{theme: BrandTheme; toggleTheme: () => void}>({theme: 'light', toggleTheme: () => {}});

function currentTheme(): BrandTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: BrandTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a1220' : '#f6f7f9');
}

function subscribeTheme(onChange: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== themeKey) return;
    applyTheme(event.newValue === 'dark' ? 'dark' : 'light');
    onChange();
  };
  window.addEventListener(themeEvent, onChange);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(themeEvent, onChange);
    window.removeEventListener('storage', storage);
  };
}

export function BrandThemeProvider({children}: {children: ReactNode}) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => 'light' as const);
  const toggleTheme = () => {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem(themeKey, next); } catch {}
    window.dispatchEvent(new Event(themeEvent));
  };
  return <BrandThemeContext.Provider value={{theme, toggleTheme}}>{children}</BrandThemeContext.Provider>;
}

export function useBrandTheme() {
  return useContext(BrandThemeContext);
}

export function BrandMark({className = ''}: {className?: string}) {
  return <svg className={'sweeper-brand-mark ' + className} width="38" height="38" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="M30 8a4 4 0 0 1 5 0l20 20a5 5 0 0 1 0 7L35 56a4 4 0 0 1-6 0L9 35a5 5 0 0 1 0-7Z" fill="currentColor"/>
    <path d="m33 20-13 14 13 14 13-14Z" fill="var(--surface)"/>
    <path d="M8 40C-1 55 43 47 57 28c8-11 1-13-5-11 17-2 11 12-4 23C29 54 1 57 8 40Z" fill="var(--ink)" stroke="var(--surface)" strokeWidth="2"/>
  </svg>;
}

export function BrandThemeToggle() {
  const {theme, toggleTheme} = useBrandTheme();
  return <button className="sweeper-theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}>
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {theme === 'light' ? <path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z"/> : <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></>}
    </svg>
  </button>;
}

export function BrandHeader({chain = 'evm', wallet}: {chain?: 'evm' | 'solana'; wallet?: ReactNode}) {
  return <header className="sweeper-site-header">
    <a className="sweeper-skip-link" href="#main-content">Skip to token sweeper</a>
    <div className="sweeper-header-inner">
      <div className="sweeper-brand-lockup">
        <a className="sweeper-brand" href="https://app.iaero.finance/" aria-label="iAERO staking app"><BrandMark/><span className="sweeper-wordmark">iAERO<span>.</span></span></a>
        <span className="sweeper-product-name">Token Sweeper</span>
      </div>
      <nav className="sweeper-chain-nav" aria-label="Sweeper network family">
        <a href="/" aria-current={chain === 'evm' ? 'page' : undefined}>
          <svg width="16" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.75 5.75 12.25 12 16l6.25-3.75L12 1.75ZM5.75 13.5 12 22.25l6.25-8.75L12 17.25 5.75 13.5Z"/></svg>EVM
        </a>
        <a href="/solana" aria-current={chain === 'solana' ? 'page' : undefined}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h15l-4 4H3l4-4Zm-4 7h15l4 4H7l-4-4Zm4 7h15l-4 4H3l4-4Z"/></svg>Solana
        </a>
      </nav>
      <div className="sweeper-header-actions">
        <a className="sweeper-header-docs" href="https://docs.iaero.finance" target="_blank" rel="noopener noreferrer">Docs <ExternalArrow/></a>
        <BrandThemeToggle/>
        {wallet && <div className="sweeper-wallet-slot">{wallet}</div>}
      </div>
    </div>
  </header>;
}

function ExternalArrow() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg>;
}

export function BrandFooter() {
  return <footer className="sweeper-site-footer">
    <div className="sweeper-footer-inner">
      <div className="sweeper-footer-brand"><BrandMark/><span>iAERO</span><small>A more liquid future.</small></div>
      <nav aria-label="iAERO resources">
        <a href="https://app.iaero.finance/">Staking app <ExternalArrow/></a>
        <a href="https://docs.iaero.finance" target="_blank" rel="noopener noreferrer">Documentation <ExternalArrow/></a>
        <a href="https://x.com/iaeroProtocol" target="_blank" rel="noopener noreferrer">X / Twitter <ExternalArrow/></a>
        <a href="https://discord.gg/YypP6DG3" target="_blank" rel="noopener noreferrer">Discord <ExternalArrow/></a>
      </nav>
      <p className="sweeper-footer-note">Every transaction requires your wallet confirmation.</p>
    </div>
  </footer>;
}
