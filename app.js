// ATLAS PWA - Main Application Logic
// Version: 3.0.0

// Configuration
const CONFIG = {
    apiEndpoint: 'https://n8n.srv1194059.hstgr.cloud/webhook/atlas-pwa',
    correctPIN: '135011633', // PIN for authentication
    maxFileSize: 10 * 1024 * 1024, // 10MB
    supportedFileTypes: {
        documents: ['.pdf', '.docx', '.txt', '.md'],
        images: ['.jpg', '.jpeg', '.png'],
        code: ['.js', '.py', '.java', '.cpp', '.c', '.h', '.cs', '.html', '.css', '.json', '.xml']
    }
};

// State
let currentFile = null;
let messageHistory = [];
let sessionId = null;

// Session Management
function getOrCreateSessionId() {
    let storedSessionId = localStorage.getItem('atlas_session_id');

    if (!storedSessionId) {
        // Generate new UUID v4
        storedSessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('atlas_session_id', storedSessionId);
        console.log('🆔 New session created:', storedSessionId);
    } else {
        console.log('🆔 Existing session:', storedSessionId);
    }

    return storedSessionId;
}

// DOM Elements
const elements = {
    chatContainer: document.getElementById('chatContainer'),
    chatForm: document.getElementById('chatForm'),
    messageInput: document.getElementById('messageInput'),
    sendButton: document.getElementById('sendButton'),
    fileButton: document.getElementById('fileButton'),
    fileInput: document.getElementById('fileInput'),
    filePreview: document.getElementById('filePreview'),
    fileName: document.getElementById('fileName'),
    removeFile: document.getElementById('removeFile'),
    statusIndicator: document.getElementById('statusIndicator')
};

// PIN Authentication
function checkAuthentication() {
    const isAuthenticated = localStorage.getItem('atlas_authenticated') === 'true';
    const pinOverlay = document.getElementById('pinOverlay');
    const app = document.getElementById('app');

    if (isAuthenticated) {
        // Already authenticated - hide PIN overlay
        pinOverlay.style.display = 'none';
        app.style.display = 'block';
        return true;
    } else {
        // Not authenticated - show PIN overlay
        pinOverlay.style.display = 'flex';
        app.style.display = 'none';
        setupPINForm();
        return false;
    }
}

function setupPINForm() {
    const pinForm = document.getElementById('pinForm');
    const pinInput = document.getElementById('pinInput');
    const pinError = document.getElementById('pinError');

    pinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const enteredPIN = pinInput.value.trim();

        if (enteredPIN === CONFIG.correctPIN) {
            // Correct PIN - authenticate
            localStorage.setItem('atlas_authenticated', 'true');
            pinError.classList.add('hidden');

            // Hide PIN overlay, show app
            document.getElementById('pinOverlay').style.display = 'none';
            document.getElementById('app').style.display = 'block';

            // Focus on message input
            elements.messageInput.focus();
        } else {
            // Wrong PIN - show error
            pinError.classList.remove('hidden');
            pinInput.value = '';
            pinInput.focus();

            // Shake animation
            pinError.style.animation = 'none';
            setTimeout(() => {
                pinError.style.animation = 'shake 0.3s';
            }, 10);
        }
    });
}

// Initialize App
function init() {
    console.log('🚀 ATLAS PWA Initializing...');

    // Check authentication first
    if (!checkAuthentication()) {
        console.log('🔒 Waiting for PIN authentication...');
        return; // Don't initialize app until authenticated
    }

    // Initialize session ID
    sessionId = getOrCreateSessionId();

    // Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('✅ Service Worker registered:', registration.scope);
            })
            .catch(error => {
                console.error('❌ Service Worker registration failed:', error);
            });
    }

    // Setup event listeners
    setupEventListeners();

    // Auto-resize textarea
    autoResizeTextarea();

    // Check for PWA install prompt
    setupPWAInstall();

    console.log('✅ ATLAS PWA Ready');
}

// Logout Function
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('atlas_authenticated');
        location.reload();
    }
}

// Event Listeners
function setupEventListeners() {
    // Logout button
    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) {
        logoutButton.addEventListener('click', logout);
    }

    // Form submission
    elements.chatForm.addEventListener('submit', handleSubmit);

    // File upload button
    elements.fileButton.addEventListener('click', () => {
        elements.fileInput.click();
    });

    // File selection
    elements.fileInput.addEventListener('change', handleFileSelect);

    // Remove file button
    elements.removeFile.addEventListener('click', clearFile);

    // Textarea auto-grow
    elements.messageInput.addEventListener('input', autoResizeTextarea);

    // Shift+Enter for new line, Enter to send
    elements.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            elements.chatForm.dispatchEvent(new Event('submit'));
        }
    });
}

// Handle Message Submit
async function handleSubmit(e) {
    e.preventDefault();

    const message = elements.messageInput.value.trim();

    if (!message && !currentFile) {
        return;
    }

    // Disable input during processing
    setLoading(true);

    // Add user message to chat
    const userMessage = {
        role: 'user',
        content: message,
        file: currentFile ? {
            name: currentFile.name,
            size: currentFile.size,
            type: currentFile.type
        } : null,
        timestamp: new Date()
    };

    addMessageToChat(userMessage);
    messageHistory.push(userMessage);

    // Clear input
    elements.messageInput.value = '';
    const fileToSend = currentFile;
    clearFile();
    autoResizeTextarea();

    try {
        // Send to n8n
        const response = await sendToAPI(message, fileToSend);

        // Add assistant response
        const assistantMessage = {
            role: 'assistant',
            content: response.message || response.text || 'I received your message.',
            timestamp: new Date()
        };

        addMessageToChat(assistantMessage);
        messageHistory.push(assistantMessage);

    } catch (error) {
        console.error('Error sending message:', error);

        // Show error message
        const errorMessage = {
            role: 'assistant',
            content: `❌ Error: ${error.message || 'Failed to send message. Please try again.'}`,
            timestamp: new Date(),
            isError: true
        };

        addMessageToChat(errorMessage);
    } finally {
        setLoading(false);
        elements.messageInput.focus();
    }
}

