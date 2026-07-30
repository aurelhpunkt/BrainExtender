// --- APP STATE ---
let chats = [];
let activeChatId = null;
let currentChatRole = 'standard';
let selectedRole = 'standard';
let selectedTone = 'neutral';
let pendingFiles = [];
let lastGeneratedMemoryHtml = "";
let currentAbortController = null;
let isMicActive = false;
let isSpeakerActive = false;
let isHandsFreeActive = false;
let currentVoiceSpeed = 1.0;
const VOICE_SPEEDS = [1.0, 1.25, 1.5, 2.0];
let globalRoles = {};

// --- DOM ELEMENTS ---
const elements = {
  // Sidebar
  btnNewChat: document.getElementById('btn-new-chat'),
  btnDashboard: document.getElementById('btn-dashboard'),
  chatsList: document.getElementById('chats-list'),
  memoryCount: document.getElementById('memory-count'),
  
  // Footer buttons
  btnOpenMemory: document.getElementById('btn-open-memory'),
  btnOpenImport: document.getElementById('btn-open-import'),
  btnOpenSettings: document.getElementById('btn-open-settings'),
  
  // Workspace States
  stateWelcome: document.getElementById('state-welcome'),
  stateChat: document.getElementById('state-chat'),
  stateDashboard: document.getElementById('state-dashboard'),
  
  // Setup Welcome View
  presetCards: document.querySelectorAll('.preset-card'),
  chatTitleInput: document.getElementById('chat-title-input'),
  btnStartChat: document.getElementById('btn-start-chat'),
  
  // Chat View
  activeChatTitle: document.getElementById('active-chat-title'),
  badgeRole: document.getElementById('badge-role'),
  badgeTone: document.getElementById('badge-tone'),
  btnDeleteChat: document.getElementById('btn-delete-chat'),
  btnHandover: document.getElementById('btn-handover'),
  messagesContainer: document.getElementById('messages-container'),
  uploadPreviewBar: document.getElementById('upload-preview-bar'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  btnSend: document.getElementById('btn-send'),
  btnStop: document.getElementById('btn-stop'),
  btnAttach: document.getElementById('btn-attach'),
  btnHandsfree: document.getElementById('btn-handsfree'),
  btnMic: document.getElementById('btn-mic'),
  btnSpeaker: document.getElementById('btn-speaker'),
  btnVoiceSpeed: document.getElementById('btn-voice-speed'),
  fileInput: document.getElementById('file-input'),
  toggleMemory: document.getElementById('toggle-memory'),
  toggleLearn: document.getElementById('toggle-learn'),
  toggleVogelperspektive: document.getElementById('toggle-vogelperspektive'),
  toggleWebSearch: document.getElementById('toggle-web-search'),
  
  // Settings Modal
  modalSettings: document.getElementById('modal-settings'),
  settingsApiKey: document.getElementById('settings-api-key'),
  btnSaveKey: document.getElementById('btn-save-key'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  apiStatusBox: document.getElementById('api-status-box'),
  btnConnectCalendar: document.getElementById('btn-connect-calendar'),
  btnDisconnectCalendar: document.getElementById('btn-disconnect-calendar'),
  calendarStatusDot: document.getElementById('calendar-status-dot'),
  calendarStatusText: document.getElementById('calendar-status-text'),
  
  // Memory Modal
  modalMemory: document.getElementById('modal-memory'),
  btnCloseMemory: document.getElementById('btn-close-memory'),
  memorySearchInput: document.getElementById('memory-search-input'),
  memoryTableBody: document.getElementById('memory-table-body'),
  emptyMemoryMsg: document.getElementById('empty-memory-msg'),
  btnClearAllMemory: document.getElementById('btn-clear-all-memory'),
  
  // Import Modal
  modalImport: document.getElementById('modal-import'),
  btnCloseImport: document.getElementById('btn-close-import'),
  
  // Roles Modal
  btnManageRoles: document.getElementById('btn-manage-roles'),
  modalRoles: document.getElementById('modal-roles'),
  btnCloseRoles: document.getElementById('btn-close-roles'),
  btnResetRoles: document.getElementById('btn-reset-roles'),
  btnAddRoleTrigger: document.getElementById('btn-add-role-trigger'),
  rolesTableBody: document.getElementById('roles-table-body'),
  roleFormContainer: document.getElementById('role-form-container'),
  roleFormTitle: document.getElementById('role-form-title'),
  roleForm: document.getElementById('role-form'),
  roleKeyInput: document.getElementById('role-key'),
  roleTitleInput: document.getElementById('role-title'),
  roleIconInput: document.getElementById('role-icon'),
  roleContextInput: document.getElementById('role-context'),
  roleTemperatureInput: document.getElementById('role-temperature'),
  roleTempValText: document.getElementById('role-temp-val'),
  roleDescriptionInput: document.getElementById('role-description'),
  rolePromptInput: document.getElementById('role-prompt'),
  btnCancelRoleForm: document.getElementById('btn-cancel-role-form'),
  btnSaveRole: document.getElementById('btn-save-role'),
  dragDropZone: document.getElementById('drag-drop-zone'),
  importFileInput: document.getElementById('import-file-input'),
  importProgressContainer: document.getElementById('import-progress-container'),
  importStatusText: document.getElementById('import-status-text'),
  importPercentText: document.getElementById('import-percent-text'),
  importProgressBar: document.getElementById('import-progress-bar'),
  whatsappHint: document.getElementById('whatsapp-hint'),
  toggleAnalyzeImages: document.getElementById('toggle-analyze-images'),
  chatModelSelect: document.getElementById('chat-model-select'),
  badgeModel: document.getElementById('badge-model'),

  // Confirm Dialog
  modalConfirm: document.getElementById('modal-confirm'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmMessage: document.getElementById('confirm-message'),
  btnConfirmOk: document.getElementById('btn-confirm-ok'),
  btnConfirmCancel: document.getElementById('btn-confirm-cancel')
};

// Role Translation Map (loaded dynamically from server)
let ROLE_NAMES = {};

// --- CONFIRM DIALOG HELPER ---
// Returns a Promise that resolves true (confirmed) or false (cancelled).
function showConfirmDialog(message, title = 'Bist du sicher?') {
  return new Promise((resolve) => {
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.modalConfirm.showModal();

    function onOk() {
      elements.modalConfirm.close();
      cleanup();
      resolve(true);
    }
    function onCancel() {
      elements.modalConfirm.close();
      cleanup();
      resolve(false);
    }
    function onBackdrop(e) {
      if (e.target === elements.modalConfirm) {
        onCancel();
      }
    }
    function cleanup() {
      elements.btnConfirmOk.removeEventListener('click', onOk);
      elements.btnConfirmCancel.removeEventListener('click', onCancel);
      elements.modalConfirm.removeEventListener('click', onBackdrop);
    }

    elements.btnConfirmOk.addEventListener('click', onOk);
    elements.btnConfirmCancel.addEventListener('click', onCancel);
    elements.modalConfirm.addEventListener('click', onBackdrop);
  });
}

const TONE_NAMES = {
  neutral: 'Sachlich',
  analyse: 'Knallharte Analyse',
  motivation: 'Motivierend',
  unbestechlich: 'Unbestechlich'
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  initEventListeners();
  checkApiConfig();
  checkCalendarStatus();
  updateMemoryCount();
  await loadRoles();
  loadStats();
  await loadGlobalRoles();
  await loadModels();
  await loadChats();
  setInterval(loadChats, 5000); // Poll for updates from other sessions
});

async function loadGlobalRoles() {
  try {
    const res = await fetch('/api/roles');
    if (res.ok) {
      globalRoles = await res.json();
    }
  } catch (err) {
    console.error("Failed to load global roles:", err);
  }
}

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    if (res.ok) {
      const models = await res.json();
      populateModelDropdowns(models);
    }
  } catch (err) {
    console.error("Failed to load models:", err);
  }
}

function populateModelDropdowns(models) {
  const optionsHtml = models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  const customOption = `<option value="custom" class="custom-model-option" style="font-weight: bold; color: var(--color-accent);">[ + Eigenes Modell hinzufügen... ]</option>`;
  
  if (elements.chatModelSelect) {
    const currentVal = elements.chatModelSelect.value;
    elements.chatModelSelect.innerHTML = optionsHtml + customOption;
    if (currentVal && currentVal !== 'custom') elements.chatModelSelect.value = currentVal;
    else elements.chatModelSelect.value = 'gemini-2.5-pro';
  }
  
  if (elements.badgeModel) {
    const currentVal = elements.badgeModel.value;
    elements.badgeModel.innerHTML = optionsHtml + customOption;
    if (currentVal && currentVal !== 'custom') elements.badgeModel.value = currentVal;
  }
}

// --- API CONFIGURATION ---
async function checkApiConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    updateApiStatus(data.hasApiKey);
  } catch (err) {
    console.error("Config check failed:", err);
  }
}

function updateApiStatus(hasKey) {
  const dot = elements.apiStatusBox.querySelector('.status-dot');
  const text = elements.apiStatusBox.querySelector('.status-text');
  
  if (hasKey) {
    dot.className = 'status-dot online';
    text.textContent = 'API-Key konfiguriert';
  } else {
    dot.className = 'status-dot offline';
    text.textContent = 'Kein API-Key konfiguriert';
  }
}

async function checkCalendarStatus() {
  try {
    const res = await fetch('/api/calendar/status');
    const data = await res.json();
    
    const dot = elements.calendarStatusDot;
    const text = elements.calendarStatusText;
    const btnConnect = elements.btnConnectCalendar;
    const btnDisconnect = elements.btnDisconnectCalendar;
    
    if (!dot || !text || !btnConnect || !btnDisconnect) return;
    
    if (!data.configured) {
      dot.className = 'status-dot offline';
      text.innerHTML = 'Nicht konfiguriert (Client ID/Secret fehlen in <code>.env</code>)';
      btnConnect.style.display = 'none';
      btnDisconnect.style.display = 'none';
    } else if (data.connected) {
      dot.className = 'status-dot online';
      text.textContent = `Verbunden (${data.email})`;
      btnConnect.style.display = 'none';
      btnDisconnect.style.display = 'block';
    } else {
      dot.className = 'status-dot offline';
      text.textContent = data.error ? `Fehler: ${data.error}` : 'Nicht verknüpft';
      btnConnect.style.display = 'block';
      btnDisconnect.style.display = 'none';
    }
  } catch (err) {
    console.error("Calendar status check failed:", err);
    if (elements.calendarStatusDot) elements.calendarStatusDot.className = 'status-dot offline';
    if (elements.calendarStatusText) elements.calendarStatusText.textContent = 'Verbindungsfehler';
  }
}

