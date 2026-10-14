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

const STORAGE_KEY = 'alfarha_super_dashboard_widgets_v1';
const REMOVED_KEY = 'alfarha_super_dashboard_removed_v1';
let isEditMode = false;

function getExplicitlyRemovedIds() {
    try {
        return JSON.parse(localStorage.getItem(REMOVED_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function saveExplicitlyRemovedIds(ids) {
    localStorage.setItem(REMOVED_KEY, JSON.stringify(ids));
}

// Get active widget IDs and auto-include any newly created widget files
function getActiveWidgetIds() {
    const allRegisteredIds = window.CargoWidgetRegistry.map(w => w.id);
    const removedIds = getExplicitlyRemovedIds();
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
        try {
            let activeIds = JSON.parse(saved);
            // Automatically add any newly registered widget that wasn't explicitly removed
            allRegisteredIds.forEach(id => {
                if (!activeIds.includes(id) && !removedIds.includes(id)) {
                    activeIds.push(id);
                }
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(activeIds));
            return activeIds;
        } catch (e) {}
    }
    return allRegisteredIds;
}

function saveActiveWidgetIds(ids) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

window.renderDashboardWidgets = function() {
    const grid = document.getElementById('widgets-grid');
    if (!grid) return;

    const activeIds = getActiveWidgetIds();
    const activeWidgets = activeIds
        .map(id => window.CargoWidgetRegistry.find(w => w.id === id))
        .filter(Boolean);

    if (activeWidgets.length === 0) {
        grid.innerHTML = `
            <div class="col-span-12 bg-white rounded-[2rem] p-12 text-center border border-dashed border-gray-300">
                <p class="text-base font-bold text-gray-900 mb-1">No widgets active on your dashboard</p>
                <p class="text-xs text-gray-400 mb-5">Click below to add operational or financial cards back to your view.</p>
                <button onclick="openWidgetModal()" class="bg-coral-500 hover:bg-coral-600 text-white text-xs font-bold px-6 py-3 rounded-full shadow-sm transition-colors">
                    + Add Widgets
                </button>
            </div>
        `;
    } else {
        grid.innerHTML = activeWidgets.map(widget => `
            <div class="${widget.colSpan} relative group transition-all duration-200 ${isEditMode ? 'ring-2 ring-coral-400 ring-offset-2 ring-offset-[#F8F8FA] rounded-[2rem]' : ''}" data-widget-id="${widget.id}">
                <button onclick="removeWidget('${widget.id}')" 
                    title="Remove ${widget.title}"
                    class="${isEditMode ? 'flex' : 'hidden group-hover:flex'} absolute -top-2.5 -right-2.5 z-30 w-7 h-7 rounded-full bg-gray-900 hover:bg-coral-500 text-white items-center justify-center shadow-md transition-all">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
                ${widget.render()}
            </div>
        `).join('');
    }

    renderWidgetCatalogModal();
    updateActiveCountBadge();
};

window.toggleWidget = function(widgetId) {
    let activeIds = getActiveWidgetIds();
    let removedIds = getExplicitlyRemovedIds();

    if (activeIds.includes(widgetId)) {
        activeIds = activeIds.filter(id => id !== widgetId);
        if (!removedIds.includes(widgetId)) removedIds.push(widgetId);
    } else {
        activeIds.push(widgetId);
        removedIds = removedIds.filter(id => id !== widgetId);
    }

    saveExplicitlyRemovedIds(removedIds);
    saveActiveWidgetIds(activeIds);
    window.renderDashboardWidgets();
};

window.removeWidget = function(widgetId) {
    let activeIds = getActiveWidgetIds().filter(id => id !== widgetId);
    let removedIds = getExplicitlyRemovedIds();
    if (!removedIds.includes(widgetId)) removedIds.push(widgetId);

    saveExplicitlyRemovedIds(removedIds);
    saveActiveWidgetIds(activeIds);
    window.renderDashboardWidgets();
};

window.resetDefaultWidgets = function() {
    const allIds = window.CargoWidgetRegistry.map(w => w.id);
    saveExplicitlyRemovedIds([]);
    saveActiveWidgetIds(allIds);
    window.renderDashboardWidgets();
};

window.toggleEditLayoutMode = function() {
    isEditMode = !isEditMode;
    const btn = document.getElementById('editLayoutBtn');
    if (btn) {
        btn.innerHTML = isEditMode 
            ? `<span class="w-2 h-2 rounded-full bg-coral-500 animate-ping"></span> Done Editing`
            : `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg> Customize`;
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
        const activeIds = getActiveWidgetIds();
        badge.textContent = `${activeIds.length}/${window.CargoWidgetRegistry.length}`;
    }
}

function renderWidgetCatalogModal() {
    const listContainer = document.getElementById('widget-catalog-list');
    if (!listContainer) return;

    const activeIds = getActiveWidgetIds();

    listContainer.innerHTML = window.CargoWidgetRegistry.map(widget => {
        const isActive = activeIds.includes(widget.id);
        return `
            <div class="flex items-center justify-between p-4 rounded-2xl border ${isActive ? 'bg-white border-gray-200 shadow-sm' : 'bg-gray-50/70 border-gray-100 opacity-75'} transition-all">
                <div class="pr-4">
                    <div class="flex items-center gap-2">
                        <h4 class="text-sm font-bold text-gray-900">${widget.title}</h4>
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 uppercase">${widget.category}</span>
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
    window.renderDashboardWidgets();
});
