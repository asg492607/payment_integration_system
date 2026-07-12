
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import { getDatabase, ref, onChildAdded, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

  const firebaseConfig = {
    apiKey: "AIzaSyCCoQaBHkp6XBIXATmn34-c89h8auPTe24",
    authDomain: "payment-2e43c.firebaseapp.com",
    databaseURL: "https://payment-2e43c-default-rtdb.firebaseio.com",
    projectId: "payment-2e43c",
    storageBucket: "payment-2e43c.firebasestorage.app",
    messagingSenderId: "1013570384920",
    appId: "1:1013570384920:web:8c547ffe53cc9cc8d1ff6d",
    measurementId: "G-37TCSNCEKD"
  };

  const fbApp = initializeApp(firebaseConfig);
  const analytics = getAnalytics(fbApp);
  const rtdb = getDatabase(fbApp);

  window._fbRTDB = rtdb;
  window._fbRef  = ref;
  window._fbOnChildAdded = onChildAdded;
  window._fbGet = get;
  window._fbReady = true;

  document.dispatchEvent(new Event('firebase-ready'));