function connectCalendar() {
  const width = 500;
  const height = 650;
  const left = (window.screen.width / 2) - (width / 2);
  const top = (window.screen.height / 2) - (height / 2);
  
  const popup = window.open(
    '/api/calendar/auth',
    'GoogleCalendarAuth',
    `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
  );
  
  if (popup) {
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        checkCalendarStatus();
      }
    }, 1000);
  } else {
    window.open('/api/calendar/auth', '_blank');
  }
}

async function disconnectCalendar() {
  if (!confirm("Möchten Sie die Google Kalender Verknüpfung wirklich aufheben?")) {
    return;
  }
  
  try {
    const res = await fetch('/api/calendar/disconnect', { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      checkCalendarStatus();
    } else {
      alert("Fehler beim Trennen: " + (data.error || "Unbekannter Fehler"));
    }
  } catch (err) {
    console.error("Disconnect calendar failed:", err);
    alert("Verbindungsfehler beim Aufheben der Verknüpfung.");
  }
}

let dynamicRoles = {};

async function loadRoles() {
  try {
    const res = await fetch('/api/roles');
    const data = await res.json();
    dynamicRoles = data;

    // Repopulate ROLE_NAMES dynamically
    ROLE_NAMES = {};
    for (const key in data) {
      ROLE_NAMES[key] = data[key].title;
    }

    renderRolesGrid();
    renderRolesList();
  } catch (err) {
    console.error("Failed to load roles:", err);
  }
}

function renderRolesGrid() {
  const grid = document.getElementById('setup-role-grid');
  if (!grid) return;

  grid.innerHTML = '';
  
  for (const key in dynamicRoles) {
    const role = dynamicRoles[key];
    const card = document.createElement('div');
    card.className = `preset-card${key === selectedRole ? ' active' : ''}`;
    card.dataset.role = key;
    card.innerHTML = `
      <div class="preset-icon"><i class="fa-solid ${role.icon || 'fa-user'}"></i></div>
      <h5>${role.title}</h5>
      <p>${role.description}</p>
    `;
    grid.appendChild(card);
  }
}

function renderRolesList() {
  const tableBody = elements.rolesTableBody;
  if (!tableBody) return;

  tableBody.innerHTML = '';

  for (const key in dynamicRoles) {
    const role = dynamicRoles[key];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid ${role.icon || 'fa-user'}" style="color: var(--color-primary); width: 16px;"></i>
          <strong>${role.title}</strong>
        </div>
        <small style="color: var(--color-text-muted); display: block; font-size: 11px;">Key: ${key}</small>
        ${role.isSystem ? '<span class="badge" style="background-color: hsla(260, 85%, 62%, 0.15); color: hsl(260, 85%, 75%); font-size: 10px; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px;">System</span>' : '<span class="badge" style="background-color: hsla(142, 70%, 45%, 0.15); color: hsl(142, 70%, 55%); font-size: 10px; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px;">Eigener</span>'}
      </td>
      <td>
        <div style="font-weight: 500; font-size: 11px; color: var(--color-text-title);">${role.description}</div>
        <div class="help-text" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px; margin-top: 4px;" title="${role.systemPrompt.replace(/"/g, '&quot;')}">Prompt: ${role.systemPrompt}</div>
      </td>
      <td style="text-align: center;">
        <span style="font-family: monospace; font-size: 13px; font-weight: 600; color: ${role.temperature <= 0.3 ? 'var(--color-emerald)' : 'var(--color-text-body)'}">${role.temperature.toFixed(1)}</span>
      </td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-edit-role" data-key="${key}" style="padding: 4px 8px; font-size: 11px;">
            <i class="fa-solid fa-pen"></i> Bearbeiten
          </button>
          ${role.isSystem ? '' : `
            <button class="btn btn-danger btn-delete-role" data-key="${key}" style="padding: 4px 8px; font-size: 11px;">
              <i class="fa-solid fa-trash"></i> Löschen
            </button>
          `}
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
  }
}

let currentEditingRoleKey = null;

function openRolesManager() {
  elements.modalRoles.showModal();
  hideRoleForm();
  renderRolesList();
}

function closeRolesManager() {
  elements.modalRoles.close();
}

function showRoleForm(editKey = null) {
  currentEditingRoleKey = editKey;
  const container = elements.roleFormContainer;
  const title = elements.roleFormTitle;
  
  if (!container || !title) return;
  
  container.style.display = 'block';
  
  if (editKey) {
    title.textContent = 'Rolle bearbeiten';
    const role = dynamicRoles[editKey];
    elements.roleKeyInput.value = editKey;
    elements.roleKeyInput.disabled = true;
    elements.roleTitleInput.value = role.title;
    elements.roleIconInput.value = role.icon || 'fa-user';
    if (elements.roleContextInput) {
      elements.roleContextInput.value = role.contextStrategy || '30';
    }
    elements.roleTemperatureInput.value = role.temperature;
    elements.roleTempValText.textContent = role.temperature.toFixed(1);
    elements.roleDescriptionInput.value = role.description;
    elements.rolePromptInput.value = role.systemPrompt;
  } else {
    title.textContent = 'Rolle hinzufügen';
    elements.roleKeyInput.value = '';
    elements.roleKeyInput.disabled = false;
    elements.roleTitleInput.value = '';
    elements.roleIconInput.value = 'fa-user';
    if (elements.roleContextInput) {
      elements.roleContextInput.value = '30';
    }
    elements.roleTemperatureInput.value = '0.7';
    elements.roleTempValText.textContent = '0.7';
    elements.roleDescriptionInput.value = '';
    elements.rolePromptInput.value = '';
  }

  container.scrollIntoView({ behavior: 'smooth' });
}

function hideRoleForm() {
  if (elements.roleFormContainer) elements.roleFormContainer.style.display = 'none';
  currentEditingRoleKey = null;
  if (elements.roleForm) elements.roleForm.reset();
}

async function submitRoleForm(e) {
  e.preventDefault();
  
  const payload = {
    key: elements.roleKeyInput.value,
    title: elements.roleTitleInput.value,
    icon: elements.roleIconInput.value,
    contextStrategy: elements.roleContextInput ? elements.roleContextInput.value : '30',
    temperature: parseFloat(elements.roleTemperatureInput.value),
    description: elements.roleDescriptionInput.value,
    systemPrompt: elements.rolePromptInput.value
  };

  const isEdit = !!currentEditingRoleKey;
  const url = isEdit ? `/api/roles/${currentEditingRoleKey}` : '/api/roles';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok) {
      hideRoleForm();
      await loadRoles();
    } else {
      alert("Fehler beim Speichern: " + (data.error || "Unbekannter Fehler"));
    }
  } catch (err) {
    console.error("Save role failed:", err);
    alert("Verbindungsfehler beim Speichern der Rolle.");
  }
}

async function deleteRole(key) {
  if (!confirm(`Möchten Sie die Rolle "${dynamicRoles[key].title}" wirklich löschen?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/roles/${key}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      if (selectedRole === key) {
        selectedRole = 'standard';
      }
      await loadRoles();
    } else {
      alert("Fehler beim Löschen: " + (data.error || "Unbekannter Fehler"));
    }
  } catch (err) {
    console.error("Delete role failed:", err);
    alert("Verbindungsfehler beim Löschen der Rolle.");
  }
}

async function resetRoles() {
  if (!confirm("Möchten Sie alle Rollen auf den Standardzustand zurücksetzen? Ihre eigenen Rollen gehen dabei verloren.")) {
    return;
  }

  try {
    const res = await fetch('/api/roles/reset', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      hideRoleForm();
      selectedRole = 'standard';
      await loadRoles();
    } else {
      alert("Fehler beim Zurücksetzen: " + (data.error || "Unbekannter Fehler"));
    }
  } catch (err) {
    console.error("Reset roles failed:", err);
    alert("Verbindungsfehler beim Zurücksetzen der Rollen.");
  }
}


async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    updateCostUI(data.monthlyCostUSD !== undefined ? data.monthlyCostUSD : data.totalCostUSD);
  } catch (err) {
    console.error("Failed to load cost stats:", err);
  }
}

function updateCostUI(costUSD) {
  const formattedCost = parseFloat(costUSD || 0).toFixed(4);
  const costVal = document.getElementById('cost-value');
  const welcomeCostVal = document.getElementById('welcome-cost-value');
  
  if (costVal) costVal.textContent = formattedCost;
  if (welcomeCostVal) welcomeCostVal.textContent = formattedCost;
}

// --- EVENT LISTENERS ---
function initEventListeners() {
  // Sidebar Nav
  elements.btnNewChat.addEventListener('click', () => {
    switchState('welcome');
    elements.chatTitleInput.value = '';
  });
  elements.btnDashboard.addEventListener('click', () => {
    switchState('dashboard');
  });

  // Role Switch / Handover
  elements.badgeRole.addEventListener('click', () => openHandoverModal('switch'));
  elements.btnHandover.addEventListener('click', () => openHandoverModal('handover'));

  // Intelligent Scroll-to-Stop TTS
  let lastScrollTop = 0;
  elements.messagesContainer.addEventListener('scroll', () => {
    const currentScrollTop = elements.messagesContainer.scrollTop;
    if (currentScrollTop < lastScrollTop - 10) {
      // User is scrolling up
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
    }
    lastScrollTop = currentScrollTop;
  });

  // Voice Toggles
  if (elements.btnHandsfree) {
    elements.btnHandsfree.addEventListener('click', toggleHandsFree);
  }
  if (elements.btnMic) {
    elements.btnMic.addEventListener('click', toggleMic);
  }
  if (elements.btnSpeaker) {
    elements.btnSpeaker.addEventListener('click', toggleSpeaker);
  }
  if (elements.btnVoiceSpeed) {
    elements.btnVoiceSpeed.addEventListener('click', toggleVoiceSpeed);
  }

  // Open modals
  elements.btnOpenSettings.addEventListener('click', () => {
    elements.modalSettings.showModal();
  });
  elements.btnOpenMemory.addEventListener('click', () => {
    elements.modalMemory.showModal();
    loadMemories();
  });
  elements.btnOpenImport.addEventListener('click', () => {
    elements.modalImport.showModal();
    resetImportProgress();
  });

  // Close modals
  elements.btnCloseSettings.addEventListener('click', () => elements.modalSettings.close());
  elements.btnCloseMemory.addEventListener('click', () => elements.modalMemory.close());
  elements.btnCloseImport.addEventListener('click', () => elements.modalImport.close());

  // Save Settings API Key
  elements.btnSaveKey.addEventListener('click', saveApiKey);

  // Google Calendar Connection Buttons
  elements.btnConnectCalendar.addEventListener('click', connectCalendar);
  elements.btnDisconnectCalendar.addEventListener('click', disconnectCalendar);

  // Setup Tone Preset Cards Selection
  document.querySelectorAll('.tone-grid .preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const parent = card.parentElement;
      parent.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedTone = card.dataset.tone;
    });
  });

  // Setup Dynamic Role Grid Selection (via Delegation)
  const roleGrid = document.getElementById('setup-role-grid');
  if (roleGrid) {
    roleGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.preset-card');
      if (!card) return;
      roleGrid.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedRole = card.dataset.role;
    });
  }

  // Roles Modal Controls
  if (elements.btnManageRoles) elements.btnManageRoles.addEventListener('click', openRolesManager);
  if (elements.btnCloseRoles) elements.btnCloseRoles.addEventListener('click', closeRolesManager);
  if (elements.btnResetRoles) elements.btnResetRoles.addEventListener('click', resetRoles);
  if (elements.btnAddRoleTrigger) elements.btnAddRoleTrigger.addEventListener('click', () => showRoleForm(null));
  if (elements.btnCancelRoleForm) elements.btnCancelRoleForm.addEventListener('click', hideRoleForm);
  if (elements.roleForm) elements.roleForm.addEventListener('submit', submitRoleForm);
  
  // Slider live value
  if (elements.roleTemperatureInput) {
    elements.roleTemperatureInput.addEventListener('input', (e) => {
      if (elements.roleTempValText) {
        elements.roleTempValText.textContent = parseFloat(e.target.value).toFixed(1);
      }
    });
  }

  // Table click delegation for Edit & Delete buttons
  if (elements.rolesTableBody) {
    elements.rolesTableBody.addEventListener('click', (e) => {
      const btnEdit = e.target.closest('.btn-edit-role');
      const btnDelete = e.target.closest('.btn-delete-role');
      
      if (btnEdit) {
        const key = btnEdit.dataset.key;
        showRoleForm(key);
      } else if (btnDelete) {
        const key = btnDelete.dataset.key;
        deleteRole(key);
      }
    });
  }

  // Start Chat Submission
  elements.btnStartChat.addEventListener('click', createChat);

  if (elements.chatModelSelect) {
    elements.chatModelSelect.addEventListener('change', () => handleCustomModelSelect(elements.chatModelSelect));
  }

  // Chat Actions
  elements.btnDeleteChat.addEventListener('click', deleteActiveChat);
  elements.badgeModel.addEventListener('change', changeActiveChatModel);

  // Auto-resize chat textarea
  elements.chatInput.addEventListener('input', () => {
    elements.chatInput.style.height = 'auto';
    elements.chatInput.style.height = (elements.chatInput.scrollHeight) + 'px';
  });

  // Attachment handling
  elements.btnAttach.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', handleFileSelection);

  // Send Message
  elements.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });
  
  // Stop Generation
  if (elements.btnStop) {
    elements.btnStop.addEventListener('click', () => {
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
    });
  }
  
  // Enter key sends message, Shift+Enter breaks line
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      elements.chatForm.requestSubmit();
    }
  });

  // Memory Dashboard Actions
  elements.memorySearchInput.addEventListener('input', loadMemories);
  elements.btnClearAllMemory.addEventListener('click', clearAllMemory);

  // Import Drag & Drop
  const dropZone = elements.dragDropZone;
  dropZone.addEventListener('click', () => elements.importFileInput.click());
  elements.importFileInput.addEventListener('change', (e) => handleImportFile(e.target.files[0]));
  
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleImportFile(e.dataTransfer.files[0]);
    }
  });
}

