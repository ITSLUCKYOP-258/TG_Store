import { useEffect, useState } from 'react';
import { api, saveToken } from '../api.js';
import { useAuth } from '../App.jsx';
import TelegramPhoneLogin from '../components/TelegramPhoneLogin.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

export default function Login() {
  const { setUser } = useAuth();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(64);

  useEffect(() => {
    const timer = setInterval(() => {
      setUploadPercent((prev) => (prev >= 98 ? 14 : prev + 2));
    }, 160);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    api.get('/api/auth/config').then(setConfig).catch(() => setConfig({}));
  }, []);

  // Global callback for the Telegram Login Widget
  useEffect(() => {
    window.onTelegramAuth = async (user) => {
      try {
        setBusy(true);
        const data = await api.post('/api/auth/telegram', user);
        saveToken(data.token);
        setUser(data.user);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    };
  }, [setUser]);

  const devLogin = async () => {
    try {
      setBusy(true);
      const data = await api.post('/api/auth/dev', { name: 'Dev User' });
      saveToken(data.token);
      setUser(data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const telegramWidget = config?.telegramLoginEnabled && (
    <div className="flex justify-center">
      <script
        src="https://telegram.org/js/telegram-widget.js?22"
        data-telegram-login={config.botUsername}
        data-size="large"
        data-userpic="true"
        data-radius="12"
        data-onauth="onTelegramAuth(user)"
        data-request-access="write"
        async
      />
    </div>
  );

  return (
    <div className="relative flex min-h-screen flex-col bg-slate-50 text-slate-900 transition-colors duration-200 dark:bg-[#0b111d] dark:text-slate-100 lg:flex-row">
      {/* Top right floating theme switcher */}
      <div className="absolute top-4 right-4 z-30">
        <ThemeToggle />
      </div>

      {/* Left hero: Product Showcase & Cloud Drive Preview */}
      <div className="relative flex flex-1 flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-900 via-[#101728] to-slate-950 px-6 py-10 text-white sm:px-12 sm:py-16 lg:px-16 lg:py-20">
        {/* Glow backdrop circles */}
        <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-sky-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-0 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />

        {/* Top brand header */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-12 w-14 items-center justify-center rounded-2xl bg-white/10 p-1 shadow-lg shadow-sky-500/30 backdrop-blur-md">
            <img src="/logo-icon.png" alt="TGStore" className="h-full w-auto object-contain drop-shadow" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-white">TG<span className="text-sky-400">Store</span></span>
              <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-500/30">
                UNLIMITED
              </span>
            </div>
            <p className="text-xs tracking-wider text-slate-300 uppercase font-medium">Your Files, On Telegram</p>
          </div>
        </div>

        {/* Center showcase */}
        <div className="relative z-10 my-8 max-w-xl lg:my-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs font-medium text-sky-300 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
            Zero Subscription • No File Size Limits
          </div>

          <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl leading-tight">
            Cloud Storage,{' '}
            <span className="bg-gradient-to-r from-sky-400 via-sky-300 to-indigo-300 bg-clip-text text-transparent">
              Powered by TGSTORE
            </span>
          </h1>

          <p className="mt-4 text-sm leading-relaxed text-slate-300 sm:text-base">
            Turn your Telegram account into a high-speed private drive. Every file is automatically chunked, safely stored, and instantly streamable in your browser.
          </p>
          {/* Interactive Drive UI Mockup with Live Upload Animation */}
          <div className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-2xl backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                <span className="ml-2 font-mono text-xs text-slate-400">tgstore://my-vault</span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Sync Active
              </span>
            </div>

            {/* Storage bar */}
            <div className="mb-3 space-y-1.5 rounded-xl bg-white/[0.03] p-2.5">
              <div className="flex justify-between text-xs font-medium text-slate-300">
                <span className="flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z" />
                  </svg>
                  Telegram Cloud Storage
                </span>
                <span className="text-sky-300 font-mono">142.8 GB Uploaded</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500" />
              </div>
            </div>

            {/* Mock file cards with Live Upload Animation */}
            <div className="space-y-2 font-mono text-xs">
              {/* Active animated upload item */}
              <div className="relative overflow-hidden rounded-xl border border-sky-400/30 bg-sky-500/[0.09] p-2.5 ring-1 ring-sky-400/20 backdrop-blur">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    <div className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
                      <svg className="h-4 w-4 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    </div>
                    <div className="overflow-hidden">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold text-white">Project_Raw_Footage.mp4</span>
                        <span className="rounded bg-sky-400/20 px-1 py-0.5 text-[9px] font-semibold text-sky-300">
                          CHUNK 14/20
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-sky-200/80">
                        Uploading • 18.4 MB/s • {Math.round((uploadPercent * 480) / 100)} MB / 480 MB
                      </p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className="font-mono text-xs font-bold text-sky-300">{uploadPercent}%</span>
                  </div>
                </div>

                {/* Progress bar with smooth glowing transition */}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 via-indigo-400 to-sky-300 transition-all duration-200 shadow-sm shadow-sky-400/50"
                    style={{ width: `${uploadPercent}%` }}
                  />
                </div>
              </div>

              {/* Completed file card 1 */}
              <div className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-slate-200">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="text-sm">🎬</span>
                  <span className="truncate">Cinematic_4K_Project.mov</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 text-[11px] text-slate-400">
                  <span className="hidden sm:inline text-sky-400">Stream ready</span>
                  <span>1.84 GB</span>
                </div>
              </div>

              {/* Completed file card 2 */}
              <div className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-slate-200">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="text-sm">🔐</span>
                  <span className="truncate">Encrypted_Vault_Backup.zip</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 text-[11px] text-slate-400">
                  <span className="hidden sm:inline text-emerald-400">E2EE AES-256</span>
                  <span>420 MB</span>
                </div>
              </div>
            </div>
          </div>

          {/* Feature highlights pill grid */}
          <div className="mt-6 grid grid-cols-2 gap-2.5 text-xs sm:grid-cols-4">
            {[
              ['⚡ 2GB Limit', 'Per MTProto chunk'],
              ['🔒 Vault E2EE', 'Zero knowledge key'],
              ['🎬 In-Browser', 'Direct media stream'],
              ['🔗 Share Link', 'Password-protected'],
            ].map(([title, desc]) => (
              <div key={title} className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5 backdrop-blur">
                <p className="font-semibold text-white">{title}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer info */}
        <div className="relative z-10 flex items-center justify-between pt-6 text-xs text-slate-400 border-t border-white/5">
          <span>TGStore Engine</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            MTProto v2 Connected
          </span>
        </div>
      </div>

      {/* Right: Modern Login Card Column */}
      <div className="relative flex flex-1 items-center justify-center p-6 sm:p-12 lg:p-16">
        {/* Subtle radial ambient lighting */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-80 w-80 rounded-full bg-sky-500/10 blur-3xl dark:bg-sky-500/15" />
        </div>

        <div className="relative w-full max-w-md rounded-3xl border border-slate-200/80 bg-white/95 p-8 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-[#121c2d]/95 sm:p-10">
          {/* Card header */}
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex h-16 w-20 items-center justify-center rounded-2xl bg-white p-1.5 shadow-lg shadow-sky-500/20 ring-1 ring-slate-200/80 dark:bg-slate-800/80 dark:ring-white/10">
              <img src="/logo-icon.png" alt="TGStore" className="h-full w-auto object-contain drop-shadow-sm" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Connect to TG<span className="text-sky-500 dark:text-sky-400">Store</span>
            </h2>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              Sign in with your Telegram account to access your storage
            </p>
          </div>

          {/* Phone login form */}
          <div className="space-y-5">
            <TelegramPhoneLogin onConnected={(u) => setUser(u)} />

            {telegramWidget}

            {config?.devLoginEnabled && (
              <>
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200 dark:border-white/10" />
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
                    <span className="bg-white px-2.5 font-medium text-slate-400 dark:bg-[#121c2d] dark:text-slate-500">
                      Local Development
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={devLogin}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                >
                  <svg className="h-4 w-4 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>{busy ? 'Connecting…' : 'One-Click Dev Login'}</span>
                </button>
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                <span className="text-sm">⚠️</span>
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Privacy & Security banner */}
          <div className="mt-8 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3.5 text-center text-[11px] leading-relaxed text-slate-500 dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-300">🔒 Official Telegram MTProto API</span>
            <p className="mt-0.5">Your files are stored in your private Telegram storage channel. Credentials are never logged or stored on intermediate servers.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
