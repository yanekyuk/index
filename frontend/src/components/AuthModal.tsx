import { useState, useEffect } from 'react';
import { authClient } from '@/lib/auth-client';
import { X, ArrowLeft } from 'lucide-react';

const API_BASE = '/api';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthView = 'main' | 'magic-link-sent' | 'email-password';

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [view, setView] = useState<AuthView>('main');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socialProviders, setSocialProviders] = useState<string[]>([]);
  const [emailPasswordEnabled, setEmailPasswordEnabled] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch(`${API_BASE}/auth/providers`)
      .then((r) => r.json())
      .then((data: { providers?: string[]; emailPassword?: boolean }) => {
        setSocialProviders(data.providers ?? []);
        setEmailPasswordEnabled(data.emailPassword ?? false);
      })
      .catch(() => {
        setSocialProviders([]);
        setEmailPasswordEnabled(false);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const hasGoogle = socialProviders.includes('google');

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setName('');
    setError(null);
    setView('main');
    setIsSignUp(false);
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: magicLinkError } = await authClient.signIn.magicLink({
        email,
        callbackURL: typeof window !== 'undefined' ? window.location.origin : '/',
      });
      if (magicLinkError) {
        setError(magicLinkError.message || 'Failed to send sign-in link');
        return;
      }
      setView('magic-link-sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isSignUp) {
        const { error: signUpError } = await authClient.signUp.email({
          email,
          password,
          name: name || email.split('@')[0],
        });
        if (signUpError) {
          setError(signUpError.message || 'Sign up failed');
          return;
        }
      } else {
        const { error: signInError } = await authClient.signIn.email({
          email,
          password,
        });
        if (signInError) {
          setError(signInError.message || 'Sign in failed');
          return;
        }
      }
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await authClient.signIn.social({
        provider: 'google',
        callbackURL: typeof window !== 'undefined' ? window.location.origin : '/',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign in failed');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white w-full max-w-md mx-4 p-8 shadow-xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={20} />
        </button>

        {view === 'magic-link-sent' && (
          <>
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 font-ibm-plex-mono uppercase tracking-wider">
                Check Your Email
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              We sent a sign-in link to
            </p>
            <p className="text-sm font-medium text-gray-900 mb-6">{email}</p>
            <p className="text-sm text-gray-500 mb-6">
              Click the link in the email to sign in. The link expires in 10 minutes.
            </p>
            <button
              onClick={resetForm}
              className="w-full border border-gray-300 text-gray-700 py-3 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Back to sign in
            </button>
          </>
        )}

        {view === 'main' && (
          <>
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 font-ibm-plex-mono uppercase tracking-wider">
                Sign In
              </h2>
            </div>

            {hasGoogle && (
              <button
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                  <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>
            )}

            {hasGoogle && (
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-gray-400 tracking-wider">or</span>
                </div>
              </div>
            )}

            <form onSubmit={handleMagicLink} className="space-y-4">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 text-sm text-black focus:outline-none focus:border-gray-900 transition-colors"
              />

              {error && (
                <p className="text-red-600 text-sm">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#041729] text-white py-3 text-sm font-semibold uppercase tracking-wider hover:bg-[#0a2d4a] transition-colors disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send Sign-In Link'}
              </button>
            </form>

            {emailPasswordEnabled && (
              <p className="mt-6 text-center text-sm text-gray-500">
                Or{' '}
                <button
                  onClick={() => setView('email-password')}
                  className="text-gray-900 font-medium hover:underline"
                >
                  sign in with password
                </button>
              </p>
            )}
          </>
        )}

        {view === 'email-password' && emailPasswordEnabled && (
          <>
            <div className="mb-6 flex items-center gap-3">
              <button
                onClick={() => { setView('main'); setError(null); }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="text-xl font-semibold text-gray-900 font-ibm-plex-mono uppercase tracking-wider">
                {isSignUp ? 'Create Account' : 'Sign In'}
              </h2>
            </div>

            <form onSubmit={handleEmailPassword} className="space-y-4">
              {isSignUp && (
                <input
                  type="text"
                  placeholder="Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 text-sm text-black focus:outline-none focus:border-gray-900 transition-colors"
                />
              )}
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 text-sm text-black focus:outline-none focus:border-gray-900 transition-colors"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-3 border border-gray-300 text-sm text-black focus:outline-none focus:border-gray-900 transition-colors"
              />

              {error && (
                <p className="text-red-600 text-sm">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#041729] text-white py-3 text-sm font-semibold uppercase tracking-wider hover:bg-[#0a2d4a] transition-colors disabled:opacity-50"
              >
                {loading ? 'Loading...' : isSignUp ? 'Create Account' : 'Sign In'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-500">
              {isSignUp ? (
                <>
                  Already have an account?{' '}
                  <button
                    onClick={() => { setIsSignUp(false); setError(null); }}
                    className="text-gray-900 font-medium hover:underline"
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    onClick={() => { setIsSignUp(true); setError(null); }}
                    className="text-gray-900 font-medium hover:underline"
                  >
                    Sign up
                  </button>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
