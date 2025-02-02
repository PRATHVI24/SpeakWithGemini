class VADProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // Optimized settings for real-time speech detection
        this.settings = {
            sampleRate: 48000,
            energyThreshold: -35,        // Higher threshold for clearer speech detection
            silenceThreshold: -45,       // Threshold for silence detection
            speakingThreshold: 0.5,      // Minimum time (seconds) of speech to trigger
            silenceThreshold: 0.3,       // Time (seconds) of silence to end speech
            frameSize: 480,              // 10ms at 48kHz
            smoothingFrames: 5,          // Number of frames for energy smoothing
            minValidFrames: 3,           // Minimum frames above threshold to confirm speech
            maxSilenceFrames: 15,        // Maximum silence frames before stopping
            debounceTime: 300,           // Milliseconds to wait before new detection
            interruptThreshold: -30,     // Higher energy threshold for interruption
            idleTimeout: 10000,          // 10 seconds idle timeout
            activityCheckInterval: 1000   // Check activity every second
        };

        this.state = {
            active: false,               // Currently processing speech
            speaking: false,             // Speech detected
            energy: new Array(this.settings.smoothingFrames).fill(-100),
            speechFrames: 0,
            silenceFrames: 0,
            lastTrigger: 0,
            currentUtterance: '',
            processingComplete: false,
            lastActivityTime: currentTime || performance.now(),  // Track last activity
            idleCheckTime: currentTime || performance.now()      // Track idle check time
        };

        this.port.onmessage = (event) => {
            if (event.data.type === 'reset') {
                this.resetState();
            }
        };
    }

    resetState() {
        const currentTime = currentTime || performance.now();
        this.state = {
            active: false,
            speaking: false,
            energy: new Array(this.settings.smoothingFrames).fill(-100),
            speechFrames: 0,
            silenceFrames: 0,
            lastTrigger: 0,
            currentUtterance: '',
            processingComplete: false,
            lastActivityTime: currentTime,
            idleCheckTime: currentTime
        };
    }

    calculateEnergy(samples) {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return 20 * Math.log10(Math.sqrt(sum / samples.length) + 1e-10);
    }

    detectSpeech(currentEnergy) {
        // Update energy history
        this.state.energy.push(currentEnergy);
        this.state.energy.shift();
        
        // Calculate smoothed energy
        const avgEnergy = this.state.energy.reduce((a, b) => a + b) / this.state.energy.length;
        
        // Update activity time if energy is above threshold
        if (avgEnergy > this.settings.silenceThreshold) {
            this.state.lastActivityTime = currentTime || performance.now();
        }
        
        // Check for interruption
        if (this.state.speaking && 
            currentEnergy > this.settings.interruptThreshold && 
            currentEnergy > avgEnergy + 10) {
            return 'interrupt';
        }

        // Normal speech detection
        if (avgEnergy > this.settings.energyThreshold) {
            this.state.speechFrames++;
            this.state.silenceFrames = 0;
            
            if (this.state.speechFrames >= this.settings.minValidFrames) {
                return 'speaking';
            }
        } else {
            this.state.speechFrames = Math.max(0, this.state.speechFrames - 1);
            
            if (this.state.speaking) {
                this.state.silenceFrames++;
                if (this.state.silenceFrames >= this.settings.maxSilenceFrames) {
                    return 'silence';
                }
            }
        }
        
        return null;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const currentTime = currentTime || performance.now();
        const samples = input[0];
        
        // Check for idle timeout
        if (currentTime - this.state.idleCheckTime >= this.settings.activityCheckInterval) {
            this.state.idleCheckTime = currentTime;
            
            if (currentTime - this.state.lastActivityTime >= this.settings.idleTimeout) {
                this.port.postMessage({
                    type: 'vadReset',
                    time: currentTime,
                    reason: 'idle_timeout'
                });
                this.resetState();
                return true;
            }
        }
        
        // Don't process if in debounce period
        if (currentTime - this.state.lastTrigger < this.settings.debounceTime) {
            return true;
        }

        const currentEnergy = this.calculateEnergy(samples);
        const speechState = this.detectSpeech(currentEnergy);

        switch (speechState) {
            case 'interrupt':
                if (!this.state.processingComplete) {
                    this.port.postMessage({
                        type: 'vadInterrupt',
                        time: currentTime
                    });
                    this.resetState();
                }
                break;

            case 'speaking':
                if (!this.state.speaking) {
                    this.state.speaking = true;
                    this.state.active = true;
                    this.state.lastTrigger = currentTime;
                    this.state.lastActivityTime = currentTime;
                    this.port.postMessage({
                        type: 'vadStart',
                        time: currentTime
                    });
                }
                break;

            case 'silence':
                if (this.state.speaking) {
                    this.state.speaking = false;
                    this.state.processingComplete = true;
                    this.port.postMessage({
                        type: 'vadEnd',
                        time: currentTime
                    });
                    
                    // Reset after processing
                    setTimeout(() => {
                        if (!this.state.speaking) {
                            this.resetState();
                        }
                    }, this.settings.debounceTime);
                }
                break;
        }

        // Send energy updates for visualization
        if (currentTime % 100 === 0) {
            this.port.postMessage({
                type: 'energyUpdate',
                energy: currentEnergy,
                speaking: this.state.speaking,
                active: this.state.active
            });
        }

        return true;
    }
}

registerProcessor('vad-processor', VADProcessor);