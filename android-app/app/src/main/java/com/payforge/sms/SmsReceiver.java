package com.payforge.sms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.provider.Telephony;
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
        if (Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(action)) {
            final PendingResult pendingResult = goAsync();
            executor.execute(() -> {
                try {
                    SharedPreferences prefs = context.getSharedPreferences("PayForgePrefs", Context.MODE_PRIVATE);
                    String enterpriseId = prefs.getString("ENTERPRISE_ID", "");
                    String webhookSecret = prefs.getString("WEBHOOK_SECRET", "");

                    // If not configured, ignore SMS
                    if (enterpriseId.isEmpty() || webhookSecret.isEmpty()) return;

                    SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
                    if (messages != null && messages.length > 0) {
                        StringBuilder fullMessage = new StringBuilder();
                        String sender = messages[0].getDisplayOriginatingAddress();
                        
                        for (SmsMessage msg : messages) {
                            if (msg != null) {
                                fullMessage.append(msg.getDisplayMessageBody());
                            }
                        }

                        String messageBody = fullMessage.toString();
                        Log.d(TAG, "SMS Received from: " + sender);
                        appendLog(context, "FETCHED", context.getString(R.string.log_fetched, sender));
                        
                        // Forward synchronously within this background thread
                        forwardSmsSync(context, enterpriseId, webhookSecret, sender, messageBody);
                    }
                } finally {
                    pendingResult.finish();
                }
            });
        }
    }

    private void forwardSmsSync(Context context, String enterpriseId, String secret, String sender, String message) {
        try {
            URL url = new URL(WEBHOOK_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty("x-sms-webhook-secret", secret);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
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
            if (responseCode >= 200 && responseCode < 300) {
                appendLog(context, "SUCCESS", context.getString(R.string.log_success, sender, responseCode));
            } else {
                appendLog(context, "FAILED", context.getString(R.string.log_failed_code, sender, responseCode));
            }

        } catch (Exception e) {
            Log.e(TAG, "Failed to forward SMS", e);
            appendLog(context, "FAILED", context.getString(R.string.log_failed_error, sender, e.getMessage()));
        }
    }

    private void appendLog(Context context, String status, String detail) {
        SharedPreferences prefs = context.getSharedPreferences("PayForgePrefs", Context.MODE_PRIVATE);
        String old = prefs.getString("APP_LOGS", "");
        String newLog = "[" + new java.util.Date().toString() + "]\nStatus: " + status + "\nDetail: " + detail + "\n\n" + old;
        if (newLog.length() > 5000) newLog = newLog.substring(0, 5000);
        prefs.edit().putString("APP_LOGS", newLog).apply();
    }

    private String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}
