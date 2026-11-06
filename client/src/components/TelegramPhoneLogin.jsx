import { useEffect, useState } from 'react';
import { api, saveToken } from '../api.js';

/**
 * Telegram phone-number login: phone -> OTP code (sent inside Telegram) ->
 * optional 2FA password. Calls onConnected(user) when done.
 */
export default function TelegramPhoneLogin({ onConnected, standalone = false }) {
  const [enabled, setEnabled] = useState(null);
  const [step, setStep] = useState('phone'); // phone | code | password
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [flowId, setFlowId] = useState(null);
  const [viaApp, setViaApp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/mt/config').then((c) => setEnabled(c.enabled)).catch(() => setEnabled(false));
  }, []);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (enabled === false) {
    return (
      <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-4 text-xs leading-relaxed text-amber-900 backdrop-blur dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
        <div className="flex items-start gap-2.5">
          <span className="text-base">⚠️</span>
          <div>
            <p className="font-semibold">Phone login is not configured</p>
            <p className="mt-1 text-amber-800/80 dark:text-amber-300/80">
              Set <b>MT_API_ID</b> &amp; <b>MT_API_HASH</b> environment variables in <code>server/.env</code> (obtainable from <b>my.telegram.org</b>) to enable seamless phone logins.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (enabled === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-200 border-t-sky-500" />
      </div>
    );
  }

  const containerClass = standalone
    ? 'rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/80'
    : 'w-full';

  return (
    <div className={containerClass}>
      {/* Stepper indicator */}
      <div className="mb-5 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-all ${
              step === 'phone'
                ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/40'
                : 'bg-emerald-500 text-white'
            }`}
          >
            {step === 'phone' ? '1' : '✓'}
          </span>
          <span className={`font-medium ${step === 'phone' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
            Phone
          </span>
        </div>

        <div className="h-[2px] flex-1 mx-3 bg-slate-200 dark:bg-slate-800" />

        <div className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-all ${
              step === 'code'
                ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/40'
                : step === 'password'
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            {step === 'password' ? '✓' : '2'}
          </span>
          <span className={`font-medium ${step === 'code' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
            Telegram Code
          </span>
        </div>

        {step === 'password' && (
          <>
            <div className="h-[2px] flex-1 mx-3 bg-slate-200 dark:bg-slate-800" />
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white shadow-sm shadow-sky-500/40">
                3
              </span>
              <span className="font-medium text-slate-900 dark:text-white">
                2FA
              </span>
            </div>
          </>
        )}
      </div>

      {step === 'phone' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const d = await api.post('/api/mt/send-code', { phone });
              setFlowId(d.flowId);
              setViaApp(!!d.isCodeViaApp);
              setStep('code');
            });
          }}
          className="space-y-4"
        >
          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
              <span>Phone number</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">International format</span>
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                </svg>
              </div>
              <input
                type="tel"
                required
                autoFocus
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                className="w-full rounded-xl border border-slate-300/80 bg-white py-2.5 pl-10 pr-4 text-sm font-medium text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-400 dark:focus:ring-sky-400/20"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              Telegram sends an official login code to your active Telegram session.
            </p>
          </div>

          <button
            type="submit"
            disabled={busy || !phone.trim()}
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-sky-500 via-sky-600 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-sky-500/25 transition-all hover:brightness-105 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <>
                <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                <span>Send Code via Telegram</span>
              </>
            )}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const d = await api.post('/api/mt/verify-code', { flowId, code });
              if (d.needPassword) {
                setStep('password');
              } else {
                saveToken(d.token);
                onConnected(d.user);
              }
            });
          }}
          className="space-y-4"
        >
          <div className="rounded-xl border border-sky-200/80 bg-sky-50/70 p-3 text-xs dark:border-sky-500/20 dark:bg-sky-500/10">
            <div className="flex items-center justify-between text-sky-900 dark:text-sky-300">
              <span>Code sent for <b>{phone}</b></span>
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setCode('');
                }}
                className="font-semibold underline hover:text-sky-700 dark:hover:text-sky-200"
              >
                Change
              </button>
            </div>
            <p className="mt-1 text-[11px] text-sky-800/80 dark:text-sky-300/70">
              Check your official Telegram service notifications {viaApp ? 'in the app' : ''}.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-center text-xs font-medium text-slate-700 dark:text-slate-300">
              Enter 5-digit verification code
            </label>
            <input
              required
              autoFocus
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
              placeholder="•••••"
              className="w-full rounded-xl border border-slate-300/80 bg-white py-3 text-center font-mono text-2xl font-bold tracking-[0.5em] text-slate-900 shadow-sm transition placeholder:tracking-normal placeholder:text-slate-300 focus:border-sky-500 focus:outline-none focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-600 dark:focus:border-sky-400 dark:focus:ring-sky-400/20"
            />
          </div>

          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 via-sky-600 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-sky-500/25 transition-all hover:brightness-105 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <span>Verify &amp; Continue</span>
            )}
          </button>
        </form>
      )}

      {step === 'password' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const d = await api.post('/api/mt/verify-password', { flowId, password });
              saveToken(d.token);
              onConnected(d.user);
            });
          }}
          className="space-y-4"
        >
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Two-Step Verification Password
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <input
                type="password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Telegram cloud password"
                className="w-full rounded-xl border border-slate-300/80 bg-white py-2.5 pl-10 pr-4 text-sm font-medium text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-400 dark:focus:ring-sky-400/20"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              Your Telegram account has 2FA enabled. Enter your cloud password to complete login.
            </p>
          </div>

          <button
            type="submit"
            disabled={busy || !password.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 via-sky-600 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-sky-500/25 transition-all hover:brightness-105 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <span>Unlock Account</span>
            )}
          </button>
        </form>
      )}

      {step !== 'phone' && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => {
              setStep('phone');
              setCode('');
              setPassword('');
            }}
            className="text-xs font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            ← Use a different phone number
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          <svg className="h-4 w-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
          </svg>
          <span className="leading-snug">{error}</span>
        </div>
      )}
    </div>
  );
}
