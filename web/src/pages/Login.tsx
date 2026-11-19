// Sign-in — same page as login.html. POST /api/login, keep the token and role, then open the dashboard.
import { useState } from 'react';
import { usePublicPage } from '../lib/publicPage';
import './login.css';

const EYE = <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></>;
const EYE_OFF = <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>;

export function Login() {
    usePublicPage('login', 'bg-[#FBF8F1] min-h-screen flex items-center justify-center p-6 antialiased selection:bg-brand-orange selection:text-white', 'Login - Al-Farha Cargo ERP');
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [username, setUsername] = useState(''), [password, setPassword] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true); setError(null);
        try {
            const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Authentication failed');
            // the token may come inside `session` or at the top level
            const token = result.session?.access_token ? result.session.access_token : result.access_token;
            const user = result.session?.user ? result.session.user : result.user;
            if (!token || !user) throw new Error('Invalid response from server. Missing security token.');
            localStorage.setItem('cargo_auth_token', token);
            localStorage.setItem('cargo_user_role', result.role || 'staff');
            localStorage.setItem('cargo_is_warehouse', result.is_warehouse ? '1' : '');
            localStorage.setItem('cargo_is_cashier', result.is_cashier ? '1' : '');
            // one dashboard for every role; it adapts to the role
            window.location.href = '/app/super-dashboard';
        } catch (err) {
            setError((err as Error).message);
            setBusy(false);
        }
    };

    return (
        <div className="max-w-5xl w-full bg-white rounded-[2.5rem] shadow-soft overflow-hidden flex flex-col md:flex-row relative z-10">
            <div className="w-full md:w-5/12 bg-gradient-to-br from-brand-purple to-brand-purpleDark p-10 lg:p-14 flex flex-col justify-between text-white relative overflow-hidden hidden md:flex">
                <div className="absolute w-64 h-64 bg-white opacity-5 shape-1 z-0"></div>
                <div className="absolute w-80 h-80 bg-brand-orange opacity-10 shape-2 z-0"></div>
                <div className="relative z-10">
                    <div className="mb-12">
                        <img src="/assets/LOGO%20BG%20B.svg" alt="Al-Farha Cargo Logo" className="h-14 w-auto object-contain" />
                    </div>
                    <div>
                        <h1 className="text-4xl lg:text-5xl font-extrabold leading-tight mb-4">
                            {'Logistics '}<br /><span className="text-brand-orange">Simplified.</span>
                        </h1>
                        <p className="text-purple-200 text-lg leading-relaxed">
                            {'Access your advanced ERP & CRM dashboard to manage shipments, track progress, and oversee operations seamlessly.'}
                        </p>
                    </div>
                </div>
                <div className="relative z-10">
                    <div className="flex items-center gap-4 text-sm text-purple-300">
                        <span className="w-8 h-[1px] bg-purple-400"></span>
                        Secure Employee Portal
                    </div>
                </div>
            </div>

            <div className="w-full md:w-7/12 p-8 sm:p-12 lg:p-16 flex flex-col justify-center bg-white relative">
                <div className="mb-8 md:hidden">
                    <img src="/assets/LOGO%20BG%20B.svg" alt="Al-Farha Cargo Logo" className="h-10 w-auto object-contain" />
                </div>
                <div className="max-w-md w-full mx-auto">
                    <h2 className="text-3xl font-bold text-gray-900 mb-2">Welcome Back</h2>
                    <p className="text-gray-500 mb-8">Please sign in to your account.</p>

                    <form id="loginForm" className="space-y-6" onSubmit={submit}>
                        <div id="errorMessage" className={`${error === null ? 'hidden ' : ''}bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100 flex items-center gap-2`}>
                            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                            <span id="errorText">{error ?? 'Invalid credentials.'}</span>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="username" className="text-sm font-semibold text-gray-700 ml-1">Username</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                </div>
                                <input type="text" id="username" required placeholder="e.g. admin" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)}
                                    className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent transition-all duration-200" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between ml-1">
                                <label htmlFor="password" className="text-sm font-semibold text-gray-700">Password</label>
                                <a href="#" className="text-sm font-semibold text-brand-orange hover:text-brand-orangeHover transition-colors">Forgot Password?</a>
                            </div>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                                </div>
                                <input type={show ? 'text' : 'password'} id="password" required placeholder="••••••••" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}
                                    className="w-full pl-11 pr-12 py-3.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent transition-all duration-200" />
                                <button type="button" id="togglePassword" onClick={() => setShow(s => !s)} className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none">
                                    <svg id="eyeIcon" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">{show ? EYE_OFF : EYE}</svg>
                                </button>
                            </div>
                        </div>

                        <button type="submit" id="submitBtn" disabled={busy}
                            className="w-full bg-brand-orange hover:bg-brand-orangeHover text-white font-semibold py-3.5 px-4 rounded-xl shadow-glow transition-all duration-300 flex justify-center items-center gap-2 group transform active:scale-[0.98]">
                            <span id="btnText">{busy ? 'Authenticating...' : 'Sign In'}</span>
                            <svg id="btnLoader" className={`w-5 h-5 animate-spin${busy ? '' : ' hidden'}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <svg id="btnArrow" className={`w-5 h-5 group-hover:translate-x-1 transition-transform${busy ? ' hidden' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