// --- STATE MANAGEMENT ---
function switchState(state) {
  if (state === 'welcome') {
    elements.stateWelcome.classList.add('active');
    elements.stateChat.classList.remove('active');
    elements.stateDashboard.classList.remove('active');
    activeChatId = null;
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
  } else if (state === 'chat') {
    elements.stateWelcome.classList.remove('active');
    elements.stateDashboard.classList.remove('active');
    elements.stateChat.classList.add('active');
  } else if (state === 'dashboard') {
    elements.stateWelcome.classList.remove('active');
    elements.stateChat.classList.remove('active');
    elements.stateDashboard.classList.add('active');
    activeChatId = null;
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    loadDashboard();
  }
}

// --- CONFIG ACTIONS ---
async function saveApiKey() {
  const key = elements.settingsApiKey.value.trim();
  if (!key) return alert("Bitte API-Key eingeben.");
  
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    
    if (res.ok) {
      alert("API-Key erfolgreich gespeichert!");
      elements.settingsApiKey.value = '';
      updateApiStatus(true);
      elements.modalSettings.close();
    } else {
      const err = await res.json();
      alert("Fehler: " + err.error);
    }
  } catch (err) {
    alert("Verbindungsfehler: " + err.message);
  }
}

// --- CHAT ACTIONS ---
async function loadChats() {
  try {
    const res = await fetch('/api/chats');
    chats = await res.json();
    renderChatsList();
  } catch (err) {
    console.error("Failed to load chats:", err);
  }
}

function renderChatsList() {
  elements.chatsList.innerHTML = '';
  
  // Sort chats by date (newest first)
  const sortedChats = [...chats].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  sortedChats.forEach(chat => {
    const li = document.createElement('li');
    li.className = `chat-item ${chat.id === activeChatId ? 'active' : ''}`;
    li.dataset.id = chat.id;
    
    const dateStr = chat.createdAt ? new Date(chat.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '';
    
    li.innerHTML = `
      <div class="chat-item-header">
        <span class="chat-item-title">${chat.title}</span>
        <span class="chat-item-date">${dateStr}</span>
      </div>
      <div class="chat-item-badges">
        <span class="chat-item-badge">${ROLE_NAMES[chat.role] || 'Standard'}</span>
        <span class="chat-item-badge tone-badge">${TONE_NAMES[chat.tone] || 'Sachlich'}</span>
      </div>
    `;
    
    li.addEventListener('click', () => loadActiveChat(chat.id));
    elements.chatsList.appendChild(li);
  });
}

async function createChat() {
  const title = elements.chatTitleInput.value.trim();
  const defaultTitle = `${ROLE_NAMES[selectedRole]} - ${new Date().toLocaleDateString('de-DE')}`;
  const model = elements.chatModelSelect.value;
  
  try {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || defaultTitle,
        role: selectedRole,
        tone: selectedTone,
        model: model
      })
    });
    
    const newChat = await res.json();
    activeChatId = newChat.id;
    chats.push(newChat);
    renderChatsList();
    loadActiveChat(newChat.id);
  } catch (err) {
    alert("Fehler beim Erstellen des Chats: " + err.message);
  }
}

async function loadActiveChat(chatId) {
  activeChatId = chatId;
  switchState('chat');
  
  // Update active sidebars
  document.querySelectorAll('.chat-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === chatId);
  });
  
  try {
    const res = await fetch(`/api/chats/${chatId}`);
    const chat = await res.json();
    
    // Header UI
    elements.activeChatTitle.textContent = chat.title;
    elements.badgeRole.textContent = ROLE_NAMES[chat.role] || 'Standard';
    elements.badgeTone.textContent = TONE_NAMES[chat.tone] || 'Sachlich';
    elements.badgeModel.value = chat.model || 'gemini-2.5-pro';
    
    // Check for rolling summary
    const banner = document.getElementById('rolling-summary-banner');
    const bannerText = document.getElementById('rolling-summary-text');
    if (chat.rolling_summary) {
      bannerText.textContent = chat.rolling_summary;
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
    
    // Messages Rendering
    elements.messagesContainer.innerHTML = '';
    
    if (chat.messages && chat.messages.length > 0) {
      chat.messages.forEach(msg => {
        renderMessageBubble(msg);
      });
      scrollToBottom();
    } else {
      // Empty state
      elements.messagesContainer.innerHTML = `
        <div class="empty-memory-state">
          <i class="fa-solid fa-comments" style="font-size: 32px; color: var(--color-primary); opacity: 0.7;"></i>
          <p>Unterhaltung gestartet. Sende deine erste Nachricht!</p>
        </div>
      `;
    }
  } catch (err) {
    alert("Fehler beim Laden des Chats: " + err.message);
  }
}

async function deleteActiveChat() {
  if (!activeChatId) return;
  const confirmed = await showConfirmDialog(
    'Möchtest du diesen Chat wirklich unwiderruflich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
    'Chat löschen'
  );
  if (!confirmed) return;
  
  try {
    const res = await fetch(`/api/chats/${activeChatId}`, { method: 'DELETE' });
    if (res.ok) {
      chats = chats.filter(c => c.id !== activeChatId);
      renderChatsList();
      switchState('welcome');
    }
  } catch (err) {
    alert("Fehler beim Löschen: " + err.message);
  }
}

async function handleCustomModelSelect(selectElement) {
  if (selectElement.value === 'custom') {
    const id = prompt("Bitte die genaue API-ID des Modells eingeben (z.B. gemini-3.1-pro-preview):");
    if (!id) {
      selectElement.value = 'gemini-2.5-pro';
      return false;
    }
    let name = prompt(`Wie soll das Modell im Menü heißen?\n(Standard: ${id})`);
    if (!name) name = id;
    
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name })
      });
      if (res.ok) {
        await loadModels(); // Re-populates the selects
        selectElement.value = id;
        return true;
      } else {
        alert("Fehler beim Speichern des Modells.");
      }
    } catch (e) {
      alert("Fehler beim Speichern des Modells: " + e.message);
    }
    selectElement.value = 'gemini-2.5-pro';
    return false;
  }
  return true;
}

