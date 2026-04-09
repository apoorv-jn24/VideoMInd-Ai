/* ════════════════════════════════════════════════════════════
   VideoMind AI — Authentication JS Logic
   ════════════════════════════════════════════════════════════ */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // ─── Elements ────────────────────────────────────────────────
    const tabLogin        = document.getElementById('tab-login-btn');
    const tabRegister     = document.getElementById('tab-register-btn');
    const panelLogin      = document.getElementById('login-panel');
    const panelRegister   = document.getElementById('register-panel');
    
    const loginForm       = document.getElementById('login-form');
    const registerForm    = document.getElementById('register-form');
    
    const loginError      = document.getElementById('login-error');
    const registerError   = document.getElementById('register-error');
    
    const btnLoginSubmit  = document.getElementById('btn-login-submit');
    const btnRegSubmit    = document.getElementById('btn-register-submit');
    
    const inputPassReg    = document.getElementById('reg-pass');
    const strengthFill    = document.getElementById('strength-fill');
    const strengthText    = document.getElementById('strength-text');

    // ─── Tab Switching ───────────────────────────────────────────
    const showTab = (tab) => {
        if (tab === 'login') {
            tabLogin.classList.add('active');
            tabRegister.classList.remove('active');
            panelLogin.classList.add('active');
            panelRegister.classList.remove('active');
            window.history.pushState({}, '', '#login');
        } else {
            tabLogin.classList.remove('active');
            tabRegister.classList.add('active');
            panelLogin.classList.remove('active');
            panelRegister.classList.add('active');
            window.history.pushState({}, '', '#register');
        }
    };

    tabLogin.addEventListener('click', () => showTab('login'));
    tabRegister.addEventListener('click', () => showTab('register'));
    
    document.getElementById('go-to-register').addEventListener('click', (e) => { e.preventDefault(); showTab('register'); });
    document.getElementById('go-to-login').addEventListener('click', (e) => { e.preventDefault(); showTab('login'); });

    // Handle initial hash
    if (window.location.hash === '#register') showTab('register');

    // ─── Password Show/Hide ──────────────────────────────────────
    document.querySelectorAll('.btn-toggle-pass').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = btn.previousElementSibling;
            const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
            input.setAttribute('type', type);
            btn.textContent = type === 'password' ? '👁️' : '🙈';
        });
    });

    // ─── Password Strength ───────────────────────────────────────
    inputPassReg.addEventListener('input', () => {
        const val = inputPassReg.value;
        let score = 0;
        if (val.length >= 6)  score += 1;
        if (/[A-Z]/.test(val)) score += 1;
        if (/[0-9]/.test(val)) score += 1;
        if (/[^A-Za-z0-9]/.test(val)) score += 1;

        const colors = ['#ef4444', '#f59e0b', '#22c55e', '#10b981'];
        const texts  = ['Too weak', 'Could be better', 'Strong password', 'Very secure!'];
        
        const idx = Math.min(score - 1, 3);
        if (val.length === 0) {
            strengthFill.style.width = '0%';
            strengthText.textContent = 'Password Strength';
        } else {
            strengthFill.style.width = `${(idx + 1) * 25}%`;
            strengthFill.style.background = colors[idx] || colors[0];
            strengthText.textContent = texts[idx] || texts[0];
            strengthText.style.color = colors[idx] || colors[0];
        }
    });

    // ─── Form Submission ───────────────────────────────────────
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(loginForm));
        
        btnLoginSubmit.disabled = true;
        btnLoginSubmit.textContent = 'Signing in...';
        loginError.classList.add('hidden');

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            
            if (res.ok) {
                window.location.href = '/';
            } else {
                loginError.textContent = `❌ ${result.error || 'Login failed'}`;
                loginError.classList.remove('hidden');
            }
        } catch (err) {
            loginError.textContent = '❌ Server connection failed. Please try again.';
            loginError.classList.remove('hidden');
        } finally {
            btnLoginSubmit.disabled = false;
            btnLoginSubmit.textContent = 'Sign In';
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(registerForm));
        const conf = document.getElementById('reg-pass-conf').value;
        
        if (data.password !== conf) {
            registerError.textContent = '❌ Passwords do not match.';
            registerError.classList.remove('hidden');
            return;
        }

        btnRegSubmit.disabled = true;
        btnRegSubmit.textContent = 'Creating account...';
        registerError.classList.add('hidden');

        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            
            if (res.ok) {
                window.location.href = '/';
            } else {
                registerError.textContent = `❌ ${result.error || 'Registration failed'}`;
                registerError.classList.remove('hidden');
            }
        } catch (err) {
            registerError.textContent = '❌ Server connection failed. Please try again.';
            registerError.classList.remove('hidden');
        } finally {
            btnRegSubmit.disabled = false;
            btnRegSubmit.textContent = 'Create Account';
        }
    });
});
