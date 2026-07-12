
    window.soundboxEnabled = false;
    function toggleSoundbox() {
      window.soundboxEnabled = !window.soundboxEnabled;
      const btn = document.getElementById('btn-soundbox');
      if (window.soundboxEnabled) {
        btn.innerHTML = '🔊 Soundbox: ON';
        btn.style.background = 'var(--indigo)';
        playTTS("Virtual Soundbox Activated for Cashier.");
      } else {
        btn.innerHTML = '🔇 Soundbox: OFF';
        btn.style.background = 'var(--surface)';
      }
    }

    function playTTS(text) {
      if (!('speechSynthesis' in window)) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-IN';
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  