async function changeActiveChatModel() {
  if (!activeChatId) return;
  const isNormal = await handleCustomModelSelect(elements.badgeModel);
  if (!isNormal && elements.badgeModel.value === 'gemini-2.5-pro') return;
  
  const newModel = elements.badgeModel.value;
  
  try {
    const res = await fetch(`/api/chats/${activeChatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: newModel })
    });
    
    if (res.ok) {
      // Update local chats array
      const chat = chats.find(c => c.id === activeChatId);
      if (chat) chat.model = newModel;
      renderChatsList();
    } else {
      const err = await res.json();
      alert("Fehler beim Ändern des Modells: " + err.error);
    }
  } catch (err) {
    alert("Fehler beim Speichern: " + err.message);
  }
}

// --- FILE ATTACHMENT PREVIEW ---
function handleFileSelection(e) {
  const files = Array.from(e.target.files);
  
  files.forEach(file => {
    // Prevent duplicate files in the queue
    if (!pendingFiles.some(f => f.name === file.name && f.size === file.size)) {
      pendingFiles.push(file);
    }
  });
  
  elements.fileInput.value = ''; // Reset input element
  renderUploadPreview();
}

function removePendingFile(index) {
  pendingFiles.splice(index, 1);
  renderUploadPreview();
}

function renderUploadPreview() {
  elements.uploadPreviewBar.innerHTML = '';
  
  pendingFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'upload-preview-item';
    
    let iconClass = 'fa-file-lines';
    if (file.type.startsWith('image/')) iconClass = 'fa-file-image';
    if (file.type === 'application/pdf') iconClass = 'fa-file-pdf';
    
    item.innerHTML = `
      <i class="fa-solid ${iconClass}"></i>
      <span>${file.name}</span>
      <button type="button" class="btn-remove-file" onclick="removePendingFile(${index})">&times;</button>
    `;
    elements.uploadPreviewBar.appendChild(item);
  });
}

// Make removePendingFile globally accessible
window.removePendingFile = removePendingFile;

// --- MESSAGES STREAM & SENDING ---
function renderMessageBubble(msg, temp = false) {
  // If it's the welcome empty indicator, clear it
  const emptyMsg = elements.messagesContainer.querySelector('.empty-memory-state');
  if (emptyMsg) emptyMsg.remove();

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${msg.role}`;
  if (msg.id) bubble.dataset.id = msg.id;
  
  // Format Sender
  const senderText = msg.role === 'user' ? 'Du' : (ROLE_NAMES[elements.badgeRole.textContent.toLowerCase()] || elements.activeChatTitle.textContent);
  
  // Render attachments if user message has files
  let attachmentsHtml = '';
  if (msg.files && msg.files.length > 0) {
    attachmentsHtml = '<div class="message-attachments">';
    msg.files.forEach(file => {
      if (file.mimeType.startsWith('image/')) {
        attachmentsHtml += `<img src="${file.path}" alt="${file.name}" class="attachment-img" onclick="window.open('${file.path}', '_blank')">`;
      } else {
        let icon = 'fa-file-lines';
        if (file.mimeType === 'application/pdf') icon = 'fa-file-pdf';
        attachmentsHtml += `
          <a href="${file.path}" target="_blank" class="attachment-card" style="text-decoration: none; color: inherit;">
            <i class="fa-solid ${icon}"></i>
            <span>${file.name}</span>
          </a>
        `;
      }
    });
    attachmentsHtml += '</div>';
  }

  // Render recalled memories if assistant message used them
  let memoriesHtml = '';
  if (msg.role === 'model' && Array.isArray(msg.recalledMemories) && msg.recalledMemories.length > 0) {
    // Ensure all elements are objects before mapping to avoid errors with corrupted data
    const validMemories = msg.recalledMemories.filter(m => typeof m === 'object' && m !== null);
    if (validMemories.length > 0) {
      const memoryId = `memories-${msg.id || Math.random().toString(36).substring(7)}`;
      memoriesHtml = `
        <div class="recalled-memories-wrapper">
          <button class="memory-toggle-btn" onclick="toggleMemoryList('${memoryId}')">
            <i class="fa-solid fa-brain"></i> Langzeit-Gedächtnis abgerufen (${validMemories.length}) <i class="fa-solid fa-chevron-down toggle-arrow"></i>
          </button>
          <ul class="recalled-memories-list" id="${memoryId}" style="display: none;">
            ${validMemories.map((m, idx) => `
              <li class="recalled-memory-item">
                <div class="recalled-memory-meta">
                  <span>Quelle: ${m.metadata?.source || 'Import'}</span>
                  <span>Ähnlichkeit: ${m.similarity ? (m.similarity * 100).toFixed(0) : 'N/A'}%</span>
                </div>
                <div class="recalled-memory-text">${escapeHtml(m.text || '')}</div>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }
  }

  // Render Vogelperspektive facts if assistant message used them
  let vogelHtml = '';
  if (msg.role === 'model' && msg.vogelData && msg.vogelData.length > 0) {
    const vogelId = `vogel-${msg.id || Math.random().toString(36).substring(7)}`;
    vogelHtml = `
      <div class="vogel-data-wrapper">
        <button class="vogel-toggle-btn" onclick="toggleVogelList('${vogelId}')">
          <i class="fa-solid fa-wallet"></i> Vogelperspektive-Daten einbezogen (${msg.vogelData.length} Themen) <i class="fa-solid fa-chevron-down toggle-arrow"></i>
        </button>
        <div class="vogel-data-list" id="${vogelId}" style="display: none;">
          ${msg.vogelData.map(topicCtx => `
            <div class="vogel-topic-card">
              <div class="vogel-topic-title">${escapeHtml(topicCtx.topic.title)}</div>
              ${topicCtx.facts && topicCtx.facts.length > 0 ? `
                <ul class="vogel-facts-list">
                  ${topicCtx.facts.map(f => `<li>${escapeHtml(f.content)}</li>`).join('')}
                </ul>
              ` : ''}
              ${topicCtx.tasks && topicCtx.tasks.length > 0 ? `
                <div class="vogel-tasks-title">Aufgaben:</div>
                <ul class="vogel-tasks-list">
                  ${topicCtx.tasks.map(t => `
                    <li class="task-item-status ${t.status.toLowerCase()}">
                      <span class="task-status-dot"></span>
                      <span class="task-title-text">${escapeHtml(t.title)}</span>
                    </li>
                  `).join('')}
                </ul>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  // Marked markdown compilation
  const parsedContent = msg.role === 'model' ? marked.parse(msg.content) : escapeHtml(msg.content).replace(/\n/g, '<br>');
  
  // Add Dashboard Action Button for Model Messages
  let actionsHtml = '';
  if (msg.role === 'model') {
    actionsHtml = `
      <div class="message-actions" style="margin-top: 0.5rem; text-align: right;">
        <button class="btn btn-secondary btn-export-docx" style="font-size: 0.8rem; padding: 0.3rem 0.6rem; margin-right: 0.5rem;">
          <i class="fa-solid fa-file-word"></i> Export als DocX
        </button>
        <button class="btn btn-secondary btn-add-dashboard" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;">
          <i class="fa-solid fa-plus"></i> Ans Dashboard pinnen
        </button>
      </div>
    `;
  }
  
  bubble.innerHTML = `
    <span class="message-sender">${senderText}</span>
    <div class="message-content-wrapper">
      <div class="message-content">${parsedContent}</div>
      ${attachmentsHtml}
      ${memoriesHtml}
      ${vogelHtml}
      ${actionsHtml}
    </div>
  `;
  
  // Attach Event Listener for Dashboard button
  if (msg.role === 'model') {
    setTimeout(() => {
      const btnAdd = bubble.querySelector('.btn-add-dashboard');
      if (btnAdd) {
        btnAdd.addEventListener('click', () => {
          openAddDashboardModal(msg.content);
        });
      }
      const btnExport = bubble.querySelector('.btn-export-docx');
      if (btnExport) {
        btnExport.addEventListener('click', () => {
          exportToDocx(msg.content);
        });
      }
    }, 0);
  }
  
  elements.messagesContainer.appendChild(bubble);
  
  // Run syntax highlight
  if (msg.role === 'model') {
    Prism.highlightAllUnder(bubble);
  }
  
  return bubble;
}

// Toggle Memory List
function toggleMemoryList(id) {
  const list = document.getElementById(id);
  const btn = list.previousElementSibling;
  const arrow = btn.querySelector('.toggle-arrow');
  
  if (list.style.display === 'none') {
    list.style.display = 'flex';
    arrow.className = 'fa-solid fa-chevron-up toggle-arrow';
  } else {
    list.style.display = 'none';
    arrow.className = 'fa-solid fa-chevron-down toggle-arrow';
  }
}
window.toggleMemoryList = toggleMemoryList;

// Toggle Vogelperspektive List
function toggleVogelList(id) {
  const list = document.getElementById(id);
  const btn = list.previousElementSibling;
  const arrow = btn.querySelector('.toggle-arrow');
  
  if (list.style.display === 'none') {
    list.style.display = 'flex';
    arrow.className = 'fa-solid fa-chevron-up toggle-arrow';
  } else {
    list.style.display = 'none';
    arrow.className = 'fa-solid fa-chevron-down toggle-arrow';
  }
}
window.toggleVogelList = toggleVogelList;

// Toggle Web Sources Panel
function toggleWebSources(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.classList.toggle('open');
}
window.toggleWebSources = toggleWebSources;

async function sendMessage() {
  const text = elements.chatInput.value.trim();
  if (!text && pendingFiles.length === 0) return;
  
  // Construct user message for instant UI addition
  const filesMeta = pendingFiles.map(file => ({
    name: file.name,
    mimeType: file.type,
    // Temporary client-side preview URL for images, otherwise standard icon
    path: file.type.startsWith('image/') ? URL.createObjectURL(file) : '#'
  }));
  
  const userMsg = {
    role: 'user',
    content: text,
    files: filesMeta
  };
  
  renderMessageBubble(userMsg);
  scrollToBottom();
  
  // Clear input
  elements.chatInput.value = '';
  elements.chatInput.style.height = 'auto';
  
  // Assemble FormData for files & fields
  const formData = new FormData();
  formData.append('content', text);
  formData.append('useMemory', elements.toggleMemory.checked);
  formData.append('autoLearn', elements.toggleLearn.checked);
  
  const contextMethodEl = document.getElementById('context-method');
  if (contextMethodEl) {
    formData.append('contextMethod', contextMethodEl.value);
  }
  formData.append('useVogelperspektive', elements.toggleVogelperspektive.checked);
  formData.append('useWebSearch', elements.toggleWebSearch ? elements.toggleWebSearch.checked : false);
  
  pendingFiles.forEach(file => {
    formData.append('files', file);
  });
  
  // Clear file queue
  pendingFiles = [];
  renderUploadPreview();
  
  // Create AI thinking element
  const aiBubble = document.createElement('div');
  aiBubble.className = 'message-bubble model';
  aiBubble.innerHTML = `
    <span class="message-sender">${elements.activeChatTitle.textContent}</span>
    <div class="message-content-wrapper">
      <div class="typing-indicator" id="typing-indicator">
        <span></span><span></span><span></span>
      </div>
      <div class="message-content" style="display:none;"></div>
      <div class="recalled-memories-placeholder"></div>
      <div class="vogel-data-placeholder"></div>
      <div class="web-sources-placeholder"></div>
    </div>
  `;
  elements.messagesContainer.appendChild(aiBubble);
  aiBubble.scrollIntoView({ behavior: 'smooth', block: 'start' });
  
  const aiContent = aiBubble.querySelector('.message-content');
  const typingIndicator = aiBubble.querySelector('#typing-indicator');
  const memoryPlaceholder = aiBubble.querySelector('.recalled-memories-placeholder');
  const vogelPlaceholder = aiBubble.querySelector('.vogel-data-placeholder');
  const webSourcesPlaceholder = aiBubble.querySelector('.web-sources-placeholder');
  let webSearchIndicator = null;
  
  try {
    currentAbortController = new AbortController();
    
    // Toggle UI buttons
    elements.btnSend.style.display = 'none';
    elements.btnStop.style.display = 'flex';
    
    const res = await fetch(`/api/chats/${activeChatId}/message`, {
      method: 'POST',
      body: formData,
      signal: currentAbortController.signal
    });
    
    if (res.status === 401) {
      typingIndicator.remove();
      aiContent.style.display = 'block';
      aiContent.innerHTML = `<span style="color:var(--color-danger);"><i class="fa-solid fa-triangle-exclamation"></i> API-Key nicht konfiguriert. Bitte geben Sie Ihren Key in den Einstellungen an.</span>`;
      return;
    }
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Fehler bei Generierung");
    }
    
    // Read the chunked response stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedResponse = "";
    let lastSpokenIndex = 0;
    let recalledMemories = [];
    let currentCardId = null;
    const pendingActions = [];
    
    typingIndicator.remove();
    aiContent.style.display = 'block';
    
    let streamBuffer = "";
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      streamBuffer += decoder.decode(value, { stream: true });
      const parts = streamBuffer.split('\n\n');
      streamBuffer = parts.pop(); // The last part might be incomplete
      
      // Parse complete SSE messages
      for (const line of parts) {
        if (line.trim().startsWith('data: ')) {
          const rawData = line.substring(6).trim();
          
          if (rawData === '[DONE]') {
            // Stream complete
            break;
          }
          
          try {
            const data = JSON.parse(rawData);
            
            if (data.info) {
              // Show info pill (web search status)
              if (!webSearchIndicator) {
                webSearchIndicator = document.createElement('div');
                webSearchIndicator.className = 'web-search-indicator';
                aiContent.style.display = 'block';
                aiContent.parentNode.insertBefore(webSearchIndicator, aiContent);
              }
              webSearchIndicator.innerHTML = `<i class="fa-solid fa-globe"></i> ${escapeHtml(data.info)}`;
              scrollToBottom();
            } else if (data.webSearch) {
              // Web search results received – render sources panel
              if (webSearchIndicator) { webSearchIndicator.remove(); webSearchIndicator = null; }
              const ws = data.webSearch;
              if (ws.results && ws.results.length > 0) {
                const panelId = `web-sources-${Math.random().toString(36).substring(7)}`;
                webSourcesPlaceholder.innerHTML = `
                  <div class="web-sources-panel" id="${panelId}">
                    <div class="web-sources-header" onclick="toggleWebSources('${panelId}')">
                      <i class="fa-solid fa-globe"></i>
                      <span>Web-Recherche: ${ws.results.length} Quellen gefunden</span>
                      <i class="fa-solid fa-chevron-down sources-toggle-icon"></i>
                    </div>
                    <ul class="web-sources-list">
                      ${ws.results.map((r, i) => `
                        <li class="web-source-item">
                          <span class="web-source-num">${i + 1}</span>
                          <div class="web-source-text">
                            <span class="web-source-title">${escapeHtml(r.title)}</span>
                            ${r.snippet ? `<div class="web-source-snippet">${escapeHtml(r.snippet)}</div>` : ''}
                            <a href="${r.url}" target="_blank" rel="noopener noreferrer" class="web-source-link">${r.url}</a>
                          </div>
                        </li>
                      `).join('')}
                    </ul>
                  </div>
                `;
                scrollToBottom();
              }
            } else if (data.recalledMemories || data.vogelData) {
              if (data.recalledMemories) {
                recalledMemories = data.recalledMemories;
                // Ensure it's a valid array before mapping
                const validMemories = Array.isArray(recalledMemories) ? recalledMemories.filter(m => typeof m === 'object' && m !== null) : [];
                if (validMemories.length > 0) {
                  const memId = `memories-${Math.random().toString(36).substring(7)}`;
                  memoryPlaceholder.innerHTML = `
                    <div class="recalled-memories-wrapper">
                      <button class="memory-toggle-btn" onclick="toggleMemoryList('${memId}')">
                        <i class="fa-solid fa-brain"></i> Langzeit-Gedächtnis abgerufen (${validMemories.length}) <i class="fa-solid fa-chevron-down toggle-arrow"></i>
                      </button>
                      <ul class="recalled-memories-list" id="${memId}" style="display: none;">
                        ${validMemories.map(m => `
                          <li class="recalled-memory-item">
                            <div class="recalled-memory-meta">
                              <span>Quelle: ${m.metadata?.source || 'Import'}</span>
                              <span>Ähnlichkeit: ${m.similarity ? (m.similarity * 100).toFixed(0) : 'N/A'}%</span>
                            </div>
                            <div class="recalled-memory-text">${escapeHtml(m.text || '')}</div>
                          </li>
                        `).join('')}
                      </ul>
                    </div>
                  `;
                }
              }
              
              if (data.vogelData && data.vogelData.length > 0) {
                const vogelId = `vogel-${Math.random().toString(36).substring(7)}`;
                vogelPlaceholder.innerHTML = `
                  <div class="vogel-data-wrapper">
                    <button class="vogel-toggle-btn" onclick="toggleVogelList('${vogelId}')">
                      <i class="fa-solid fa-wallet"></i> Vogelperspektive-Daten einbezogen (${data.vogelData.length} Themen) <i class="fa-solid fa-chevron-down toggle-arrow"></i>
                    </button>
                    <div class="vogel-data-list" id="${vogelId}" style="display: none;">
                      ${data.vogelData.map(topicCtx => `
                        <div class="vogel-topic-card">
                          <div class="vogel-topic-title">${escapeHtml(topicCtx.topic.title)}</div>
                          ${topicCtx.facts && topicCtx.facts.length > 0 ? `
                            <ul class="vogel-facts-list">
                              ${topicCtx.facts.map(f => `<li>${escapeHtml(f.content)}</li>`).join('')}
                            </ul>
                          ` : ''}
                          ${topicCtx.tasks && topicCtx.tasks.length > 0 ? `
                            <div class="vogel-tasks-title">Aufgaben:</div>
                            <ul class="vogel-tasks-list">
                              ${topicCtx.tasks.map(t => `
                                <li class="task-item-status ${t.status.toLowerCase()}">
                                  <span class="task-status-dot"></span>
                                  <span class="task-title-text">${escapeHtml(t.title)}</span>
                                </li>
                              `).join('')}
                            </ul>
                          ` : ''}
                        </div>
                      `).join('')}
                    </div>
                  </div>
                `;
              }
            } else if (data.memorySaved) {
              // Explicit memory save confirmation
              if (webSearchIndicator) { webSearchIndicator.remove(); webSearchIndicator = null; }
              const savedBadge = document.createElement('div');
              savedBadge.className = 'memory-saved-badge';
              savedBadge.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Im Langzeitgedächtnis gespeichert: <em>${escapeHtml(data.memorySaved.content.substring(0, 80))}${data.memorySaved.content.length > 80 ? '…' : ''}</em>`;
              aiContent.style.display = 'block';
              aiContent.parentNode.insertBefore(savedBadge, aiContent);
              scrollToBottom();
            } else if (data.functionCall) {
              if (typingIndicator) typingIndicator.remove();
              aiContent.style.display = 'block';
              
              const call = data.functionCall;
              pendingActions.push(call);
              const actionIndex = pendingActions.length - 1;
              
              let cardDiv = currentCardId ? document.getElementById(currentCardId) : null;
              if (!cardDiv) {
                currentCardId = `write-card-${Math.random().toString(36).substring(7)}`;
                cardDiv = document.createElement('div');
                cardDiv.className = 'confirm-write-card unified-card';
                cardDiv.id = currentCardId;
                cardDiv.innerHTML = `
                  <div class="confirm-write-header">
                    <i class="fa-solid fa-list-check confirm-write-icon"></i>
                    <div class="confirm-write-header-text">
                      <div class="confirm-write-title">Geplante Aktionen freigeben</div>
                      <div class="confirm-write-subtitle">Wähle aus, was gespeichert werden soll:</div>
                    </div>
                  </div>
                  <div class="confirm-write-list"></div>
                  <div class="confirm-write-actions">
                    <button class="btn-confirm-action confirm btn-execute-selected">
                      Ausgewählte Aktionen ausführen
                    </button>
                    <button class="btn-confirm-action cancel btn-cancel-all">
                      Alle abbrechen
                    </button>
                  </div>
                `;
                
                // Add event listeners
                cardDiv.querySelector('.btn-execute-selected').addEventListener('click', () => {
                  window.executeSelectedActions(currentCardId, pendingActions);
                });
                cardDiv.querySelector('.btn-cancel-all').addEventListener('click', () => {
                  window.cancelAllActions(currentCardId);
                });
                
                const wrapper = aiBubble.querySelector('.message-content-wrapper');
                wrapper.appendChild(cardDiv);
              }
              
              const listContainer = cardDiv.querySelector('.confirm-write-list');
              const itemDiv = document.createElement('div');
              itemDiv.className = 'confirm-write-item';
              
              let actionTitle = '';
              let actionSubtext = '';
              let actionIcon = 'fa-file-lines';
              
              if (call.name === 'addFactToVogelperspektive') {
                actionTitle = 'Eintrag in Vogelperspektive';
                actionSubtext = `Thema: ${escapeHtml(call.args.topicTitle)}<br><strong>Fakt:</strong> ${escapeHtml(call.args.content)}`;
                actionIcon = 'fa-wallet';
              } else if (call.name === 'addTaskToVogelperspektive') {
                actionTitle = 'Neue Aufgabe in Vogelperspektive';
                const dueDateStr = call.args.due_date ? ` (Fällig: ${escapeHtml(call.args.due_date)})` : '';
                const notesStr = call.args.notes ? `<br><em>Notizen: ${escapeHtml(call.args.notes)}</em>` : '';
                actionSubtext = `Thema: ${escapeHtml(call.args.topicTitle)}${dueDateStr}<br><strong>Aufgabe:</strong> ${escapeHtml(call.args.title)}${notesStr}`;
                actionIcon = 'fa-list-check';
              } else if (call.name === 'createGoogleCalendarEvent') {
                actionTitle = 'Eintrag in Google Kalender';
                const startStr = call.args.startDateTime ? new Date(call.args.startDateTime).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unbekannt';
                const descStr = call.args.description ? `<br><em>Details: ${escapeHtml(call.args.description)}</em>` : '';
                let tasksStr = '';
                if (call.args.tasks && call.args.tasks.length > 0) {
                  tasksStr = `<br><strong style="font-size:10px; opacity:0.8; text-transform:uppercase; display:block; margin-top:4px;">Unteraufgaben:</strong><ul style="margin: 2px 0 0 14px; padding: 0; font-size:11px; color: var(--color-text-muted);">` + 
                    call.args.tasks.map(t => `<li>${escapeHtml(t)}</li>`).join('') + `</ul>`;
                }
                actionSubtext = `<strong>Termin:</strong> ${escapeHtml(call.args.summary)} (${startStr})${descStr}${tasksStr}`;
                actionIcon = 'fa-calendar-days';
              } else if (call.name === 'updateDashboardMetrics') {
                actionTitle = 'Dashboard-Diagramm aktualisieren';
                let chartType = call.args.chartName === 'finance' ? 'Finanzen' : (call.args.chartName === 'fitness' ? 'Fitness' : 'Coaching');
                actionSubtext = `<strong>Diagramm:</strong> ${escapeHtml(chartType)}<br><strong>Neuer Datensatz:</strong> ${escapeHtml(call.args.dataset1Name)} (${call.args.dataset1Data.length} Werte)`;
                actionIcon = 'fa-chart-pie';
              } else if (call.name === 'manageAppointment') {
                actionTitle = 'Termin im Dashboard speichern';
                actionSubtext = `<strong>Termin:</strong> ${escapeHtml(call.args.title)} am ${escapeHtml(call.args.date)}`;
                if (call.args.description) actionSubtext += `<br><em>${escapeHtml(call.args.description)}</em>`;
                actionIcon = 'fa-calendar-day';
              } else if (call.name === 'manageTodo') {
                actionTitle = 'ToDo-Liste verwalten';
                let actionText = call.args.action === 'add' ? 'Hinzufügen:' : (call.args.action === 'complete' ? 'Abschließen:' : 'Löschen:');
                actionSubtext = `<strong>${actionText}</strong> ${escapeHtml(call.args.title)}`;
                if (call.args.description) actionSubtext += `<br><em>${escapeHtml(call.args.description)}</em>`;
                actionIcon = 'fa-list-check';
              } else if (call.name === 'optimizeBehavior') {
                actionTitle = 'System-Verhalten optimieren';
                let actionText = call.args.action === 'remove' ? 'Regel entfernen:' : 'Regel hinzufügen:';
                actionSubtext = `<strong>${actionText}</strong> ${escapeHtml(call.args.rule || 'RAG Strategie Anpassung')} (Scope: ${escapeHtml(call.args.scope)})`;
                if (call.args.topK) actionSubtext += `<br><em>Tiefe (topK): ${call.args.topK}</em>`;
                if (call.args.minSimilarity) actionSubtext += `<br><em>Ähnlichkeit: ${call.args.minSimilarity}</em>`;
                actionIcon = 'fa-brain';
              } else {
                actionTitle = `Aktion: ${escapeHtml(call.name)}`;
                actionSubtext = `<em>Argumente: ${escapeHtml(JSON.stringify(call.args))}</em>`;
                actionIcon = 'fa-code';
              }
              
              itemDiv.innerHTML = `
                <label class="switch-container">
                  <input type="checkbox" checked class="action-toggle" data-index="${actionIndex}">
                  <span class="switch-slider"></span>
                </label>
                <div style="flex-grow: 1;">
                  <div style="font-size: 11.5px; font-weight: 700; color: var(--color-emerald); display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
                    <i class="fa-solid ${actionIcon}"></i> ${escapeHtml(actionTitle)}
                  </div>
                  <div style="font-size: 11.5px; color: var(--color-text-body); line-height: 1.4;">
                    ${actionSubtext}
                  </div>
                </div>
              `;
              
              listContainer.appendChild(itemDiv);
              scrollToBottom();
            } else if (data.info) {
              const infoDiv = document.createElement('div');
              infoDiv.className = 'chat-info-alert';
              infoDiv.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${escapeHtml(data.info)}`;
              aiBubble.querySelector('.message-content-wrapper').insertBefore(infoDiv, aiContent);
              scrollToBottom();
            } else if (data.modelUpdate) {
              elements.badgeModel.value = data.modelUpdate;
              const chat = chats.find(c => c.id === activeChatId);
              if (chat) chat.model = data.modelUpdate;
              renderChatsList();
            } else if (data.totalCostUSD !== undefined || data.monthlyCostUSD !== undefined) {
              updateCostUI(data.monthlyCostUSD !== undefined ? data.monthlyCostUSD : data.totalCostUSD);
            } else if (data.text) {
              accumulatedResponse += data.text;
              aiContent.innerHTML = marked.parse(accumulatedResponse);
              Prism.highlightAllUnder(aiBubble);
              
              // Stream TTS logic: read chunks as they complete
              if (isSpeakerActive || isHandsFreeActive) {
                const unreadText = accumulatedResponse.slice(lastSpokenIndex);
                // Split by sentence ending punctuation (., !, ?) or newlines, followed by a space or end of string
                const match = unreadText.match(/([.!?\n]+(?:\s|$))/);
                if (match) {
                  const chunkLength = match.index + match[0].length;
                  const chunkToSpeak = unreadText.substring(0, chunkLength);
                  lastSpokenIndex += chunkLength;
                  if (chunkToSpeak.trim().length > 0) {
                    speakText(chunkToSpeak);
                  }
                }
              }
              
            } else if (data.error) {
              aiContent.innerHTML = `<span style="color:var(--color-danger);"><i class="fa-solid fa-triangle-exclamation"></i> API Fehler: ${data.error}</span>`;
            }
          } catch (e) {
            console.warn("Failed to parse SSE JSON:", e, rawData);
          }
        }
      }
    }
    
    // Toggle UI buttons back
    elements.btnStop.style.display = 'none';
    elements.btnSend.style.display = 'flex';
    currentAbortController = null;
    
    // Trigger Voice Output for any remaining text after stream finishes
    if (isSpeakerActive || isHandsFreeActive) {
      const remainingText = accumulatedResponse.slice(lastSpokenIndex);
      if (remainingText.trim().length > 0) {
        speakText(remainingText);
      }
    }
    
    // Refresh stats in case autoLearn was active
    updateMemoryCount();
  } catch (err) {
    if (err.name === 'AbortError') {
      typingIndicator.remove();
      aiContent.style.display = 'block';
      aiContent.innerHTML = `<span style="color:var(--color-danger);"><i class="fa-solid fa-stop"></i> Generierung abgebrochen.</span>`;
    } else {
      typingIndicator.remove();
      aiContent.style.display = 'block';
      aiContent.innerHTML = `<span style="color:var(--color-danger);"><i class="fa-solid fa-circle-exclamation"></i> Netzwerkfehler: ${err.message}</span>`;
    }
  } finally {
    // Ensure UI buttons toggle back on any error or completion
    elements.btnStop.style.display = 'none';
    elements.btnSend.style.display = 'flex';
    currentAbortController = null;
  }
}

// --- MEMORY MANAGER ACTIONS ---
async function updateMemoryCount() {
  try {
    const res = await fetch('/api/memory');
    const data = await res.json();
    elements.memoryCount.textContent = data.length;
  } catch (err) {
    console.error("Failed to load memory count:", err);
  }
}

async function loadMemories() {
  const query = elements.memorySearchInput.value.trim();
  const url = query ? `/api/memory?q=${encodeURIComponent(query)}` : '/api/memory';
  
  try {
    const res = await fetch(url);
    const memories = await res.json();
    
    elements.memoryTableBody.innerHTML = '';
    
    if (memories.length === 0) {
      elements.emptyMemoryMsg.style.display = 'flex';
      return;
    }
    
    elements.emptyMemoryMsg.style.display = 'none';
    
    memories.forEach(mem => {
      const tr = document.createElement('tr');
      const dateStr = mem.metadata.timestamp ? new Date(mem.metadata.timestamp).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unbekannt';
      
      tr.innerHTML = `
        <td style="white-space: pre-wrap; font-family: monospace;">${escapeHtml(mem.text)}</td>
        <td>${escapeHtml(mem.metadata.source || 'Automatisches Lernen')}</td>
        <td style="color: var(--color-text-muted);">${dateStr}</td>
        <td style="text-align: center;"><i class="fa-solid fa-trash-can" onclick="deleteMemoryEntry('${mem.id}')"></i></td>
      `;
      elements.memoryTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load memories:", err);
  }
}

async function deleteMemoryEntry(id) {
  if (!confirm("Möchtest du diese Erinnerung aus dem Langzeitgedächtnis löschen?")) return;
  
  try {
    const res = await fetch(`/api/memory/${id}`, { method: 'DELETE' });
    if (res.ok) {
      loadMemories();
      updateMemoryCount();
    }
  } catch (err) {
    alert("Fehler beim Löschen: " + err.message);
  }
}

async function clearAllMemory() {
  if (!confirm("Vorsicht: Möchtest du das GESAMTE Langzeitgedächtnis unwiderruflich löschen?")) return;
  
  try {
    const res = await fetch('/api/memory/clear', { method: 'POST' });
    if (res.ok) {
      loadMemories();
      updateMemoryCount();
    }
  } catch (err) {
    alert("Fehler beim Löschen des Gedächtnisses: " + err.message);
  }
}

// Make deleteMemoryEntry globally accessible
window.deleteMemoryEntry = deleteMemoryEntry;

// --- IMPORT MANAGER ACTIONS ---
function resetImportProgress() {
  elements.dragDropZone.style.display = 'flex';
  elements.importProgressContainer.style.display = 'none';
  elements.importProgressBar.style.width = '0%';
  elements.importPercentText.textContent = '0%';
  elements.importStatusText.textContent = 'Bereite Import vor...';
  elements.importFileInput.value = '';
  if (elements.whatsappHint) elements.whatsappHint.style.display = 'none';
}

async function handleImportFile(file) {
  if (!file) return;

  // Show WhatsApp hint if ZIP file
  const isZip = file.name.toLowerCase().endsWith('.zip');
  if (elements.whatsappHint) {
    elements.whatsappHint.style.display = isZip ? 'flex' : 'none';
  }

  // If ZIP: wait briefly so user can toggle image analysis before upload starts
  // (the actual upload starts when the user interacts or we can use a button)
  // For simplicity: show a small "Start Import" button for ZIP, auto-start for others
  if (isZip && elements.whatsappHint) {
    // Show start button inside the drop zone area
    if (!document.getElementById('btn-start-zip-import')) {
      const startBtn = document.createElement('button');
      startBtn.id = 'btn-start-zip-import';
      startBtn.className = 'btn btn-primary';
      startBtn.style.cssText = 'margin-top: 14px; width: 100%;';
      startBtn.innerHTML = '<i class="fa-solid fa-file-import"></i> WhatsApp-Import starten';
      startBtn.onclick = () => { startBtn.remove(); doImport(file, true); };
      elements.dragDropZone.appendChild(startBtn);
    }
    return;
  }

  doImport(file, false);
}

async function doImport(file, isZip) {
  // Show progress bar
  elements.dragDropZone.style.display = 'none';
  if (elements.whatsappHint) elements.whatsappHint.style.display = 'none';
  elements.importProgressContainer.style.display = 'block';

  const analyzeImages = isZip && elements.toggleAnalyzeImages && elements.toggleAnalyzeImages.checked;

  const formData = new FormData();
  formData.append('file', file);
  if (analyzeImages) formData.append('analyzeImages', 'true');

  try {
    const res = await fetch('/api/memory/import', {
      method: 'POST',
      body: formData
    });

    if (res.status === 401) {
      alert("Fehler: API-Key fehlt. Bitte konfigurieren Sie Ihren Key in den Einstellungen.");
      resetImportProgress();
      return;
    }

    // Read the chunked response stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.trim() !== '');

      for (const line of lines) {
        try {
          const progress = JSON.parse(line);

          if (progress.error) {
            alert("Import Fehler: " + progress.error);
            resetImportProgress();
            return;
          }

          if (progress.success) {
            alert(progress.message);
            updateMemoryCount();
            elements.modalImport.close();
            return;
          }

          // Update progress UI
          if (progress.step === 'parse') {
            elements.importProgressBar.style.width = '10%';
            elements.importPercentText.textContent = '10%';
            elements.importStatusText.textContent = progress.msg;
          } else if (progress.step === 'images') {
            const pct = Math.round((progress.current / Math.max(progress.total, 1)) * 40) + 10;
            elements.importProgressBar.style.width = `${pct}%`;
            elements.importPercentText.textContent = `${pct}%`;
            elements.importStatusText.textContent = progress.msg;
          } else if (progress.step === 'embed_start') {
            elements.importProgressBar.style.width = '50%';
            elements.importPercentText.textContent = '50%';
            elements.importStatusText.textContent = progress.msg;
          } else if (progress.step === 'embed_progress') {
            const pct = Math.round((progress.current / progress.total) * 50) + 50;
            elements.importProgressBar.style.width = `${pct}%`;
            elements.importPercentText.textContent = `${pct}%`;
            elements.importStatusText.textContent = progress.msg;
          }
        } catch (e) {
          console.warn("Failed to parse progress JSON:", e, line);
        }
      }
    }
  } catch (err) {
    alert("Fehler beim Import: " + err.message);
    resetImportProgress();
  }
}

// --- HELPERS ---
function scrollToBottom() {
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- UNIFIED ACTION CONFIRMATION HANDLERS ---
window.cancelAllActions = function(cardId) {
  const card = document.getElementById(cardId);
  if (card) {
    card.className = 'confirm-write-card cancelled';
    card.innerHTML = `
      <div class="confirm-write-status">
        <i class="fa-solid fa-circle-xmark"></i>
        <span>Alle Aktionen abgebrochen.</span>
      </div>
    `;
  }
};

window.executeSelectedActions = async function(cardId, pendingActions) {
  const card = document.getElementById(cardId);
  if (!card) return;
  
  const toggles = card.querySelectorAll('.action-toggle');
  const selectedIndices = [];
  toggles.forEach(toggle => {
    if (toggle.checked) {
      selectedIndices.push(parseInt(toggle.dataset.index, 10));
    }
  });
  
  if (selectedIndices.length === 0) {
    alert("Bitte wähle mindestens eine Aktion aus oder klicke auf 'Abbrechen'.");
    return;
  }
  
  // Show loading state
  const confirmBtn = card.querySelector('.btn-execute-selected');
  const cancelBtn = card.querySelector('.btn-cancel-all');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Speichert...';
  }
  if (cancelBtn) cancelBtn.disabled = true;
  toggles.forEach(t => t.disabled = true);
  
  let successCount = 0;
  let failCount = 0;
  
  for (const idx of selectedIndices) {
    const action = pendingActions[idx];
    try {
      let res;
      if (action.name === 'addFactToVogelperspektive') {
        res = await fetch('/api/vogelperspektive/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'addFact',
            topicId: action.args.topicId,
            content: action.args.content,
            chatId: activeChatId
          })
        });
      } else if (action.name === 'addTaskToVogelperspektive') {
        res = await fetch('/api/vogelperspektive/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'addTask',
            topicId: action.args.topicId,
            title: action.args.title,
            due_date: action.args.due_date || null,
            notes: action.args.notes || '',
            chatId: activeChatId
          })
        });
      } else if (action.name === 'createGoogleCalendarEvent') {
        res = await fetch('/api/vogelperspektive/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'createCalendarEvent',
            title: action.args.summary,
            due_date: action.args.startDateTime,
            endDateTime: action.args.endDateTime || null,
            notes: action.args.description || '',
            chatId: activeChatId,
            tasks: action.args.tasks || []
          })
        });
      } else if (action.name === 'updateDashboardMetrics') {
        res = await fetch('/api/dashboard/updateChart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chartName: action.args.chartName,
            labels: action.args.labels,
            dataset1Name: action.args.dataset1Name,
            dataset1Data: action.args.dataset1Data,
            dataset2Name: action.args.dataset2Name || null,
            dataset2Data: action.args.dataset2Data || null
          })
        });
        // Reload dashboard if active
        if (elements.stateDashboard.classList.contains('active')) {
          loadDashboard();
        }
      } else if (action.name === 'manageAppointment') {
        res = await fetch('/api/vogelperspektive/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'manageAppointment',
            title: action.args.title,
            due_date: action.args.date,
            notes: action.args.description || '',
            chatId: activeChatId
          })
        });
        if (elements.stateDashboard.classList.contains('active')) loadDashboard();
      } else if (action.name === 'manageTodo') {
        res = await fetch('/api/vogelperspektive/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'manageTodo',
            todoAction: action.args.action,
            title: action.args.title,
            notes: action.args.description || '',
            chatId: activeChatId
          })
        });
        if (elements.stateDashboard.classList.contains('active')) loadDashboard();
      } else if (action.name === 'optimizeBehavior') {
        res = await fetch('/api/vogelperspektive/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'optimizeBehavior',
            scope: action.args.scope,
            rule: action.args.rule,
            optimizeAction: action.args.action,
            topK: action.args.topK,
            minSimilarity: action.args.minSimilarity,
            chatId: activeChatId
          })
        });
      }
      
      if (res && res.ok) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      console.error("Action execution failed:", err);
      failCount++;
    }
  }
  
  if (failCount === 0) {
    card.className = 'confirm-write-card success';
    card.innerHTML = `
      <div class="confirm-write-status">
        <i class="fa-solid fa-circle-check"></i>
        <span>${successCount} Aktion(en) erfolgreich ausgeführt!</span>
      </div>
    `;
    setTimeout(() => {
      if (activeChatId) loadActiveChat(activeChatId);
    }, 1500);
  } else {
    alert(`Ausführung beendet: ${successCount} erfolgreich, ${failCount} fehlgeschlagen.`);
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Ausgewählte Aktionen ausführen';
    }
    if (cancelBtn) cancelBtn.disabled = false;
    toggles.forEach(t => t.disabled = false);
  }
};

// --- DASHBOARD & BOARDROOM ---

async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard');
    const data = await res.json();
    
    // Init Charts
    initDashboardCharts(data);
    
    // Populate Insights
    const insightsList = document.getElementById('dashboard-insights');
    if (insightsList) {
      insightsList.innerHTML = '';
      if (data.insights && data.insights.length > 0) {
        data.insights.forEach(insight => {
          const li = document.createElement('li');
          li.innerHTML = `<span class="date">${insight.date}</span>${insight.text}`;
          insightsList.appendChild(li);
        });
      } else {
        insightsList.innerHTML = '<li>Noch keine Erkenntnisse vorhanden.</li>';
      }
    }
    // Populate Mindsets
    const mindsetList = document.getElementById('dashboard-mindset');
    if (mindsetList) {
      mindsetList.innerHTML = '';
      if (data.mindset && data.mindset.length > 0) {
        data.mindset.forEach(ms => {
          const li = document.createElement('li');
          li.innerHTML = ms;
          mindsetList.appendChild(li);
        });
      } else {
        mindsetList.innerHTML = '<li>Noch keine Mindset-Punkte vorhanden.</li>';
      }
    }
    
    // Load Boardroom Roles
    loadBoardroomRoles();
    
    // Fetch Appointments
    try {
      const apptsRes = await fetch('/api/appointments');
      const appts = await apptsRes.json();
      const apptsList = document.getElementById('dashboard-appointments');
      if (apptsList) {
        apptsList.innerHTML = '';
        if (appts && appts.length > 0) {
          appts.forEach(a => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="date">${escapeHtml(a.date)}</span><strong>${escapeHtml(a.title)}</strong> ${a.description ? '<br><span style="font-size:0.9em;color:var(--color-text-muted)">' + escapeHtml(a.description) + '</span>' : ''}`;
            apptsList.appendChild(li);
          });
        } else {
          apptsList.innerHTML = '<li>Keine anstehenden Termine.</li>';
        }
      }
    } catch (e) { console.error('Termine fetch error:', e); }

    // Fetch ToDos
    try {
      const todosRes = await fetch('/api/todos');
      const todos = await todosRes.json();
      const todosList = document.getElementById('dashboard-todos');
      if (todosList) {
        todosList.innerHTML = '';
        if (todos && todos.length > 0) {
          todos.forEach(t => {
            const li = document.createElement('li');
            const icon = t.completed ? `<i class="fa-solid fa-check-circle todo-toggle" data-id="${t.id}" data-completed="true" style="color:var(--color-emerald); margin-right:8px; cursor:pointer;"></i>` : `<i class="fa-regular fa-circle todo-toggle" data-id="${t.id}" data-completed="false" style="margin-right:8px; cursor:pointer;"></i>`;
            const style = t.completed ? 'text-decoration: line-through; opacity: 0.7;' : '';
            li.innerHTML = `<div style="display:flex; align-items:flex-start; ${style}">${icon}<div><strong>${escapeHtml(t.title)}</strong> ${t.description ? '<br><span style="font-size:0.9em;color:var(--color-text-muted)">' + escapeHtml(t.description) + '</span>' : ''}</div></div>`;
            todosList.appendChild(li);
          });
        } else {
          todosList.innerHTML = '<li>Keine offenen ToDos.</li>';
        }
      }
    } catch (e) { console.error('Todos fetch error:', e); }
    
  } catch (err) {
    console.error("Dashboard laden fehlgeschlagen:", err);
  }
}

