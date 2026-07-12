
    const urlParams = new URLSearchParams(window.location.search);
    const amountParam = urlParams.get('amount') || '0';
    const planParam = urlParams.get('plan') || 'custom';
    const eId = window.location.pathname.split('/').pop();
    
    let currentOrderId = null;
    let pollInterval = null;
    let upiLinkStr = null;

    document.getElementById('display-amount').textContent = `₹${parseFloat(amountParam).toFixed(2)}`;

    // Fetch merchant branding
    async function loadMerchantBranding() {
      try {
        const res = await fetch(`/api/auth/merchant/${eId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            document.getElementById('display-merchant').innerHTML = `<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg> ${data.brand_name}</span>`;
            
            // Inject dynamic CSS
            const style = document.createElement('style');
            style.textContent = `
              :root {
                --primary: ${data.brand_color};
                --primary-hover: ${data.brand_color}ee;
              }
              .glow-1 {
                background: radial-gradient(circle, ${data.brand_color}40 0%, rgba(9,9,11,0) 70%);
              }
            `;
            document.head.appendChild(style);
          }
        }
      } catch (e) {}
    }
    loadMerchantBranding();

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    async function createOrder() {
      const name = document.getElementById('inp-name').value.trim();
      const email = document.getElementById('inp-email').value.trim();
      
      if(!name || !email) {
        alert("Please enter Name and Email");
        return;
      }

      const btn = document.getElementById('btn-pay');
      btn.textContent = 'Processing...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/orders/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, email, plan: planParam, enterprise_id: eId
          })
        });
        const data = await res.json();
        
        if(data.success) {
          currentOrderId = data.orderId;
          upiLinkStr = data.upiLink;
          
          document.getElementById('stage-init').style.display = 'none';
          document.getElementById('stage-qr').style.display = 'block';
          document.getElementById('qr-amount').textContent = `₹${parseFloat(data.amount).toFixed(2)}`;

          // Generate QR
          new QRCode(document.getElementById("qrcode"), {
            text: upiLinkStr, width: 200, height: 200,
            colorDark : "#000000", colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
          });

          if(isMobile) {
            document.getElementById('btn-upi-app').style.display = 'flex';
          }

          // Start Polling
          setTimeout(() => {
            document.getElementById('qr-overlay').classList.add('active');
          }, 3000);
          
          pollInterval = setInterval(pollPayment, 3000);
        } else {
          alert(data.error || 'Failed to create order');
          btn.textContent = 'Pay Now';
          btn.disabled = false;
        }
      } catch (err) {
        alert("Network error");
        btn.textContent = 'Pay Now';
        btn.disabled = false;
      }
    }

    function openUpiApp() {
      if(upiLinkStr) window.location.href = upiLinkStr;
    }

    async function pollPayment() {
      if(!currentOrderId) return;
      try {
        const r = await fetch('/api/orders/' + currentOrderId);
        const d = await r.json();
        if(d.order && d.order.status === 'paid') {
          clearInterval(pollInterval);
          document.getElementById('stage-success').classList.add('active');
        }
      } catch(e){}
    }
  