// Send to n8n API
async function sendToAPI(message, file) {
    let body;
    let headers = {};

    if (file) {
        // For file uploads, use FormData
        const formData = new FormData();
        formData.append('message', message);
        formData.append('session_id', sessionId);
        formData.append('file', file);
        body = formData;
    } else {
        // For text-only, use JSON
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({
            message: message,
            session_id: sessionId
        });
    }

    const response = await fetch(CONFIG.apiEndpoint, {
        method: 'POST',
        headers: headers,
        body: body
    });

    if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    return await response.json();
}

// Add Message to Chat UI
function addMessageToChat(message) {
    // Remove welcome message if present
    const welcomeMsg = document.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.role}${message.isError ? ' error' : ''}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = message.role === 'user' ? '👤' : '⚡';

    const content = document.createElement('div');
    content.className = 'message-content';

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.content;
    content.appendChild(text);

    // Add file info if present
    if (message.file) {
        const fileInfo = document.createElement('div');
        fileInfo.className = 'message-file-info';
        fileInfo.textContent = `📎 ${message.file.name} (${formatFileSize(message.file.size)})`;
        content.appendChild(fileInfo);
    }

    // Add timestamp
    const timestamp = document.createElement('div');
    timestamp.className = 'message-timestamp';
    timestamp.textContent = formatTime(message.timestamp);
    content.appendChild(timestamp);

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);

    elements.chatContainer.appendChild(messageDiv);

    // Scroll to bottom
    elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

// Handle File Selection
function handleFileSelect(e) {
    const file = e.target.files[0];

    if (!file) {
        return;
    }

    // Check file size
    if (file.size > CONFIG.maxFileSize) {
        alert(`File too large! Maximum size is ${formatFileSize(CONFIG.maxFileSize)}`);
        e.target.value = '';
        return;
    }

    // Check file type
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
    const allSupportedTypes = [
        ...CONFIG.supportedFileTypes.documents,
        ...CONFIG.supportedFileTypes.images,
        ...CONFIG.supportedFileTypes.code
    ];

    if (!allSupportedTypes.includes(fileExt)) {
        alert(`Unsupported file type: ${fileExt}\n\nSupported types:\n${allSupportedTypes.join(', ')}`);
        e.target.value = '';
        return;
    }

    // Store file
    currentFile = file;

    // Show preview
    elements.fileName.textContent = `${file.name} (${formatFileSize(file.size)})`;
    elements.filePreview.classList.remove('hidden');

    // Clear input value to allow re-selecting same file
    e.target.value = '';
}

// Clear File Selection
function clearFile() {
    currentFile = null;
    elements.filePreview.classList.add('hidden');
    elements.fileName.textContent = '';
    elements.fileInput.value = '';
}

// Auto-resize Textarea
function autoResizeTextarea() {
    const textarea = elements.messageInput;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// Set Loading State
function setLoading(isLoading) {
    elements.sendButton.disabled = isLoading;
    elements.fileButton.disabled = isLoading;
    elements.messageInput.disabled = isLoading;

    if (isLoading) {
        elements.statusIndicator.classList.remove('hidden');

        // Add loading message
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message assistant';
        loadingDiv.id = 'loading-message';

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = '⚡';

        const content = document.createElement('div');
        content.className = 'message-content';
        content.innerHTML = `
            <div class="message-text">
                <div class="loading-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;

        loadingDiv.appendChild(avatar);
        loadingDiv.appendChild(content);

        elements.chatContainer.appendChild(loadingDiv);
        elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
    } else {
        elements.statusIndicator.classList.add('hidden');

        // Remove loading message
        const loadingMsg = document.getElementById('loading-message');
        if (loadingMsg) {
            loadingMsg.remove();
        }
    }
}

// PWA Install Prompt
function setupPWAInstall() {
    let deferredPrompt;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;

        // Show custom install prompt
        showInstallPrompt(deferredPrompt);
    });

    window.addEventListener('appinstalled', () => {
        console.log('✅ PWA installed successfully');
        deferredPrompt = null;
    });
}

function showInstallPrompt(deferredPrompt) {
    const promptDiv = document.createElement('div');
    promptDiv.className = 'install-prompt';
    promptDiv.innerHTML = `
        <span>📱 Install ATLAS app for quick access</span>
        <button id="installButton">Install</button>
        <button id="dismissButton" style="background: transparent; border: 1px solid var(--border-color);">Not now</button>
    `;

    document.body.appendChild(promptDiv);

    document.getElementById('installButton').addEventListener('click', async () => {
        promptDiv.remove();
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to install prompt: ${outcome}`);
        deferredPrompt = null;
    });

    document.getElementById('dismissButton').addEventListener('click', () => {
        promptDiv.remove();
    });
}

// Utility Functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatTime(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Initialize on DOM loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
