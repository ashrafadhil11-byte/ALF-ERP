// File: admin/widgets/widget-manager.js
window.CargoWidgetRegistry = window.CargoWidgetRegistry || [];

window.registerCargoWidget = function(widgetConfig) {
    const existingIndex = window.CargoWidgetRegistry.findIndex(w => w.id === widgetConfig.id);
    if (existingIndex > -1) {
        window.CargoWidgetRegistry[existingIndex] = widgetConfig;
    } else {
        window.CargoWidgetRegistry.push(widgetConfig);
    }
};

const LOCAL_CACHE_KEY = 'alfarha_super_layout_v2';
let isEditMode = false;
let currentLayout = []; // Array of { id, size: '2x2' }
let draggedWidgetId = null;

// Build Default Layout from Registry
function getDefaultLayout() {
    return window.CargoWidgetRegistry.map(w => ({
        id: w.id,
        size: w.defaultSize || '1x2'
    }));
}

// Reconcile layout with any newly added widget files
function normalizeLayout(savedConfig) {
    if (!savedConfig || !Array.isArray(savedConfig.items)) {
        return { items: getDefaultLayout(), removed: [] };
    }
    const items = [...savedConfig.items];
    const removed = Array.isArray(savedConfig.removed) ? [...savedConfig.removed] : [];

    window.CargoWidgetRegistry.forEach(w => {
        const existsInItems = items.some(item => item.id === w.id);
        const isRemoved = removed.includes(w.id);
        if (!existsInItems && !isRemoved) {
            items.push({ id: w.id, size: w.defaultSize || '1x2' });
        }
    });

    return { items, removed };
}

let layoutState = { items: [], removed: [] };

// Save to Local Cache & Cloud Supabase Database
async function persistLayoutToCloud() {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(layoutState));
    const syncBadge = document.getElementById('cloudSyncStatus');
    if (syncBadge) {
        syncBadge.textContent = 'Saving...';
        syncBadge.className = 'text-[10px] font-bold text-coral-500 hidden sm:inline';
    }

    const token = localStorage.getItem('cargo_auth_token');
    if (!token) return;

    try {
        const res = await fetch('/api/dashboard-layout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ config: layoutState })
        });
        if (res.ok && syncBadge) {
            syncBadge.textContent = 'Cloud Synced';
            syncBadge.className = 'text-[10px] font-bold text-emerald-600 hidden sm:inline';
        }
    } catch (e) {
        if (syncBadge) {
            syncBadge.textContent = 'Offline Saved';
            syncBadge.className = 'text-[10px] font-bold text-amber-500 hidden sm:inline';
        }
    }
}

// Load Layout from Supabase Cloud First (Falls back to local cache)
async function loadLayoutFromCloud() {
    // 1. Instant render from local cache if available
    const cached = localStorage.getItem(LOCAL_CACHE_KEY);
    if (cached) {
        try {
            layoutState = normalizeLayout(JSON.parse(cached));
            window.renderDashboardWidgets();
        } catch (e) {}
    } else {
        layoutState = normalizeLayout(null);
        window.renderDashboardWidgets();
    }

    // 2. Fetch authoritative cloud state from Supabase (works even after clearing localStorage or switching PCs)
    const token = localStorage.getItem('cargo_auth_token');
    if (!token) return;

    try {
        const res = await fetch('/api/dashboard-layout', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.config) {
                layoutState = normalizeLayout(data.config);
                localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(layoutState));
                window.renderDashboardWidgets();
            } else {
                // First time cloud sync
                await persistLayoutToCloud();
            }
        }
    } catch (e) {}
}

// Convert '2x3' -> { cols: 2, rows: 3 }
function parseSize(sizeStr) {
    const [cols, rows] = (sizeStr || '1x2').split('x').map(Number);
    return { cols: cols || 1, rows: rows || 2 };
}