// Toggle ToDos when clicking the icon
document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('todo-toggle')) {
    const todoId = e.target.getAttribute('data-id');
    const isCompleted = e.target.getAttribute('data-completed') === 'true';
    try {
      const res = await fetch(`/api/todos/${todoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !isCompleted })
      });
      if (res.ok) {
        // Just reload the dashboard quietly to update the view
        loadDashboard();
      }
    } catch (err) {
      console.error("Fehler beim Umschalten des ToDos:", err);
    }
  }
});

let financeChartInstance = null;
let fitnessChartInstance = null;
let coachingChartInstance = null;

function initDashboardCharts(data) {
  if (financeChartInstance) financeChartInstance.destroy();
  if (fitnessChartInstance) fitnessChartInstance.destroy();
  if (coachingChartInstance) coachingChartInstance.destroy();
  
  const ctxFinance = document.getElementById('financeChart');
  if (ctxFinance && data.finance && data.finance.labels) {
    financeChartInstance = new Chart(ctxFinance, {
      type: 'line',
      data: {
        labels: data.finance.labels,
        datasets: [
          { label: 'Umsatz', data: data.finance.revenue, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.4 },
          { label: 'Kosten', data: data.finance.expenses, borderColor: '#ef4444', backgroundColor: 'transparent', tension: 0.4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e2e8f0' } } }, scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } } }
    });
  }

  const ctxFitness = document.getElementById('fitnessChart');
  if (ctxFitness && data.fitness && data.fitness.labels) {
    fitnessChartInstance = new Chart(ctxFitness, {
      type: 'bar',
      data: {
        labels: data.fitness.labels,
        datasets: [
          { label: 'Gewicht (kg)', data: data.fitness.weight, backgroundColor: '#3b82f6', yAxisID: 'y' },
          { label: 'Workouts', data: data.fitness.workouts, type: 'line', borderColor: '#f59e0b', yAxisID: 'y1', tension: 0.4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e2e8f0' } } },
        scales: { 
          x: { ticks: { color: '#94a3b8' } },
          y: { type: 'linear', display: true, position: 'left', ticks: { color: '#94a3b8' } },
          y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#94a3b8' } }
        }
      }
    });
  }

  const ctxCoaching = document.getElementById('coachingChart');
  if (ctxCoaching && data.coaching && data.coaching.labels) {
    coachingChartInstance = new Chart(ctxCoaching, {
      type: 'radar',
      data: {
        labels: data.coaching.labels,
        datasets: [{
          label: 'Aktuelle Bewertung (1-10)',
          data: data.coaching.scores,
          backgroundColor: 'rgba(139, 92, 246, 0.2)',
          borderColor: '#8b5cf6',
          pointBackgroundColor: '#8b5cf6',
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#e2e8f0' } } },
        scales: { r: { angleLines: { color: 'rgba(255, 255, 255, 0.1)' }, grid: { color: 'rgba(255, 255, 255, 0.1)' }, pointLabels: { color: '#cbd5e1' }, ticks: { display: false } } }
      }
    });
  }
}

async function loadBoardroomRoles() {
  const container = document.getElementById('boardroom-role-selection');
  if (!container) return;
  
  try {
    const res = await fetch('/api/roles');
    const roles = await res.json();
    
    container.innerHTML = '';
    Object.keys(roles).forEach(key => {
      const role = roles[key];
      const btn = document.createElement('button');
      btn.className = 'boardroom-role-btn';
      btn.dataset.roleKey = key;
      btn.innerHTML = `<i class="fa-solid ${role.icon || 'fa-user'}"></i> ${role.title}`;
      btn.onclick = () => {
        btn.classList.toggle('selected');
      };
      container.appendChild(btn);
    });
  } catch (err) {
    console.error("Boardroom Rollen laden fehlgeschlagen:", err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btnConsult = document.getElementById('btn-boardroom-consult');
  if (btnConsult) {
    btnConsult.addEventListener('click', handleBoardroomConsult);
  }
});

async function handleBoardroomConsult() {
  const questionInput = document.getElementById('boardroom-question');
  const question = questionInput.value.trim();
  const selectedBtns = document.querySelectorAll('.boardroom-role-btn.selected');
  const roleKeys = Array.from(selectedBtns).map(btn => btn.dataset.roleKey);
  
  if (!question) return alert('Bitte stelle eine strategische Frage für den Boardroom.');
  if (roleKeys.length === 0) return alert('Bitte wähle mindestens einen Spezialisten aus.');
  
  const resultsContainer = document.getElementById('boardroom-results');
  resultsContainer.innerHTML = '<div class="loader">Konsultiere Spezialisten...</div>';
  
  try {
    const res = await fetch('/api/boardroom/consult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, roleKeys })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      resultsContainer.innerHTML = `<div class="error">Fehler: ${data.error}</div>`;
      return;
    }
    
    resultsContainer.innerHTML = '';
    data.results.forEach(result => {
      const card = document.createElement('div');
      card.className = 'boardroom-result-card';
      
      let content = '';
      if (result.error) {
        content = `<div class="error">Konnte nicht antworten: ${result.error}</div>`;
      } else {
        // Simple markdown parsing for bold text
        const formattedText = result.response.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        content = `<div class="response-text">${formattedText}</div>`;
      }
      
      card.innerHTML = `
        <h4><i class="fa-solid ${result.icon || 'fa-user'}"></i> ${result.title}</h4>
        ${content}
      `;
      resultsContainer.appendChild(card);
    });
    
  } catch (err) {
    console.error("Boardroom Error:", err);
    resultsContainer.innerHTML = `<div class="error">Verbindungsfehler: ${err.message}</div>`;
  }
}

// --- ADD TO DASHBOARD MODAL ---

function openAddDashboardModal(content) {
  const modal = document.getElementById('modal-add-dashboard');
  const inputContent = document.getElementById('add-dashboard-content');
  if (modal && inputContent) {
    // Basic cleanup of markdown formatting for input box if needed
    inputContent.value = content.replace(/\*\*/g, '').trim();
    modal.showModal();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('modal-add-dashboard');
  const btnClose = document.getElementById('btn-close-add-dashboard');
  const btnCancel = document.getElementById('btn-cancel-add-dashboard');
  const btnSave = document.getElementById('btn-save-dashboard');
  
  if (btnClose) btnClose.addEventListener('click', () => modal.close());
  if (btnCancel) btnCancel.addEventListener('click', () => modal.close());
  
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const type = document.getElementById('add-dashboard-type').value;
      const content = document.getElementById('add-dashboard-content').value.trim();
      
      if (!content) return alert("Bitte Inhalt eingeben.");
      
      btnSave.disabled = true;
      btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Speichere...';
      
      try {
        const res = await fetch('/api/dashboard/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, content })
        });
        
        if (res.ok) {
          modal.close();
          // if dashboard is currently open, refresh it
          if (document.getElementById('state-dashboard').classList.contains('active')) {
            loadDashboard();
          }
        } else {
          const data = await res.json();
          alert("Fehler: " + data.error);
        }
      } catch (err) {
        console.error(err);
        alert("Verbindungsfehler beim Speichern.");
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = 'Hinzufügen';
      }
    });
  }
});

// --- ROLE SWITCH / HANDOVER MODAL LOGIC ---

async function openHandoverModal(actionType) {
  if (!activeChatId) return;
  const modal = document.getElementById('modal-handover');
  const actionInput = document.getElementById('handover-action-type');
  const select = document.getElementById('handover-role-select');
  const title = document.getElementById('handover-modal-title');
  const desc = document.getElementById('handover-modal-desc');
  
  actionInput.value = actionType;
  
  if (actionType === 'switch') {
    title.textContent = 'Fliegender Rollenwechsel';
    desc.textContent = 'Wechsle den Spezialisten im laufenden Chat. Der neue Spezialist hat vollen Zugriff auf die bisherige Historie dieses Chats.';
  } else {
    title.textContent = 'Chat-Briefing & Übergabe';
    desc.textContent = 'Erstelle ein Briefing aus der bisherigen Strategie und starte einen neuen Chat mit dem gewählten Spezialisten.';
  }
  
  // Populate select
  try {
    const res = await fetch('/api/roles');
    const roles = await res.json();
    select.innerHTML = '';
    
    // Don't show current role as an option
    const currentChat = chats.find(c => c.id === activeChatId);
    
    Object.keys(roles).forEach(key => {
      if (currentChat && currentChat.role === key) return;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = roles[key].title;
      select.appendChild(opt);
    });
    
    modal.showModal();
  } catch(err) {
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('modal-handover');
  const btnClose = document.getElementById('btn-close-handover');
  const btnCancel = document.getElementById('btn-cancel-handover');
  const btnExecute = document.getElementById('btn-execute-handover');
  
  if (btnClose) btnClose.addEventListener('click', () => modal.close());
  if (btnCancel) btnCancel.addEventListener('click', () => modal.close());
  
  if (btnExecute) {
    btnExecute.addEventListener('click', async () => {
      const actionType = document.getElementById('handover-action-type').value;
      const targetRole = document.getElementById('handover-role-select').value;
      
      if (!targetRole) return alert("Bitte wähle eine Rolle aus.");
      
      btnExecute.disabled = true;
      btnExecute.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Führe aus...';
      
      try {
        if (actionType === 'switch') {
          // PATCH /api/chats/:id
          const res = await fetch(`/api/chats/${activeChatId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: targetRole })
          });
          if (res.ok) {
            await loadChats();
            loadActiveChat(activeChatId);
            modal.close();
          } else {
            alert("Fehler beim Rollenwechsel.");
          }
        } else if (actionType === 'handover') {
          // POST /api/chats/:id/handover
          const res = await fetch(`/api/chats/${activeChatId}/handover`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetRole })
          });
          const data = await res.json();
          if (res.ok) {
            await loadChats();
            loadActiveChat(data.newChatId);
            modal.close();
          } else {
            alert("Fehler bei der Übergabe: " + data.error);
          }
        }
      } catch (err) {
        console.error(err);
        alert("Fehler: " + err.message);
      } finally {
        btnExecute.disabled = false;
        btnExecute.textContent = 'Bestätigen';
      }
    });
  }
});

