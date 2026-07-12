
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getDatabase, ref, onChildAdded } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

    const firebaseConfig = {
      apiKey: "AIzaSyCCoQaBHkp6XBIXATmn34-c89h8auPTe24",
      databaseURL: "https://payment-2e43c-default-rtdb.firebaseio.com",
      projectId: "payment-2e43c"
    };

    const app = initializeApp(firebaseConfig);
    const rtdb = getDatabase(app);

    const urlParams = new URLSearchParams(window.location.search);
    const eId = urlParams.get('eid');

    if(!eId) {
      document.getElementById('feed').innerHTML = '<div class="empty">Invalid Link. Missing Enterprise ID.</div>';
    } else {
      const eventsRef = ref(rtdb, `events/${eId}`);
      onChildAdded(eventsRef, (snapshot) => {
        const evt = snapshot.val();
        if (evt && evt.type === 'PAYMENT_VERIFIED') {
          addEventToFeed(evt);
          if (window.soundboxEnabled) {
            playTTS(`Payment of rupees ${evt.amount} received.`);
          }
          showToast(`₹${evt.amount} Received!`);
        }
      });
    }

    function addEventToFeed(evt) {
      const empty = document.getElementById('empty-state');
      if(empty) empty.remove();
      
      const el = document.createElement('div');
      el.className = 'event';
      const timeStr = new Date(evt.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
      el.innerHTML = `
        <div>
          <div style="font-weight:700">Verified by ${evt.verifiedBy || 'System'}</div>
          <div class="time">Order: ${evt.orderId} • ${timeStr}</div>
        </div>
        <div class="amt">₹${evt.amount}</div>
      `;
      const feed = document.getElementById('feed');
      feed.insertBefore(el, feed.firstChild);
    }

    function showToast(msg) {
      const c = document.getElementById('toast-container');
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = msg;
      c.appendChild(t);
      setTimeout(() => { t.style.opacity=0; setTimeout(()=>t.remove(), 300); }, 4000);
    }
  