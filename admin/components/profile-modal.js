// File: admin/components/profile-modal.js
document.addEventListener('DOMContentLoaded', () => {
    const modalHost = document.createElement('div');
    modalHost.id = 'profile-component-host';
    document.body.appendChild(modalHost);

    modalHost.innerHTML = `
    <!-- Backdrop -->
    <div id="profileDrawerBackdrop" onclick="closeProfileModal()" 
         class="fixed inset-0 z-50 bg-gray-900/30 backdrop-blur-sm hidden opacity-0 transition-opacity duration-300"></div>

    <!-- Slide-Over Profile Panel -->
    <aside id="profileDrawerPanel" 
           class="fixed top-3 bottom-3 right-3 z-50 w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl border border-gray-100 flex flex-col justify-between overflow-hidden transform translate-x-[110%] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]">
        
        <!-- Top Header with Gradient Accent -->
        <div>
            <div class="relative bg-gradient-to-br from-[#111827] via-[#1F2937] to-[#111827] p-6 pb-14 text-white overflow-hidden">
                <div class="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-coral-500/20 blur-xl pointer-events-none"></div>
                
                <div class="flex justify-between items-center relative z-10">
                    <span class="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest bg-white/10 px-3 py-1 rounded-full">
                        <span class="w-1.5 h-1.5 rounded-full bg-coral-500"></span>
                        Employee Identity Card
                    </span>
                    <button onclick="closeProfileModal()" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
            </div>

            <!-- Overlapping Avatar & Name Card -->
            <div class="px-6 -mt-10 relative z-20">
                <div class="bg-white rounded-3xl p-4 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.08)] border border-gray-100 flex items-center gap-4">
                    <img id="profModalAvatar" src="https://ui-avatars.com/api/?name=Muhammed+Adhil&background=E86D58&color=fff&bold=true" 
                         alt="Avatar" class="w-16 h-16 rounded-2xl object-cover shadow-md border-2 border-white">
                    <div class="min-w-0 flex-1">
                        <h3 id="profModalFullName" class="text-lg font-extrabold text-gray-900 truncate">Muhammed Adhil</h3>
                        <div class="flex flex-wrap items-center gap-1.5 mt-1">
                            <span id="profModalRoleBadge" class="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-coral-50 text-coral-600 border border-coral-100">
                                Super Admin
                            </span>
                            <span id="profModalBranchBadge" class="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#F8F8FA] text-gray-700 border border-gray-200/60">
                                Global HQ
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Animated Sliding Pill Tab Switcher -->
            <div class="px-6 mt-5">
                <div class="relative grid grid-cols-2 bg-[#F8F8FA] p-1 rounded-2xl border border-gray-100 overflow-hidden">
                    <!-- Gliding White Pill Background -->
                    <div id="profTabSlider" 
                         class="absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] bg-white rounded-xl shadow-sm transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] pointer-events-none"></div>

                    <button type="button" id="profTabDetailsBtn" onclick="switchProfileTab('details')" 
                            class="relative z-10 py-2.5 rounded-xl text-xs font-extrabold transition-colors duration-300 text-gray-900">
                        User & Branch Info
                    </button>
                    <button type="button" id="profTabSecurityBtn" onclick="switchProfileTab('security')" 
                            class="relative z-10 py-2.5 rounded-xl text-xs font-bold transition-colors duration-300 text-gray-500 hover:text-gray-900">
                        Change Password
                    </button>
                </div>
            </div>
        </div>

        <!-- Smooth Horizontal Sliding Viewport -->
        <div class="flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar my-4">
            <div id="profTabsTrack" class="flex w-[200%] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]">
                
                <!-- PANE 1: USER & BRANCH DETAILS (50% Width of Track) -->
                <div id="profTabDetailsPane" class="w-1/2 px-6 space-y-3 transition-opacity duration-300 opacity-100">
                    <div class="grid grid-cols-2 gap-3">
                        <div class="bg-[#F8F8FA] p-3.5 rounded-2xl border border-gray-100">
                            <p class="text-[10px] font-bold text-gray-400 uppercase">System Username</p>
                            <p id="profModalUsername" class="text-xs font-extrabold text-gray-900 mt-1">@adhil</p>
                        </div>
                        <div class="bg-[#F8F8FA] p-3.5 rounded-2xl border border-gray-100">
                            <p class="text-[10px] font-bold text-gray-400 uppercase">Assigned Branch</p>
                            <p id="profModalBranch" class="text-xs font-extrabold text-gray-900 mt-1">Global (All Branches)</p>
                        </div>
                    </div>

                    <div class="bg-[#F8F8FA] p-3.5 rounded-2xl border border-gray-100 flex items-center justify-between">
                        <div class="min-w-0 pr-2">
                            <p class="text-[10px] font-bold text-gray-400 uppercase">Recovery & Verification Email</p>
                            <p id="profModalEmail" class="text-xs font-extrabold text-gray-900 mt-1 truncate">Loading...</p>
                        </div>
                        <span class="w-8 h-8 rounded-full bg-white border border-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                        </span>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div class="bg-[#F8F8FA] p-3.5 rounded-2xl border border-gray-100">
                            <p class="text-[10px] font-bold text-gray-400 uppercase">Contact Number</p>
                            <p id="profModalPhone" class="text-xs font-extrabold text-gray-900 mt-1">Loading...</p>
                        </div>
                        <div class="bg-[#F8F8FA] p-3.5 rounded-2xl border border-gray-100">
                            <p class="text-[10px] font-bold text-gray-400 uppercase">Oman Civil ID</p>
                            <p id="profModalOmanId" class="text-xs font-extrabold text-gray-900 mt-1">Loading...</p>
                        </div>
                    </div>

                    <div class="bg-[#FFF5F3] p-3.5 rounded-2xl border border-coral-100 flex items-center justify-between">
                        <div>
                            <p class="text-[10px] font-bold text-coral-600 uppercase">Date of Birth</p>
                            <p id="profModalDob" class="text-xs font-extrabold text-gray-900 mt-1">Loading...</p>
                        </div>
                        <span class="text-[10px] font-bold bg-white text-coral-600 px-3 py-1 rounded-full border border-coral-100 shadow-sm">
                            🎉 Birthday Sync Active
                        </span>
                    </div>
                </div>

                <!-- PANE 2: CHANGE / RESET PASSWORD (50% Width of Track) -->
                <div id="profTabSecurityPane" class="w-1/2 px-6 transition-opacity duration-300 opacity-40">
                    <form id="changePasswordForm" class="space-y-4">
                        <div class="bg-[#F8F8FA] p-4 rounded-2xl border border-gray-100">
                            <h4 class="text-xs font-extrabold text-gray-900">Update Account Password</h4>
                            <p class="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
                                Enter a new password below. Your session will remain active across this device.
                            </p>
                        </div>

                        <div id="passwordAlertBox" class="hidden p-3.5 rounded-2xl text-xs font-bold border"></div>

                        <div class="space-y-1.5">
                            <label class="text-[11px] font-bold text-gray-700 ml-1">New Password</label>
                            <div class="relative">
                                <input type="password" id="newPasswordInput" required minlength="6" placeholder="Minimum 6 characters"
                                       class="w-full px-4 py-3 bg-[#F8F8FA] border border-gray-200 rounded-2xl text-xs font-semibold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-coral-500 transition-all">
                                <button type="button" onclick="togglePasswordVisibility('newPasswordInput')" 
                                        class="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-400 hover:text-gray-700">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                                </button>
                            </div>
                        </div>

                        <div class="space-y-1.5">
                            <label class="text-[11px] font-bold text-gray-700 ml-1">Confirm New Password</label>
                            <div class="relative">
                                <input type="password" id="confirmPasswordInput" required minlength="6" placeholder="Re-enter new password"
                                       class="w-full px-4 py-3 bg-[#F8F8FA] border border-gray-200 rounded-2xl text-xs font-semibold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-coral-500 transition-all">
                                <button type="button" onclick="togglePasswordVisibility('confirmPasswordInput')" 
                                        class="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-400 hover:text-gray-700">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                                </button>
                            </div>
                        </div>

                        <button type="submit" id="savePasswordBtn" 
                                class="w-full bg-coral-500 hover:bg-coral-600 text-white font-extrabold text-xs py-3.5 rounded-2xl shadow-[0_8px_20px_-6px_rgba(232,109,88,0.5)] transition-all flex items-center justify-center gap-2">
                            <span id="savePasswordBtnText">Update Password</span>
                        </button>
                    </form>
                </div>

            </div>
        </div>

        <!-- Drawer Footer -->
        <div class="p-5 border-t border-gray-100 bg-[#F8F8FA] flex items-center justify-between">
            <div>
                <p class="text-[10px] font-bold text-gray-400 uppercase">Session Status</p>
                <p class="text-[11px] font-extrabold text-emerald-600 flex items-center gap-1.5 mt-0.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Authenticated
                </p>
            </div>
            <button onclick="handleLogout()" class="px-4 py-2.5 rounded-full bg-red-50 hover:bg-red-100 text-red-600 text-xs font-extrabold flex items-center gap-1.5 transition-colors">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                Sign Out
            </button>
        </div>

    </aside>
    `;

    // Password Update Form Handler
    const pwdForm = document.getElementById('changePasswordForm');
    if (pwdForm) {
        pwdForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newPassword = document.getElementById('newPasswordInput').value;
            const confirmPassword = document.getElementById('confirmPasswordInput').value;
            const alertBox = document.getElementById('passwordAlertBox');
            const btn = document.getElementById('savePasswordBtn');
            const btnText = document.getElementById('savePasswordBtnText');

            if (newPassword !== confirmPassword) {
                alertBox.className = 'p-3.5 rounded-2xl text-xs font-bold border bg-red-50 text-red-600 border-red-100 block';
                alertBox.textContent = 'Passwords do not match. Please check and try again.';
                return;
            }

            btn.disabled = true;
            btnText.textContent = 'Updating Security Credentials...';
            alertBox.classList.add('hidden');

            try {
                const token = localStorage.getItem('cargo_auth_token');
                const res = await fetch('/api/profile', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ newPassword })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to update password');

                alertBox.className = 'p-3.5 rounded-2xl text-xs font-bold border bg-emerald-50 text-emerald-700 border-emerald-100 block';
                alertBox.textContent = '✓ Password updated! Your new credentials are now active.';
                pwdForm.reset();
            } catch (err) {
                alertBox.className = 'p-3.5 rounded-2xl text-xs font-bold border bg-red-50 text-red-600 border-red-100 block';
                alertBox.textContent = err.message;
            } finally {
                btn.disabled = false;
                btnText.textContent = 'Update Password';
            }
        });
    }
});

function formatRoleTitle(role) {
    if (!role) return 'Employee';
    return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatBranchTitle(branch, role) {
    if (role === 'super_admin' || !branch || branch.toLowerCase() === 'global') {
        return 'Global (