// Main Render Function
window.renderDashboardWidgets = function() {
    const grid = document.getElementById('widgets-grid');
    if (!grid) return;

    if (!layoutState.items || layoutState.items.length === 0) {
        if (!layoutState.removed || layoutState.removed.length === 0) {
            layoutState = normalizeLayout(null);
        }
    }

    const activeItems = layoutState.items
        .map(item => {
            const def = window.CargoWidgetRegistry.find(w => w.id === item.id);
            return def ? { ...item, def } : null;
        })
        .filter(Boolean);

    if (activeItems.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: span 4; grid-row: span 2;" class="bg-white rounded-[2rem] p-12 text-center border border-dashed border-gray-300 flex flex-col items-center justify-center">
                <p class="text-base font-bold text-gray-900 mb-1">Your Super Admin Canvas is Empty</p>
                <p class="text-xs text-gray-400 mb-5">Add widgets from the catalog to build your custom workspace.</p>
                <button onclick="openWidgetModal()" class="bg-coral-500 hover:bg-coral-600 text-white text-xs font-bold px-6 py-3 rounded-full shadow-sm transition-colors">
                    + Add Widgets
                </button>
            </div>
        `;
    } else {
        grid.innerHTML = activeItems.map(({ id, size, def }) => {
            const { cols, rows } = parseSize(size);
            const allowedSizes = def.allowedSizes || ['1x1', '1x2', '2x1', '2x2', '2x3', '3x2', '4x2'];

            return `
                <div class="widget-cell relative transition-all duration-300 select-none ${isEditMode ? 'customize-active ring-2 ring-coral-500/80 rounded-[2rem] shadow-lg' : ''}"
                     data-widget-id="${id}"
                     data-widget-size="${size}"
                     style="--w-cols: ${cols}; --w-rows: ${rows};"
                     ${isEditMode ? `draggable="true" ondragstart="handleDragStart(event, '${id}')" ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${id}')" ondragend="handleDragEnd(event)"` : ''}>

                    ${isEditMode ? `
                        <!-- SMARTPHONE CUSTOMIZE OVERLAY BAR (Only visible in Customize Mode) -->
                        <div class="absolute -top-3 left-3 right-3 z-30 flex items-center justify-between bg-[#111827] text-white px-3 py-1.5 rounded-full shadow-xl border border-gray-700">
                            <!-- Drag Handle & Current Dimensions -->
                            <div class="flex items-center gap-1.5 cursor-grab active:cursor-grabbing">
                                <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8h16M4 16h16"></path></svg>
                                <span class="text-[10px] font-extrabold text-coral-400 uppercase tracking-wider">${size.replace('x', '×')}</span>
                            </div>

                            <!-- Quick Smartphone Size Pills (2x2, 2x3, etc.) -->
                            <div class="flex items-center gap-1 overflow-x-auto max-w-[180px] no-scrollbar">
                                ${allowedSizes.map(s => `
                                    <button type="button" onclick="changeWidgetSize('${id}', '${s}')"
                                        class="px-1.5 py-0.5 rounded text-[9px] font-extrabold transition-colors ${s === size ? 'bg-coral-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}">
                                        ${s.replace('x', '×')}
                                    </button>
                                `).join('')}
                            </div>

                            <!-- Remove Widget Button -->
                            <button type="button" onclick="removeWidget('${id}')" title="Remove Widget"
                                class="w-5 h-5 rounded-full bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white flex items-center justify-center transition-colors ml-1 flex-shrink-0">
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        <!-- BOTTOM-RIGHT CORNER DRAG-TO-RESIZE HANDLE -->
                        <div onmousedown="startCornerResize(event, '${id}')"
                             title="Drag corner to resize (2×2, 2×3...)"
                             class="absolute bottom-2 right-2 z-30 w-7 h-7 rounded-full bg-[#111827] text-white flex items-center justify-center cursor-nwse-resize shadow-md hover:bg-coral-500 transition-colors">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M4 14h6m0 0v6m0-6L3 21M20 10h-6m0 0V4m0 6l7-7"></path>
                            </svg>
                        </div>
                    ` : ''}

                    <!-- Widget Inner Adaptive Content -->
                    <div class="w-full h-full overflow-hidden rounded-[2rem] ${isEditMode ? 'pointer-events-none opacity-95' : ''}">
                        ${def.render(size)}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderWidgetCatalogModal();
    updateActiveCountBadge();
};

// Change Widget Size (e.g. '2x2' -> '2x3')
window.changeWidgetSize = function(widgetId, newSize) {
    if (!isEditMode) return;
    const item = layoutState.items.find(i => i.id === widgetId);
    if (item) {
        item.size = newSize;
        window.renderDashboardWidgets();
        persistLayoutToCloud();
    }
};

// Interactive Corner Drag-to-Resize (Snaps to Smartphone Grid Units)
window.startCornerResize = function(e, widgetId) {
    if (!isEditMode) return;
    e.stopPropagation();
    e.preventDefault();

    const cell = document.querySelector(`[data-widget-id="${widgetId}"]`);
    const grid = document.getElementById('widgets-grid');
    if (!cell || !grid) return;

    const def = window.CargoWidgetRegistry.find(w => w.id === widgetId);
    const allowedSizes = def?.allowedSizes || ['1x1', '1x2', '2x1', '2x2', '2x3', '3x2', '4x2'];

    const rect = cell.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const colWidth = gridRect.width / 4;
    const rowHeight = 195; // 180px row + gap

    function onMouseMove(moveEvent) {
        const deltaX = moveEvent.clientX - rect.left;
        const deltaY = moveEvent.clientY - rect.top;

        let targetCols = Math.max(1, Math.min(4, Math.round(deltaX / colWidth)));
        let targetRows = Math.max(1, Math.min(3, Math.round(deltaY / rowHeight)));
        const candidateSize = `${targetCols}x${targetRows}`;

        // Snap to closest allowed size for this widget
        let bestSize = allowedSizes.includes(candidateSize) ? candidateSize : null;
        if (!bestSize) {
            bestSize = allowedSizes.reduce((prev, curr) => {
                const p = parseSize(prev);
                const c = parseSize(curr);
                const prevDist = Math.hypot(p.cols - targetCols, p.rows - targetRows);
                const currDist = Math.hypot(c.cols - targetCols, c.rows - targetRows);
                return currDist < prevDist ? curr : prev;
            });
        }

        const item = layoutState.items.find(i => i.id === widgetId);
        if (item && item.size !== bestSize) {
            item.size = bestSize;
            window.renderDashboardWidgets();
        }
    }

    function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        persistLayoutToCloud();
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
};

// HTML5 Drag & Drop Reordering (Strictly in Customize Mode)
window.handleDragStart = function(e, widgetId) {
    if (!isEditMode) {
        e.preventDefault();
        return;
    }
    draggedWidgetId = widgetId;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('opacity-50', 'scale-95');
};

window.handleDragOver = function(e) {
    if (!isEditMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
};

window.handleDrop = function(e, targetWidgetId) {
    if (!isEditMode) return;
    e.preventDefault();
    if (!draggedWidgetId || draggedWidgetId === targetWidgetId) return;

    const fromIndex = layoutState.items.findIndex(i => i.id === draggedWidgetId);
    const toIndex = layoutState.items.findIndex(i => i.id === targetWidgetId);

    if (fromIndex > -1 && toIndex > -1) {
        const [movedItem] = layoutState.items.splice(fromIndex, 1);
        layoutState.items.splice(toIndex, 0, movedItem);
        window.renderDashboardWidgets();
        persistLayoutToCloud();
    }
    draggedWidgetId = null;
};

window.handleDragEnd = function(e) {
    e.currentTarget.classList.remove('opacity-50', 'scale-95');
    draggedWidgetId = null;
};

// Add or Remove Widgets
window.toggleWidget = function(widgetId) {
    const existingIndex = layoutState.items.findIndex(i => i.id === widgetId);
    const def = window.CargoWidgetRegistry.find(w => w.id === widgetId);

    if (existingIndex > -1) {
        layoutState.items.splice(existingIndex, 1);
        if (!layoutState.removed.includes(widgetId)) layoutState.removed.push(widgetId);
    } else {
        layoutState.items.push({ id: widgetId, size: def?.defaultSize || '1x2' });
        layoutState.removed = layoutState.removed.filter(id => id !== widgetId);
    }

    window.renderDashboardWidgets();
    persistLayoutToCloud();
};

window.removeWidget = function(widgetId) {
    if (!isEditMode) return; // Strictly locked outside Customize mode
    layoutState.items = layoutState.items.filter(i => i.id !== widgetId);
    if (!layoutState.removed.includes(widgetId)) layoutState.removed.push(widgetId);
    window.renderDashboardWidgets();
    persistLayoutToCloud();
};

window.resetDefaultWidgets = function() {
    layoutState = { items: getDefaultLayout(), removed: [] };
    window.renderDashboardWidgets();
    persistLayoutToCloud();
};

// Toggle Customize Mode
window.toggleEditLayoutMode = function() {
    isEditMode = !isEditMode;
    const btn = document.getElementById('editLayoutBtn');
    const banner = document.getElementById('customize-mode-banner');

    if (btn) {
        if (isEditMode) {
            btn.className = 'bg-coral-500 hover:bg-coral-600 text-white px-5 py-2.5 rounded-full text-xs font-extrabold flex items-center gap-2 shadow-md transition-all';
            btn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg><span>Done Customizing</span>`;
        } else {
            btn.className = 'bg-[#F8F8FA] hover:bg-gray-100 text-gray-800 px-4 py-2.5 rounded-full border border-gray-200/60 text-xs font-bold flex items-center gap-2 transition-all';
            btn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg><span>Customize</span>`;
        }
    }

    if (banner) {
        banner.classList.toggle('hidden', !isEditMode);
        banner.classList.toggle('flex', isEditMode);
    }

    window.renderDashboardWidgets();
};

window.openWidgetModal = function() {
    const modal = document.getElementById('widget-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        renderWidgetCatalogModal();
    }
};

window.closeWidgetModal = function() {
    const modal = document.getElementById('widget-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

function updateActiveCountBadge() {
    const badge = document.getElementById('active-widget-count');
    if (badge) {
        badge.textContent = `${layoutState.items.length}/${window.CargoWidgetRegistry.length}`;
    }
}

function renderWidgetCatalogModal() {
    const listContainer = document.getElementById('widget-catalog-list');
    if (!listContainer) return;

    listContainer.innerHTML = window.CargoWidgetRegistry.map(widget => {
        const activeItem = layoutState.items.find(i => i.id === widget.id);
        const isActive = Boolean(activeItem);
        const currentSize = activeItem ? activeItem.size : (widget.defaultSize || '1x2');

        return `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl border gap-3 ${isActive ? 'bg-white border-gray-200 shadow-sm' : 'bg-gray-50/70 border-gray-100 opacity-75'} transition-all">
                <div class="pr-2">
                    <div class="flex items-center gap-2">
                        <h4 class="text-sm font-bold text-gray-900">${widget.title}</h4>
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 uppercase">${widget.category}</span>
                        <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-coral-50 text-coral-600">${currentSize.replace('x', '×')}</span>
                    </div>
                    <p class="text-xs text-gray-400 mt-1">${widget.description}</p>
                </div>
                <button onclick="toggleWidget('${widget.id}')" 
                    class="px-4 py-2 rounded-full text-xs font-bold transition-all flex-shrink-0 ${
                        isActive 
                        ? 'bg-coral-50 text-coral-600 hover:bg-coral-100' 
                        : 'bg-[#111827] text-white hover:bg-gray-800 shadow-sm'
                    }">
                    ${isActive ? 'Remove' : '+ Add Widget'}
                </button>
            </div>
        `;
    }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
    loadLayoutFromCloud();
});