// --- VOICE I/O LOGIC (OpenAI API) ---
// (Variables isMicActive, isSpeakerActive, isHandsFreeActive are already declared at the top)
let mediaRecorder = null;
let audioChunks = [];
let currentAudioPlayback = null;
let speechTimeout = null;

let audioQueue = [];
let isPlayingAudio = false;

function toggleHandsFree() {
  isHandsFreeActive = !isHandsFreeActive;
  if (isHandsFreeActive) {
    elements.btnHandsfree.classList.add('active');
    if (!isSpeakerActive) toggleSpeaker();
  } else {
    elements.btnHandsfree.classList.remove('active');
  }
}

function stopAudioPlayback() {
  audioQueue = [];
  if (currentAudioPlayback) {
    currentAudioPlayback.pause();
    currentAudioPlayback.currentTime = 0;
    currentAudioPlayback = null;
  }
  isPlayingAudio = false;
  const btnIcon = elements.btnSpeaker ? elements.btnSpeaker.querySelector('i') : null;
  if (btnIcon) btnIcon.className = 'fa-solid fa-volume-high';
}

function toggleSpeaker() {
  isSpeakerActive = !isSpeakerActive;
  if (isSpeakerActive) {
    elements.btnSpeaker.classList.add('active');
  } else {
    elements.btnSpeaker.classList.remove('active');
    stopAudioPlayback();
  }
}

