
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getDatabase, ref, onValue, onChildAdded } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

    const firebaseConfig = {
      apiKey: "AIzaSyCCoQaBHkp6XBIXATmn34-c89h8auPTe24",
      databaseURL: "https://payment-2e43c-default-rtdb.firebaseio.com",
      projectId: "payment-2e43c"
    };

    const app = initializeApp(firebaseConfig);
    const rtdb = getDatabase(app);

    const urlParams = new URLSearchParams(window.location.search);
    const eId = urlParams.get('eid');
    let brandColor = '#4f46e5';
    let brandName = 'Verified Merchant';

    // UI Switching
    function showScreen(id) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    }

    // Audio Alert
    function playAudioAlert(amount) {
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(`Payment of rupees ${amount} received.`);
        utterance.lang = 'en-IN';
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
      }
    }

    if (!eId) {
      document.getElementById('idle-brand').textContent = 'Invalid Link';
    } else {
      // 1. Fetch Branding
      fetch(`/api/auth/merchant/${eId}`).then(r => r.json()).then(data => {
        if(data.success) {
          brandColor = data.brand_color || '#4f46e5';
          brandName = data.brand_name || 'Verified Merchant';
          document.documentElement.style.setProperty('--primary', brandColor);
          document.getElementById('idle-brand').textContent = brandName;
          document.getElementById('qr-brand').textContent = brandName;
        }
      }).catch(e=>{});

      // 2. Listen for POS State changes (from cashier)
      const stateRef = ref(rtdb, `pos_state/${eId}`);
      onValue(stateRef, (snapshot) => {
        const state = snapshot.val();
        if(!state) return showScreen('screen-idle');

        if(state.status === 'idle') {
          showScreen('screen-idle');
        } 
        else if(state.status === 'waiting' && state.upiLink) {
          // Render QR
          document.getElementById('display-amount').textContent = `₹${parseFloat(state.amount).toFixed(2)}`;
          document.getElementById('qrcode').innerHTML = ''; // clear old
          new QRCode(document.getElementById("qrcode"), {
            text: state.upiLink, width: 300, height: 300,
            colorDark : "#000000", colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
          });
          
          // Render Receipt if cartItems exist
          const receiptCard = document.getElementById('receipt-card');
          const receiptItems = document.getElementById('receipt-items');
          if (state.cartItems && state.cartItems.length > 0) {
            receiptCard.style.display = 'flex';
            let html = '';
            state.cartItems.forEach(item => {
               const itemTotal = item.qty * parseFloat(item.price);
               html += `<div class="receipt-item">
                 <span class="receipt-item-name">${item.qty}x ${item.name}</span>
                 <span class="receipt-item-price">₹${itemTotal.toFixed(2)}</span>
               </div>`;
            });
            receiptItems.innerHTML = html;
            document.getElementById('receipt-total').textContent = `₹${parseFloat(state.amount).toFixed(2)}`;
          } else {
            // Hide receipt side if simple amount push
            receiptCard.style.display = 'none';
          }
          
          showScreen('screen-qr');
        }
      });

      // 3. Listen for Payment Verification Events
      const eventsRef = ref(rtdb, `events/${eId}`);
      onChildAdded(eventsRef, (snapshot) => {
        const evt = snapshot.val();
        // Check if we are currently waiting for a payment
        const activeScreen = document.querySelector('.screen.active');
        if (evt && evt.type === 'PAYMENT_VERIFIED' && activeScreen.id === 'screen-qr') {
          // If we receive ANY payment while waiting, assume it's this one (or we could match orderId)
          
          // Render receipt QR
          document.getElementById('receipt-qrcode').innerHTML = '';
          if (evt.orderId) {
            new QRCode(document.getElementById("receipt-qrcode"), {
              text: `${window.location.origin}/invoice/${evt.orderId}`,
              width: 150, height: 150,
              colorDark : "#000000", colorLight : "#ffffff",
              correctLevel : QRCode.CorrectLevel.M
            });
          }

          showScreen('screen-success');
          playAudioAlert(evt.amount);
          
          // Auto-reset back to idle after 15 seconds so customer has time to scan
          setTimeout(() => {
            fetch('/api/admin/pos/clear', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` }
            }).catch(e=>{}); // best effort
            showScreen('screen-idle');
          }, 15000);
        }
      });
    }
    
    // Initial click to enable audio policy
    document.body.addEventListener('click', () => {
      if ('speechSynthesis' in window) {
        let u = new SpeechSynthesisUtterance('');
        u.volume = 0; window.speechSynthesis.speak(u);
      }
    }, { once: true });
  