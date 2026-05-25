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
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "PayForgeSmsReceiver";
    // Using the live render URL. In production, this might be configurable.
    private static final String WEBHOOK_URL = "https://payment-integration-system.onrender.com/api/orders/sms";
    
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if ("android.provider.Telephony.SMS_RECEIVED".equals(action)) {
            SharedPreferences prefs = context.getSharedPreferences("PayForgePrefs", Context.MODE_PRIVATE);
            String enterpriseId = prefs.getString("ENTERPRISE_ID", "");
            String webhookSecret = prefs.getString("WEBHOOK_SECRET", "");

            // If not configured, ignore SMS
            if (enterpriseId.isEmpty() || webhookSecret.isEmpty()) return;

            Bundle bundle = intent.getExtras();
            if (bundle != null) {
                Object[] pdus = (Object[]) bundle.get("pdus");
                if (pdus != null) {
                    String format = bundle.getString("format");
                    for (Object pdu : pdus) {
                        SmsMessage smsMessage = SmsMessage.createFromPdu((byte[]) pdu, format);
                        String sender = smsMessage.getDisplayOriginatingAddress();
                        String messageBody = smsMessage.getMessageBody();

                        Log.d(TAG, "SMS Received from: " + sender);
                        
                        // We forward the SMS in a background thread so we don't block the UI/receiver thread
                        forwardSms(context, enterpriseId, webhookSecret, sender, messageBody);
                    }
                }
            }
        }
    }

    private void forwardSms(Context context, String enterpriseId, String secret, String sender, String message) {
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
                    byte[] input = jsonInputString.getBytes(StandardCharsets.UTF_8);
                    os.write(input, 0, input.length);
                }

                int responseCode = conn.getResponseCode();
                Log.d(TAG, "Webhook Response Code: " + responseCode);
                appendLog(context, "SUCCESS", "Code: " + responseCode);

            } catch (Exception e) {
                Log.e(TAG, "Failed to forward SMS", e);
                appendLog(context, "ERROR", e.getMessage());
            }
        });
    }

    private void appendLog(Context context, String status, String detail) {
        SharedPreferences prefs = context.getSharedPreferences("PayForgePrefs", Context.MODE_PRIVATE);
        String old = prefs.getString("APP_LOGS", "");
        String newLog = "[" + new java.util.Date().toString() + "]\nStatus: " + status + "\nDetail: " + detail + "\n\n" + old;
        if (newLog.length() > 5000) newLog = newLog.substring(0, 5000);
        prefs.edit().putString("APP_LOGS", newLog).apply();
    }

    private String escapeJson(String s) {
        return s.replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
    }
}