function toggleVoiceSpeed() {
  const currentIndex = VOICE_SPEEDS.indexOf(currentVoiceSpeed);
  const nextIndex = (currentIndex + 1) % VOICE_SPEEDS.length;
  currentVoiceSpeed = VOICE_SPEEDS[nextIndex];
  elements.btnVoiceSpeed.textContent = currentVoiceSpeed + 'x';
}

// Push to Talk / Toggle for Whisper
async function toggleMic() {
  if (!isMicActive) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      
      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      
      mediaRecorder.onstop = async () => {
        const mimeType = mediaRecorder.mimeType || '';
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
        audioChunks = [];
        stream.getTracks().forEach(t => t.stop());
        
        elements.chatInput.value = '... Transkribiere Audio ...';
        elements.chatInput.disabled = true;
        
        const formData = new FormData();
        formData.append('audio', audioBlob, `speech.${ext}`);
        
        const langSelect = document.getElementById('mic-language');
        if (langSelect && langSelect.value !== 'auto') {
          formData.append('language', langSelect.value);
        }
        
        try {
          const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          
          elements.chatInput.value = data.text;
          
          if (isHandsFreeActive && data.text && data.text.trim()) {
            elements.chatForm.dispatchEvent(new Event('submit'));
          }
        } catch (err) {
          console.error("Transcription error:", err);
          elements.chatInput.value = '';
          alert("Fehler bei der Audio-Erkennung.");
        } finally {
          elements.chatInput.disabled = false;
        }
      };
      
      mediaRecorder.start();
      isMicActive = true;
      elements.btnMic.classList.add('active');
      stopAudioPlayback(); // Stop KI talking when user talks
      
    } catch (err) {
      alert("Mikrofon-Zugriff verweigert oder nicht verfügbar.");
    }
  } else {
    // Stop Recording
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    isMicActive = false;
    elements.btnMic.classList.remove('active');
  }
}

