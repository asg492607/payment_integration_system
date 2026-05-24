package com.payforge.sms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "PayForgeSmsReceiver";
    // Using the live render URL. In production, this might be configurable.
    private static final String WEBHOOK_URL = "https://payment-integration-system.onrender.com/api/orders/sms";
    
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        if ("android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) {
            
            SharedPreferences prefs = context.getSharedPreferences("PayForgePrefs", Context.MODE_PRIVATE);
            String enterpriseId = prefs.getString("ENTERPRISE_ID", "");
            String webhookSecret = prefs.getString("WEBHOOK_SECRET", "");

            // If not configured, ignore SMS
            if (enterpriseId.isEmpty() || webhookSecret.isEmpty()) return;

            Bundle bundle = intent.getExtras();
            if (bundle != null) {
                Object[] pdus = (Object[]) bundle.get("pdus");
                if (pdus != null) {
                    for (Object pdu : pdus) {
                        SmsMessage smsMessage = SmsMessage.createFromPdu((byte[]) pdu);
                        String sender = smsMessage.getDisplayOriginatingAddress();
                        String messageBody = smsMessage.getMessageBody();

                        Log.d(TAG, "SMS Received from: " + sender);
                        
                        // We forward the SMS in a background thread so we don't block the UI/receiver thread
                        forwardSms(enterpriseId, webhookSecret, sender, messageBody);
                    }
                }
            }
        }
    }

    private void forwardSms(String enterpriseId, String secret, String sender, String message) {
        executor.execute(() -> {
            try {
                URL url = new URL(WEBHOOK_URL);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setRequestProperty("x-sms-webhook-secret", secret);
                conn.setDoOutput(true);

                // Build JSON payload
                String jsonInputString = String.format(
                    "{\"enterprise_id\": \"%s\", \"sender\": \"%s\", \"message\": \"%s\"}",
                    escapeJson(enterpriseId), escapeJson(sender), escapeJson(message)
                );

                try (OutputStream os = conn.getOutputStream()) {
                    byte[] input = jsonInputString.getBytes("utf-8");
                    os.write(input, 0, input.length);
                }

                int responseCode = conn.getResponseCode();
                Log.d(TAG, "Webhook Response Code: " + responseCode);

            } catch (Exception e) {
                Log.e(TAG, "Failed to forward SMS", e);
            }
        });
    }

    private String escapeJson(String s) {
        return s.replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
    }
}
