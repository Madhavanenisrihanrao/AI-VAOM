class VAOMApp {
    constructor() {
        this.orders = [];
        this.isRecording = false;
        this.isListeningForWakeWord = true;
        this.commandBuffer = '';
        this.silenceTimer = null;
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.apiBaseUrl = 'http://localhost:3001/api';
        this.sessionId = 'user-' + Math.random().toString(36).substr(2, 9);
        this.lastOrderId = null;
        this.isWaitingForClarification = false;
        this.isWaitingForConfirmation = false;
        this.clarificationContext = null;
        this.pendingAction = null;
        this.environment = 'Quiet';
        this.lastAction = '';
        this.totalTimeSaved = 0;
        this.wakeWord = 'volt';
        this.silenceDelay = 2000; // 2 seconds
        this._isRestarting = false;  // guard against duplicate restarts
        
        // Fuzzy wake word matching - words that sound like "Volt"
        this.fuzzyWakeWords = ['volt', 'bolt', 'old', 'vault', 'gold', 'bolt', 'vold', 'wolt'];
        
        this.initializeSpeechRecognition();
        this.bindEvents();
        this.loadOrders();
        this.loadSessionContext();
        this.initializeAnalytics();
    }

    // Check if transcript contains any fuzzy match for wake word
    detectFuzzyWakeWord(transcript) {
        const lowerTranscript = transcript.toLowerCase();
        
        // Check for exact or partial matches
        for (const word of this.fuzzyWakeWords) {
            if (lowerTranscript.includes(word)) {
                return word; // Return the matched word
            }
        }
        
        // Check for phonetic similarity (words starting with 'v', 'b', 'g' + 'olt' sound)
        const words = lowerTranscript.split(/\s+/);
        for (const word of words) {
            // Pattern: [vbg] + o + [l]* + [td] or similar
            if (/^[vbg][oa][lvu]*[lt][td]?$/.test(word) && word.length >= 3) {
                return word;
            }
        }
        
        return null;
    }

    // Strip wake word from command
    stripWakeWord(transcript, detectedWord) {
        if (!detectedWord) return transcript;
        
        // Remove the wake word and any common following punctuation/words
        let cleaned = transcript.toLowerCase();
        
        // Remove the detected wake word
        cleaned = cleaned.replace(detectedWord, '');
        
        // Remove common connecting words that follow wake words
        cleaned = cleaned.replace(/^\s*,?\s*/, ''); // Leading comma/space
        cleaned = cleaned.replace(/^\s*\(?\s*/, ''); // Leading parenthesis
        
        // Trim and return with original casing preserved if possible
        return cleaned.trim();
    }

    initializeSpeechRecognition() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';

            this.recognition.onstart = () => {
                console.log('🎤 Passive listening started... Say "Volt" to wake me up!');
                this.updateUI('idle');
            };

            this.recognition.onresult = (event) => {
                let finalTranscript = '';
                let interimTranscript = '';

                // Process results
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript;
                    } else {
                        interimTranscript += transcript;
                    }
                }

                const combinedTranscript = (finalTranscript + ' ' + interimTranscript).toLowerCase().trim();
                
                // Show real-time transcript
                this.showTranscript(interimTranscript || finalTranscript);

                // Wake word detection with fuzzy matching
                if (this.isListeningForWakeWord) {
                    const detectedWakeWord = this.detectFuzzyWakeWord(combinedTranscript);
                    if (detectedWakeWord) {
                        console.log(`⚡ Wake word "${detectedWakeWord}" detected! (fuzzy match for "Volt")`);
                        this.triggerWakeWordAnimation();
                        this.isListeningForWakeWord = false;
                        this.commandBuffer = '';
                        this.speak('Yes?');
                        
                        // Clear the transcript after wake word
                        setTimeout(() => this.showTranscript(''), 500);
                    }
                } else {
                    // Collecting command after wake word
                    const commandText = finalTranscript || interimTranscript;
                    if (commandText.trim()) {
                        this.commandBuffer = commandText;
                        this.updateUI('recording');
                        
                        // Reset silence timer on new speech
                        this.resetSilenceTimer();
                    }
                    
                    // Process final results - strip wake word before sending
                    if (finalTranscript.trim()) {
                        // Check if wake word is still in the transcript and remove it
                        const detectedWord = this.detectFuzzyWakeWord(finalTranscript);
                        const cleanCommand = this.stripWakeWord(finalTranscript, detectedWord);
                        
                        console.log('📝 Raw transcript:', finalTranscript);
                        console.log('🧹 Clean command (wake word stripped):', cleanCommand);
                        
                        this.processVoiceCommand(cleanCommand);
                    }
                }
            };

            this.recognition.onerror = (event) => {
                console.warn('Speech recognition error:', event.error);

                if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    // Microphone permission denied – can't recover without user action
                    this.updateUI('not-supported');
                    const statusText = document.getElementById('statusText');
                    if (statusText) statusText.textContent = '🎤 Microphone access denied. Please allow mic permission and refresh.';
                    return;
                }

                // All other errors (no-speech, audio-capture, network, aborted, etc.)
                // are recoverable – just restart after a short pause
                this.updateUI('idle');
                this._safeRestart(1000);
            };

            this.recognition.onend = () => {
                // Auto-restart for continuous passive listening
                if (!this.isRecording) {
                    this._safeRestart(300);
                }
            };

            // Start passive listening immediately
            this.startPassiveListening();
        } else {
            console.error('Speech recognition not supported');
            this.updateUI('not-supported');
        }
    }

    startPassiveListening() {
        try {
            this.recognition.start();
            this.isListeningForWakeWord = true;
            this.updateUI('idle');
        } catch (e) {
            console.log('Recognition already started');
        }
    }

    restartListening() {
        this._safeRestart(500);
    }

    _safeRestart(delayMs = 500) {
        if (this._isRestarting) return;   // already scheduled
        this._isRestarting = true;
        setTimeout(() => {
            this._isRestarting = false;
            this.isListeningForWakeWord = true;
            this.isRecording = false;
            this.commandBuffer = '';
            this.startPassiveListening();
        }, delayMs);
    }

    resetSilenceTimer() {
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
        }
        this.silenceTimer = setTimeout(() => {
            if (this.commandBuffer.trim()) {
                console.log('⏱️ Silence detected, processing command...');
                this.processVoiceCommand(this.commandBuffer.trim());
                this.commandBuffer = '';
                this.isListeningForWakeWord = true;
                this.updateUI('idle');
            }
        }, this.silenceDelay);
    }

    triggerWakeWordAnimation() {
        const voiceButton = document.getElementById('voiceButton');
        if (voiceButton) {
            // Alexa-style blue ring pulse
            voiceButton.style.boxShadow = '0 0 0 0 rgba(59, 130, 246, 0.7)';
            voiceButton.style.animation = 'pulse-blue 1s ease-out';
            
            // Add CSS animation if not already present
            if (!document.getElementById('pulse-animation')) {
                const style = document.createElement('style');
                style.id = 'pulse-animation';
                style.textContent = `
                    @keyframes pulse-blue {
                        0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
                        50% { box-shadow: 0 0 0 30px rgba(59, 130, 246, 0); }
                        100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
                    }
                    .wake-active {
                        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%) !important;
                        box-shadow: 0 0 20px rgba(59, 130, 246, 0.6) !important;
                    }
                `;
                document.head.appendChild(style);
            }
            
            voiceButton.classList.add('wake-active');
            
            setTimeout(() => {
                voiceButton.classList.remove('wake-active');
                voiceButton.style.animation = '';
            }, 2000);
        }
        
        // Show wake indicator
        this.showToast('⚡ Volt activated! Listening...', 'info');
    }

    bindEvents() {
        const voiceButton = document.getElementById('voiceButton');
        const clearAllBtn = document.getElementById('clearAll');
        const kioskToggle = document.getElementById('kiosk-toggle');

        voiceButton.addEventListener('click', () => {
            if (this.isRecording) {
                this.stopRecording();
            } else {
                this.startRecording();
            }
        });

        clearAllBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all orders?')) {
                this.clearAllOrders();
            }
        });

        // Kiosk Mode Toggle
        if (kioskToggle) {
            kioskToggle.addEventListener('click', () => {
                this.toggleKioskMode();
            });
        }
    }

    toggleKioskMode() {
        const kioskToggle = document.getElementById('kiosk-toggle');
        const environmentElement = document.getElementById('environmentMode');
        
        if (this.environment === 'Quiet') {
            this.environment = 'High Noise';
            if (kioskToggle) kioskToggle.textContent = 'ON';
            if (kioskToggle) kioskToggle.classList.add('bg-yellow-500', 'text-black');
            if (environmentElement) environmentElement.textContent = 'High Noise';
            this.showToast('Kiosk Mode: High Noise - Short responses enabled');
        } else {
            this.environment = 'Quiet';
            if (kioskToggle) kioskToggle.textContent = 'OFF';
            if (kioskToggle) kioskToggle.classList.remove('bg-yellow-500', 'text-black');
            if (environmentElement) environmentElement.textContent = 'Quiet';
            this.showToast('Kiosk Mode: Quiet - Normal responses');
        }
    }

    startRecording() {
        if (this.recognition && !this.isRecording) {
            this.recognition.start();
        }
    }

    stopRecording() {
        if (this.recognition && this.isRecording) {
            this.recognition.stop();
        }
    }

    updateUI(state) {
        const voiceButton = document.getElementById('voiceButton');
        const statusText = document.getElementById('statusText');
        const transcript = document.getElementById('transcript');
        const processing = document.getElementById('processingIndicator');

        switch (state) {
            case 'recording':
                if (voiceButton) {
                    voiceButton.classList.add('recording', 'wake-active');
                    voiceButton.innerHTML = '<i class="fas fa-microphone text-4xl"></i>';
                }
                if (statusText) statusText.textContent = 'Listening for command...';
                if (transcript) transcript.classList.remove('hidden');
                if (processing) processing.classList.add('hidden');
                break;
            case 'clarification':
                if (voiceButton) {
                    voiceButton.classList.add('recording', 'bg-orange-500');
                    voiceButton.innerHTML = '<i class="fas fa-microphone text-4xl"></i>';
                }
                if (statusText) statusText.textContent = 'Waiting for your response...';
                if (processing) processing.classList.add('hidden');
                break;
            case 'processing':
                if (voiceButton) {
                    voiceButton.classList.remove('recording', 'wake-active');
                    voiceButton.innerHTML = '<i class="fas fa-microphone text-4xl"></i>';
                }
                if (statusText) statusText.textContent = 'Processing your command...';
                if (processing) processing.classList.remove('hidden');
                break;
            case 'idle':
                if (voiceButton) {
                    voiceButton.classList.remove('recording', 'bg-orange-500', 'wake-active');
                    voiceButton.innerHTML = '<i class="fas fa-microphone text-4xl"></i>';
                }
                if (statusText) statusText.textContent = 'Say "Volt" to wake me up';
                if (processing) processing.classList.add('hidden');
                break;
            case 'error':
                if (voiceButton) {
                    voiceButton.classList.remove('recording', 'bg-orange-500', 'wake-active');
                    voiceButton.innerHTML = '<i class="fas fa-microphone text-4xl"></i>';
                }
                if (statusText) statusText.textContent = 'Error occurred. Restarting...';
                if (processing) processing.classList.add('hidden');
                break;
            case 'not-supported':
                if (voiceButton) {
                    voiceButton.disabled = true;
                    voiceButton.classList.add('opacity-50', 'cursor-not-allowed');
                }
                if (statusText) statusText.textContent = 'Speech recognition not supported in your browser';
                break;
        }
    }

    showTranscript(text) {
        const transcript = document.getElementById('transcript');
        const transcriptText = document.getElementById('transcriptText');
        
        transcript.classList.remove('hidden');
        transcriptText.textContent = text;
    }

    async processVoiceCommand(transcript) {
        this.updateUI('processing');
        
        // Clear silence timer
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
        }
        
        try {
            // Send to voice intent endpoint
            const response = await fetch(`${this.apiBaseUrl}/voice-intent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    command: transcript,
                    sessionId: this.sessionId,
                    environment: this.environment,
                    lastOrderId: this.lastOrderId
                })
            });

            const geminiResponse = await response.json();
            console.log('⚡ Volt Response:', geminiResponse);
            
            // Apply optimistic UI immediately
            if (geminiResponse.optimistic_ui) {
                this.applyOptimisticUI(geminiResponse.optimistic_ui);
            }
            
            // Update analytics display
            if (geminiResponse.analytics) {
                this.updateAnalyticsDisplay(geminiResponse.analytics);
            }
            
            // Update last order ID from response
            if (geminiResponse.data?.order_id) {
                this.lastOrderId = geminiResponse.data.order_id;
            }
            
            // Update total time saved
            if (geminiResponse.analytics?.time_saved) {
                this.totalTimeSaved += geminiResponse.analytics.time_saved;
                this.updateTimeSavedCounter();
            }
            
            // Show dashboard hint
            if (geminiResponse.dashboard_hint) {
                this.showToast(geminiResponse.dashboard_hint);
            }
            
            // Execute the action
            await this.executeGeminiAction(geminiResponse);
            
        } catch (error) {
            console.error('Error processing voice command:', error);
            this.speak('Sorry, I didn\'t catch that. Please say Volt and try again.');
        } finally {
            // Return to passive listening
            this.isListeningForWakeWord = true;
            this.isRecording = false;
            this.commandBuffer = '';
            this.updateUI('idle');
        }
    }

    async handleCreateCommand(transcript) {
        // Simple parsing for demo purposes
        const quantityMatch = transcript.match(/(\d+)/);
        const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
        
        // Extract item name (basic implementation)
        const items = ['pizza', 'burger', 'coffee', 'sandwich', 'salad', 'pasta'];
        const item = items.find(i => transcript.toLowerCase().includes(i)) || 'item';
        
        return {
            action: 'CREATE',
            data: { item, quantity },
            voice_response: `Wonderful choice! Adding ${quantity} ${item}${quantity > 1 ? 's' : ''} to your order right away.`
        };
    }

    async handleTrackCommand(transcript) {
        const orderMatch = transcript.match(/(\d+)/);
        if (orderMatch) {
            return {
                action: 'TRACK',
                data: { order_id: parseInt(orderMatch[1]) },
                voice_response: `Let me check on order ${orderMatch[1]} for you. One moment!`
            };
        } else {
            const items = ['pizza', 'burger', 'coffee', 'sandwich', 'salad', 'pasta'];
            const item = items.find(i => transcript.toLowerCase().includes(i));
            return {
                action: 'TRACK',
                data: { item },
                voice_response: `I'll look up your ${item} order status right now.`
            };
        }
    }

    async handleUpdateCommand(transcript) {
        const orderMatch = transcript.match(/(\d+)/);
        const quantityMatch = transcript.match(/(\d+)/);
        
        if (orderMatch) {
            return {
                action: 'UPDATE',
                data: { 
                    order_id: parseInt(orderMatch[1]),
                    quantity: quantityMatch ? parseInt(quantityMatch[1]) : null
                },
                voice_response: `Sure thing! Updating order ${orderMatch[1]} for you.`
            };
        }
        
        return {
            action: 'CLARIFY',
            data: null,
            voice_response: "I'd be happy to update that! Which order would you like me to change?"
        };
    }

    async handleDeleteCommand(transcript) {
        const orderMatch = transcript.match(/(\d+)/);
        if (orderMatch) {
            return {
                action: 'DELETE',
                data: { order_id: parseInt(orderMatch[1]) },
                voice_response: `No problem at all! Cancelling order ${orderMatch[1]} for you.`
            };
        }
        
        return {
            action: 'CLARIFY',
            data: null,
            voice_response: "I'd be happy to cancel that for you. Which order should I remove?"
        };
    }

    async executeExecutiveAction(executiveResponse) {
        const { action, data, voice_response } = executiveResponse;
        
        // Always speak the response (except for IGNORE)
        if (action !== 'IGNORE') {
            this.speak(voice_response);
        }
        
        // Update last action for context
        this.lastAction = action;
        
        try {
            switch (action) {
                case 'CREATE':
                    await this.createMultipleOrders(data);
                    break;
                case 'TRACK':
                    await this.trackOrder(data);
                    break;
                case 'UPDATE':
                    await this.updateOrder(data);
                    break;
                case 'DELETE':
                    await this.deleteOrder(data);
                    break;
                case 'CLARIFY':
                    this.handleClarification(executiveResponse);
                    break;
                case 'CONFIRM_EXECUTE':
                    await this.executeConfirmedAction(data);
                    break;
                case 'IGNORE':
                    // Silent ignore for background noise
                    break;
            }
        } catch (error) {
            console.error('Error executing action:', error);
            this.speak('Sorry, there was an error executing your request.');
        }
    }

    handleClarification(masterResponse) {
        if (masterResponse.data.require_confirmation) {
            this.isWaitingForConfirmation = true;
            this.pendingAction = masterResponse.data;
        } else {
            this.isWaitingForClarification = true;
            this.clarificationContext = masterResponse.data;
        }
        
        // Keep microphone hot for clarification response
        setTimeout(() => {
            if (this.isWaitingForClarification || this.isWaitingForConfirmation) {
                this.startRecording();
                this.updateUI('clarification');
            }
        }, 1500); // Wait for TTS to finish
    }

    async executeConfirmedAction(data) {
        // Execute the confirmed action based on the pending data
        if (data.order_id) {
            // This is likely a delete operation
            await this.deleteOrder({ order_id: data.order_id });
        } else if (data.items_list) {
            // This is likely a create operation
            await this.createMultipleOrders(data);
        }
        
        // Clear confirmation state
        this.isWaitingForConfirmation = false;
        this.pendingAction = null;
        
        // Trigger confetti for successful execution
        this.triggerConfetti();
    }

    applyOptimisticUI(optimisticUI) {
        const { action_preview, target_id, highlight_color } = optimisticUI;
        
        // Apply optimistic UI effects immediately
        if (action_preview) {
            switch (action_preview) {
                case 'ADDING_ITEMS':
                    // Show optimistic addition effect
                    this.showOptimisticEffect('adding');
                    break;
                case 'HIDING_ROW':
                    if (target_id) {
                        const targetRow = document.getElementById(`order-${target_id}`);
                        if (targetRow) {
                            targetRow.classList.add('optimistic-hiding');
                        }
                    }
                    break;
                case 'UPDATING_ITEM':
                case 'REPLACING_ITEM':
                    if (target_id) {
                        const targetRow = document.getElementById(`order-${target_id}`);
                        if (targetRow) {
                            targetRow.classList.add('optimistic-updating');
                        }
                    }
                    break;
                case 'HIGHLIGHTING_ROW':
                case 'HIGHLIGHTING_ROWS':
                    if (target_id) {
                        const targetRow = document.getElementById(`order-${target_id}`);
                        if (targetRow) {
                            targetRow.style.backgroundColor = highlight_color || '#3b82f6';
                            setTimeout(() => {
                                targetRow.style.backgroundColor = '';
                            }, 2000);
                        }
                    }
                    break;
            }
        }
    }
    
    showOptimisticEffect(type) {
        // Show a temporary optimistic UI indicator
        const indicator = document.createElement('div');
        indicator.className = `fixed top-20 right-4 px-4 py-2 rounded-lg shadow-lg z-50 optimistic-${type}`;
        indicator.innerHTML = `<i class="fas fa-plus mr-2"></i>Adding item...`;
        document.body.appendChild(indicator);
        
        setTimeout(() => {
            document.body.removeChild(indicator);
        }, 1000);
    }
    
    updateAnalyticsDisplay(analytics) {
        // Update intent confidence bar
        if (analytics.intent_confidence !== undefined) {
            const confidenceBar = document.getElementById('confidence-bar');
            const confidencePercent = Math.round(analytics.intent_confidence * 100);
            if (confidenceBar) {
                confidenceBar.style.width = `${confidencePercent}%`;
            }
        }
    }
    
    updateTimeSavedCounter() {
        const counter = document.getElementById('time-saved-counter');
        if (counter) {
            const minutes = Math.floor(this.totalTimeSaved / 60);
            const seconds = this.totalTimeSaved % 60;
            
            if (minutes > 0) {
                counter.textContent = `${minutes}m ${seconds}s`;
            } else {
                counter.textContent = `${seconds}s`;
            }
            
            // Flash animation
            counter.classList.add('animate-pulse', 'text-green-300');
            setTimeout(() => {
                counter.classList.remove('animate-pulse', 'text-green-300');
            }, 1000);
        }
    }
    
    async executeGeminiAction(geminiResponse) {
        const { action, data, voice_response, context_reset } = geminiResponse;
        
        // Always speak the response
        if (voice_response) {
            this.speak(voice_response);
        }
        
        try {
            switch (action) {
                case 'CREATE':
                    if (data.saved_order) {
                        // Order was already saved by backend
                        this.orders.push(data.saved_order);
                        this.lastOrderId = data.saved_order.id;
                        this.renderOrders();
                        
                        // Add glow effect to new row
                        setTimeout(() => {
                            const newRow = document.getElementById(`order-${data.saved_order.id}`);
                            if (newRow) {
                                newRow.classList.add('glow-green');
                                setTimeout(() => newRow.classList.remove('glow-green'), 2000);
                            }
                        }, 100);
                    }
                    break;
                    
                case 'UPDATE':
                    if (context_reset && data.saved_order) {
                        // Handle correction - update the last order
                        await this.loadOrders();
                        this.showToast(`✅ Corrected to ${data.item} x${data.quantity}`);
                    }
                    break;
                    
                case 'DELETE':
                    if (data.require_confirmation) {
                        // Show confirmation dialog
                        this.isWaitingForConfirmation = true;
                        this.pendingAction = data;
                        
                        // Pulse red the target row
                        if (data.order_id) {
                            const targetRow = document.getElementById(`order-${data.order_id}`);
                            if (targetRow) {
                                targetRow.classList.add('pulse-red');
                            }
                        }
                        
                        // Keep mic hot for response
                        setTimeout(() => {
                            if (this.isWaitingForConfirmation) {
                                this.startRecording();
                                this.updateUI('confirmation');
                            }
                        }, 2000);
                    }
                    break;
                    
                case 'CONFIRM_EXECUTE':
                    // Execute the pending delete
                    if (this.pendingAction?.order_id) {
                        await this.deleteOrder({ order_id: this.pendingAction.order_id });
                        this.triggerConfetti();
                    }
                    this.isWaitingForConfirmation = false;
                    this.pendingAction = null;
                    break;
            }
        } catch (error) {
            console.error('Error executing Gemini action:', error);
        }
    }
    
    initializeAnalytics() {
        // Load initial analytics from backend
        this.loadAnalytics();
        
        // Update environment mode display
        const environmentElement = document.getElementById('environmentMode');
        if (environmentElement) {
            environmentElement.textContent = this.environment;
        }
        
        // Welcome greeting after voices load
        setTimeout(() => {
            this.speak("Hello! I'm Volt, your AI assistant. Just say my name to get started!");
        }, 2000);
    }
    
    async loadAnalytics() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/analytics/${this.sessionId}`);
            if (response.ok) {
                const analytics = await response.json();
                this.totalTimeSaved = analytics.total_time_saved || 0;
                this.updateTimeSavedDisplay();
            }
        } catch (error) {
            console.error('Error loading analytics:', error);
        }
    }

    async handleClarificationResponse(transcript) {
        // Handle confirmation responses first
        if (this.isWaitingForConfirmation) {
            const confirmWords = ['yes', 'yeah', 'yep', 'sure', 'do it', 'confirm', 'execute', 'proceed'];
            const cancelWords = ['no', 'cancel', 'stop', 'never mind', 'abort'];
            
            if (confirmWords.some(word => transcript.toLowerCase().includes(word))) {
                await this.executeConfirmedAction(this.pendingAction);
            } else if (cancelWords.some(word => transcript.toLowerCase().includes(word))) {
                this.speak('Action cancelled.');
                this.showToast('Action cancelled');
            } else {
                this.speak('Please say yes or no.');
                return; // Keep microphone active
            }
            
            this.isWaitingForConfirmation = false;
            this.pendingAction = null;
            return;
        }
        
        // Handle regular clarification responses
        this.isWaitingForClarification = false;
        const context = this.clarificationContext;
        this.clarificationContext = null;
        
        // Build a complete command with the clarification context
        let fullCommand = transcript;
        
        if (context && context.items_list && context.items_list.length > 0) {
            // If we were asking for quantity, prepend the item
            const item = context.items_list[0].item;
            fullCommand = `${item} ${transcript}`;
        }
        
        // Process the complete command
        const response = await fetch(`${this.apiBaseUrl}/voice-intent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                command: fullCommand,
                sessionId: this.sessionId,
                environment: this.environment,
                lastAction: this.lastAction,
                currentOrderState: this.orders
            })
        });
        
        const executiveResponse = await response.json();
        
        // Apply optimistic UI
        if (executiveResponse.optimistic_ui) {
            this.applyOptimisticUI(executiveResponse.optimistic_ui);
        }
        
        // Update analytics
        if (executiveResponse.analytics) {
            this.updateAnalytics(executiveResponse.analytics);
        }
        
        // Execute the action
        await this.executeExecutiveAction(executiveResponse);
    }

    handleReject(aiResponse) {
        // Show error toast and reset
        this.showToast(aiResponse.dashboard_hint || 'Command not recognized', 'error');
        this.updateUI('idle');
    }

    async createMultipleOrders(data) {
        if (!data.items_list || data.items_list.length === 0) {
            return;
        }
        
        // Create orders for each item in the list
        for (const itemData of data.items_list) {
            const response = await fetch(`${this.apiBaseUrl}/orders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    item: itemData.item,
                    quantity: itemData.qty || 1
                })
            });
            
            if (response.ok) {
                const newOrder = await response.json();
                this.orders.push(newOrder);
                this.lastOrderId = newOrder.id; // Update context with last order
            }
        }
        
        this.renderOrders();
    }

    async trackOrder(data) {
        let order;
        if (data.order_id) {
            const response = await fetch(`${this.apiBaseUrl}/orders/${data.order_id}`);
            if (response.ok) {
                order = await response.json();
            }
        } else if (data.item) {
            // Find first order with matching item
            order = this.orders.find(o => o.item.toLowerCase().includes(data.item.toLowerCase()));
        }
        
        if (order) {
            this.speak(`Your ${order.item} order is ${order.status}.`);
            this.highlightOrder(order.id);
        } else {
            this.speak('Order not found.');
        }
    }

    async updateOrder(data) {
        const response = await fetch(`${this.apiBaseUrl}/orders/${data.order_id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status: 'updated' })
        });
        
        if (response.ok) {
            await this.loadOrders();
            this.speak(`Order ${data.order_id} has been updated.`);
        }
    }

    async deleteOrder(data) {
        const response = await fetch(`${this.apiBaseUrl}/orders/${data.order_id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            this.animateOrderDeletion(data.order_id);
            await this.loadOrders();
        }
    }

    async loadOrders() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/orders`);
            if (response.ok) {
                this.orders = await response.json();
                this.renderOrders();
            }
        } catch (error) {
            console.error('Error loading orders:', error);
            // Fallback to local storage for demo
            this.orders = JSON.parse(localStorage.getItem('orders') || '[]');
            this.renderOrders();
        }
    }

    renderOrders() {
        const tbody = document.getElementById('ordersTableBody');
        const orderCount = document.getElementById('orderCount');
        
        orderCount.textContent = this.orders.length;
        
        if (this.orders.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-8 text-gray-500">
                        No orders yet. Start by using voice commands!
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = this.orders.map(order => `
            <tr id="order-${order.id}" class="border-b hover:bg-gray-50 transition-colors">
                <td class="py-3 px-4 font-medium">#${order.id}</td>
                <td class="py-3 px-4">${order.item}</td>
                <td class="py-3 px-4">${order.quantity}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 text-xs rounded-full ${this.getStatusClass(order.status)}">
                        ${order.status}
                    </span>
                </td>
                <td class="py-3 px-4">
                    <button onclick="app.deleteOrderById(${order.id})" class="text-red-500 hover:text-red-700 transition-colors">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    getStatusClass(status) {
        const classes = {
            'pending': 'bg-yellow-100 text-yellow-800',
            'preparing': 'bg-blue-100 text-blue-800',
            'completed': 'bg-green-100 text-green-800',
            'cancelled': 'bg-red-100 text-red-800'
        };
        return classes[status] || 'bg-gray-100 text-gray-800';
    }

    async deleteOrderById(orderId) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/orders/${orderId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.animateOrderDeletion(orderId);
                await this.loadOrders();
            }
        } catch (error) {
            console.error('Error deleting order:', error);
        }
    }

    async clearAllOrders() {
        try {
            // Delete all orders
            for (const order of this.orders) {
                await fetch(`${this.apiBaseUrl}/orders/${order.id}`, {
                    method: 'DELETE'
                });
            }
            await this.loadOrders();
        } catch (error) {
            console.error('Error clearing orders:', error);
        }
    }

    // ElevenLabs TTS - Ultra-realistic AI voice
    async speak(text) {
        try {
            console.log('🎙️ Speaking:', text);
            
            // Cancel any ongoing speech
            if (this.synthesis?.speaking) {
                this.synthesis.cancel();
            }
            
            // Use ElevenLabs API for ultra-realistic voice
            const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/rachel', {
                method: 'POST',
                headers: {
                    'xi-api-key': 'sk_4f2c8b3a2e1c4a5d8b9c6d7e8f9a0b1c', // Replace with your API key
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text,
                    model_id: 'eleven_monolingual_v1',
                    voice_settings: {
                        stability: 0.75,
                        similarity_boost: 0.75
                    }
                })
            });
            
            if (!response.ok) {
                throw new Error('ElevenLabs API failed');
            }
            
            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            
            audio.play();
            
            // Clean up URL after audio plays
            audio.addEventListener('ended', () => {
                URL.revokeObjectURL(audioUrl);
            });
            
        } catch (error) {
            console.error('ElevenLabs TTS failed, falling back to browser TTS:', error);
            
            // Fallback to browser TTS if ElevenLabs fails
            if (!this.synthesis) {
                this.synthesis = window.speechSynthesis;
            }
            
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.pitch = 1.1;
            utterance.rate = 0.9;
            utterance.volume = 1.0;
            
            // Try to get a good voice
            const voices = this.synthesis.getVoices();
            const preferredVoice = voices.find(voice => 
                voice.name.includes('Google') && 
                voice.name.includes('UK') && 
                voice.name.includes('Female')
            ) || voices.find(voice => voice.name.includes('Google')) || voices[0];
            
            if (preferredVoice) {
                utterance.voice = preferredVoice;
                console.log('🎙️ Using fallback voice:', preferredVoice.name);
            }
            
            this.synthesis.speak(utterance);
        }
    }
    
    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 p-4 rounded-lg shadow-lg transform transition-all duration-300 translate-x-full z-50';
        
        // Style based on type
        if (type === 'error') {
            toast.classList.add('bg-red-500', 'text-white');
        } else {
            toast.classList.add('bg-green-500', 'text-white');
        }
        
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Animate in
        setTimeout(() => {
            toast.classList.remove('translate-x-full');
            toast.classList.add('translate-x-0');
        }, 100);
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.classList.add('translate-x-full');
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 3000);
    }

    async loadSessionContext() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/session/${this.sessionId}/context`);
            if (response.ok) {
                const context = await response.json();
                this.lastOrderId = context.lastOrderId;
            }
        } catch (error) {
            console.error('Error loading session context:', error);
        }
    }

    triggerConfetti() {
        const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'];
        
        for (let i = 0; i < 50; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.left = Math.random() * 100 + '%';
                confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
                document.body.appendChild(confetti);
                
                setTimeout(() => confetti.remove(), 3000);
            }, i * 30);
        }
    }

    highlightOrder(orderId) {
        const orderRow = document.getElementById(`order-${orderId}`);
        if (orderRow) {
            orderRow.classList.add('bg-blue-100', 'border-blue-300');
            setTimeout(() => {
                orderRow.classList.remove('bg-blue-100', 'border-blue-300');
            }, 2000);
        }
    }

    animateOrderDeletion(orderId) {
        const orderRow = document.getElementById(`order-${orderId}`);
        if (orderRow) {
            orderRow.classList.add('fade-out');
            setTimeout(() => {
                orderRow.remove();
            }, 500);
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new VAOMApp();
});
