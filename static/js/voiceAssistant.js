class VoiceAssistant {
    constructor() {
        this.initializeState();
        this.initializeSpeechRecognition();
        this.initializeSpeechSynthesis();
        this.cacheElements();
        
        this.initializeVAD().then(() => {
            this.setupEventListeners();
            this.loadVoices();
            this.updateStatus('Ready');
        }).catch(error => {
            this.showError('VAD initialization failed: ' + error.message);
        });
    }

    initializeState() {
        this.state = {
            isListening: false,
            isSpeaking: false,
            isProcessing: false,
            currentTranscript: '',
            lastProcessedTime: 0,
            processingLock: false,
            interruptionDetected: false,
            vadActive: false,
            lastVadUpdate: 0,
            lastActivityTime: Date.now()
        };
        this.currentVoiceType = 'indian-male';
        this.processingTimeout = null;
        this.recognitionRestartTimeout = null;
        this.vadResetTimeout = null;
        this.idleCheckInterval = null;
    }

    cacheElements() {
        this.elements = {
            startBtn: document.getElementById('startBtn'),
            stopBtn: document.getElementById('stopBtn'),
            voiceSelect: document.getElementById('voiceSelect'),
            chatContainer: document.getElementById('chatContainer'),
            statusText: document.getElementById('statusText'),
            statusIndicator: document.getElementById('statusIndicator')
        };
    }
    initializeSpeechRecognition() {
        window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new window.SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-IN';
        this.recognition.maxAlternatives = 1;

        this.setupRecognitionEventListeners();
    }

    setupRecognitionEventListeners() {
        this.recognition.onstart = () => {
            console.debug('Recognition started');
            this.state.isListening = true;
            this.updateStatus('Listening...', 'listening');
            this.updateControls();
        };

        this.recognition.onend = () => {
            console.debug('Recognition ended');
            if (!this.state.processingLock && !this.state.interruptionDetected) {
                this.scheduleRecognitionRestart();
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Recognition error:', event.error);
            this.handleRecognitionError(event);
        };

        this.recognition.onresult = (event) => {
            this.handleRecognitionResult(event);
        };
    }

    initializeSpeechSynthesis() {
        this.synthesis = window.speechSynthesis;
        this.voices = [];
        // Updated voice preferences with optimized parameters
        this.voicePreferences = {
            'indian-male': [
                { 
                    name: 'Microsoft Ravi - English (India)', 
                    rate: 1.1,      // Slightly faster
                    pitch: 1.0,     // Natural pitch
                    volume: 1.0,    // Full volume
                    voiceURI: 'Microsoft Ravi - English (India)'
                },
                { 
                    name: 'en-IN-Standard-B', 
                    rate: 1.15,
                    pitch: 1.05,
                    volume: 1.0,
                    voiceURI: 'en-IN-Standard-B'
                },
                { 
                    name: 'en-IN-Wavenet-B', 
                    rate: 1.1,
                    pitch: 1.02,
                    volume: 1.0,
                    voiceURI: 'en-IN-Wavenet-B'
                }
            ],
            'indian-female': [
                { 
                    name: 'Microsoft Heera - English (India)', 
                    rate: 1.1,
                    pitch: 1.02,
                    volume: 1.0,
                    voiceURI: 'Microsoft Heera - English (India)'
                },
                { 
                    name: 'en-IN-Standard-A', 
                    rate: 1.12,
                    pitch: 1.04,
                    volume: 1.0,
                    voiceURI: 'en-IN-Standard-A'
                },
                { 
                    name: 'en-IN-Wavenet-A', 
                    rate: 1.1,
                    pitch: 1.03,
                    volume: 1.0,
                    voiceURI: 'en-IN-Wavenet-A'
                }
            ]
        };
    }
    async initializeVAD() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            await this.audioContext.audioWorklet.addModule('/static/js/vad-processor.js');
            
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                    sampleRate: 48000
                } 
            });

            this.mediaStream = stream;
            const source = this.audioContext.createMediaStreamSource(stream);
            this.vadNode = new AudioWorkletNode(this.audioContext, 'vad-processor');
            
            this.vadNode.port.onmessage = (event) => this.handleVADMessage(event.data);
            
            source.connect(this.vadNode);
            
            this.startIdleCheck();
            
            return true;
        } catch (error) {
            console.error('VAD initialization failed:', error);
            throw error;
        }
    }

    startIdleCheck() {
        if (this.idleCheckInterval) {
            clearInterval(this.idleCheckInterval);
        }

        this.idleCheckInterval = setInterval(() => {
            const now = Date.now();
            if (now - this.state.lastActivityTime > 10000) {
                console.debug('Idle detected, restarting recognition');
                this.resetRecognition();
                this.startNewRecognition();
                this.state.lastActivityTime = now;
            }
        }, 5000);
    }

    handleVADMessage(data) {
        const now = Date.now();
        this.state.lastActivityTime = now;

        switch(data.type) {
            case 'vadStart':
                if (this.state.isSpeaking) {
                    this.handleInterruption();
                } else if (!this.state.isListening) {
                    this.startNewRecognition();
                }
                break;
            case 'vadEnd':
                if (this.state.isListening && !this.state.isProcessing) {
                    setTimeout(() => this.finalizeRecognition(), 500);
                }
                break;
            case 'vadInterrupt':
                this.handleInterruption();
                break;
            case 'vadReset':
                this.resetRecognition();
                this.startNewRecognition();
                break;
            case 'energyUpdate':
                this.updateVoiceActivity(data.energy, data.speaking);
                break;
        }
    }

    handleSpeechStart() {
        clearTimeout(this.recognitionRestartTimeout);
        clearTimeout(this.vadResetTimeout);
        
        if (this.state.isSpeaking) {
            this.handleInterruption();
        }
        
        if (!this.state.isListening && !this.state.isProcessing) {
            this.startNewRecognition();
        }
        
        this.state.vadActive = true;
    }

    handleSpeechEnd() {
        if (this.state.vadActive) {
            this.state.vadActive = false;
            
            if (this.state.isListening && !this.state.isProcessing) {
                this.vadResetTimeout = setTimeout(() => {
                    this.finalizeRecognition();
                }, 500); // Small delay to ensure we capture the full utterance
            }
        }
    }

    handleInterruption() {
        console.debug('Interruption detected');
        
        if (this.state.isSpeaking) {
            this.synthesis.cancel();
            this.state.isSpeaking = false;
        }
        
        if (this.state.isProcessing) {
            this.state.interruptionDetected = true;
            clearTimeout(this.processingTimeout);
        }
        
        this.resetRecognition();
        this.vadNode.port.postMessage({ type: 'reset' });
    }
    startNewRecognition() {
        try {
            this.state.currentTranscript = '';
            this.state.processingLock = false;
            this.state.interruptionDetected = false;
            this.recognition.start();
            this.updateStatus('Listening...', 'listening');
            this.updateControls();
        } catch (error) {
            console.error('Recognition start error:', error);
            this.resetRecognition();
        }
    }

    handleRecognitionResult(event) {
        const transcript = Array.from(event.results)
            .map(result => result[0].transcript)
            .join(' ');

        this.state.currentTranscript = transcript;

        if (event.results[0].isFinal) {
            this.finalizeRecognition();
        }
    }

    finalizeRecognition() {
        if (!this.state.processingLock && this.state.currentTranscript.trim()) {
            this.state.processingLock = true;
            this.processUserInput(this.state.currentTranscript.trim());
        }
        this.resetRecognition();
    }

    resetRecognition() {
        try {
            this.recognition.stop();
        } catch (error) {
            console.debug('Recognition stop error:', error);
        }
        
        this.state.isListening = false;
        this.state.currentTranscript = '';
        this.updateControls();
        
        this.scheduleRecognitionRestart();
    }

    scheduleRecognitionRestart() {
        clearTimeout(this.recognitionRestartTimeout);
        this.recognitionRestartTimeout = setTimeout(() => {
            if (!this.state.isListening && !this.state.isProcessing) {
                this.startNewRecognition();
            }
        }, 1000);
    }
    async processUserInput(text) {
        if (Date.now() - this.state.lastProcessedTime < 1000) {
            return; // Debounce processing
        }

        try {
            this.state.isProcessing = true;
            this.state.lastProcessedTime = Date.now();
            this.updateStatus('Processing...', 'processing');

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            if (!response.ok) throw new Error('API request failed');

            const data = await response.json();
            
            if (!this.state.interruptionDetected) {
                this.addMessage('user', text);
                this.addMessage('assistant', data.response);
                await this.speak(data.response);
            }

        } catch (error) {
            console.error('Processing error:', error);
            this.showError('Failed to process input');
        } finally {
            this.state.isProcessing = false;
            this.state.interruptionDetected = false;
            this.state.processingLock = false;
            this.updateStatus('Ready', 'ready');
            this.updateControls();
        }
    }

    async speak(text) {
        return new Promise((resolve) => {
            if (this.state.interruptionDetected) {
                resolve();
                return;
            }

            // Break text into sentences for more natural speech
            const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
            let currentSentence = 0;

            const speakNextSentence = () => {
                if (currentSentence < sentences.length && !this.state.interruptionDetected) {
                    const utterance = new SpeechSynthesisUtterance(sentences[currentSentence]);
                    const voiceSettings = this.getVoiceSettings();

                    // Apply optimized speech parameters
                    utterance.voice = voiceSettings.voice;
                    utterance.rate = voiceSettings.rate;
                    utterance.pitch = voiceSettings.pitch;
                    utterance.volume = voiceSettings.volume;

                    // Add SSML-like prosody for more natural speech
                    const processedText = this.addSpeechProsody(sentences[currentSentence]);
                    utterance.text = processedText;

                    // Add dynamic speech patterns
                    this.addSpeechPatterns(utterance);

                    utterance.onend = () => {
                        currentSentence++;
                        // Add natural pause between sentences
                        setTimeout(speakNextSentence, 150);
                    };

                    utterance.onerror = (event) => {
                        console.error('Speech synthesis error:', event);
                        currentSentence++;
                        speakNextSentence();
                    };

                    this.state.isSpeaking = true;
                    this.updateStatus('Speaking...', 'speaking');
                    this.synthesis.speak(utterance);
                } else {
                    this.state.isSpeaking = false;
                    this.updateStatus('Ready', 'ready');
                    resolve();
                }
            };

            speakNextSentence();
        });
    }

        // Add natural prosody to speech
    addSpeechProsody(text) {
        // Add slight emphasis to important words
        text = text.replace(/\b(important|crucial|significant|must|should|will|can)\b/gi, word => `<emphasis>${word}</emphasis>`);
        
        // Add pauses for punctuation
        text = text.replace(/,/g, ', ');
        text = text.replace(/;/g, '; ');
        text = text.replace(/:/g, ': ');
        
        // Add emphasis for questions
        if (text.includes('?')) {
            text = `<prosody rate="95%" pitch="+10%">${text}</prosody>`;
        }
        
        return text;
    }

    // Add dynamic speech patterns
    addSpeechPatterns(utterance) {
        // Adjust rate based on sentence length
        if (utterance.text.length > 100) {
            utterance.rate *= 1.05; // Slightly faster for long sentences
        } else if (utterance.text.length < 30) {
            utterance.rate *= 0.95; // Slightly slower for short sentences
        }

        // Adjust pitch for questions and exclamations
        if (utterance.text.includes('?')) {
            utterance.pitch *= 1.1; // Higher pitch for questions
        } else if (utterance.text.includes('!')) {
            utterance.pitch *= 1.05; // Slightly higher for exclamations
        }

        // Add volume variation
        if (utterance.text.includes('!')) {
            utterance.volume = 1.0; // Full volume for emphasis
        } else {
            utterance.volume = 0.95; // Slightly lower for normal speech
        }
    }

    getVoiceSettings() {
        const preferences = this.voicePreferences[this.currentVoiceType];
        for (const pref of preferences) {
            const voice = this.voices.find(v => v.name === pref.name);
            if (voice) {
                return { 
                    voice, 
                    rate: pref.rate, 
                    pitch: pref.pitch,
                    volume: pref.volume
                };
            }
        }
        
        // Fallback with optimized settings
        return {
            voice: this.voices.find(v => v.lang === 'en-IN') || this.voices[0],
            rate: 1.1,
            pitch: 1.02,
            volume: 1.0
        };
    }
    loadVoices() {
        this.voices = this.synthesis.getVoices();
        this.updateVoiceSelect();
    }

    updateVoiceSelect() {
        const select = this.elements.voiceSelect;
        select.innerHTML = '';
        
        Object.entries(this.voicePreferences).forEach(([type, voices]) => {
            const option = document.createElement('option');
            option.value = type;
            option.text = type === 'indian-male' ? 'Indian Male' : 'Indian Female';
            select.appendChild(option);
        });
        
        select.value = this.currentVoiceType;
    }

    setupEventListeners() {
        this.elements.voiceSelect.onchange = (e) => {
            this.currentVoiceType = e.target.value;
        };

        if (this.synthesis.onvoiceschanged !== undefined) {
            this.synthesis.onvoiceschanged = () => this.loadVoices();
        }

        this.elements.startBtn.onclick = () => this.startNewRecognition();
        this.elements.stopBtn.onclick = () => this.resetRecognition();
    }

    addMessage(role, text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}-message`;
        messageDiv.textContent = text;
        this.elements.chatContainer.appendChild(messageDiv);
        this.elements.chatContainer.scrollTop = this.elements.chatContainer.scrollHeight;
    }

    updateStatus(message, state = 'default') {
        this.elements.statusText.textContent = message;
        this.elements.statusIndicator.className = `status-indicator ${state}`;
    }

    showError(message) {
        console.error(message);
        this.updateStatus(`Error: ${message}`, 'error');
    }

    updateControls() {
        this.elements.startBtn.disabled = this.state.isListening || this.state.isProcessing;
        this.elements.stopBtn.disabled = !this.state.isListening || this.state.isProcessing;
    }

    cleanup() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        if (this.idleCheckInterval) {
            clearInterval(this.idleCheckInterval);
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    window.voiceAssistant = new VoiceAssistant();
});