// Text to Speech
function speakText(text) {
  if (!isSpeakerActive) return;
  
  // Clean markdown to make speech natural
  const cleanText = text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();

  if (!cleanText) return;

  // Immediately start the fetch to pre-load audio
  const fetchPromise = fetchTTS(cleanText);
  audioQueue.push({ text: cleanText, promise: fetchPromise });
  processAudioQueue();
}

async function fetchTTS(text) {
  let voice = 'nova';
  if (activeChatId) {
    const chat = chats.find(c => c.id === activeChatId);
    if (chat && chat.role && globalRoles[chat.role]) {
       voice = globalRoles[chat.role].voiceType === 'male' ? 'onyx' : 'nova';
    }
  }

  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, speed: currentVoiceSpeed })
  });
  
  if (!res.ok) throw new Error("TTS fetch failed");
  return res.blob();
}

async function processAudioQueue() {
  if (isPlayingAudio || audioQueue.length === 0) return;
  isPlayingAudio = true;
  
  const btnIcon = elements.btnSpeaker.querySelector('i');
  if (btnIcon) btnIcon.className = 'fa-solid fa-spinner fa-spin'; // Loading state
  
  const chunk = audioQueue.shift();
  
  try {
    const blob = await chunk.promise;
    const url = URL.createObjectURL(blob);
    currentAudioPlayback = new Audio(url);
    
    currentAudioPlayback.onended = () => {
       isPlayingAudio = false;
       URL.revokeObjectURL(url);
       
       if (audioQueue.length > 0) {
           processAudioQueue();
       } else {
           if (btnIcon) btnIcon.className = 'fa-solid fa-volume-high';
           // Auto start mic again in handsfree mode when ALL speech finishes
           if (isHandsFreeActive && !isMicActive) {
               toggleMic();
           }
       }
    };
    
    if (btnIcon) btnIcon.className = 'fa-solid fa-volume-high'; // Ready/Playing
    currentAudioPlayback.play();
    
  } catch (err) {
    console.error("TTS Error:", err);
    isPlayingAudio = false;
    processAudioQueue(); // Try next chunk
  }
}

async function exportToDocx(markdownContent) {
  try {
    showToast("Dokument wird exportiert...", "info");
    const response = await fetch('/api/export/docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: markdownContent, chatId: currentChatId })
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Fehler beim Export');
    }
    
    // Trigger file download
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'BrainExtender_Export.docx';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
    showToast("Export erfolgreich!", "success");
  } catch (error) {
    console.error("Export Error:", error);
    showToast("Fehler beim Export: " + error.message, "error");
  }
}
