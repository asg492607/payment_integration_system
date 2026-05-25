package com.payforge.sms;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {

    private EditText editEnterpriseId, editSecret;
    private TextView statusText;
    private SharedPreferences prefs;

    private static final int SMS_PERMISSION_CODE = 100;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        editEnterpriseId = findViewById(R.id.editEnterpriseId);
        editSecret = findViewById(R.id.editSecret);
        Button btnSave = findViewById(R.id.btnSave);
        statusText = findViewById(R.id.statusText);

        prefs = getSharedPreferences("PayForgePrefs", MODE_PRIVATE);

        // Load existing
        editEnterpriseId.setText(prefs.getString("ENTERPRISE_ID", ""));
        editSecret.setText(prefs.getString("WEBHOOK_SECRET", ""));

        updateStatus();
        checkPermission();

        btnSave.setOnClickListener(v -> {
            String eId = editEnterpriseId.getText().toString().trim();
            String secret = editSecret.getText().toString().trim();

            if (eId.isEmpty() || secret.isEmpty()) {
                Toast.makeText(this, R.string.empty_fields_msg, Toast.LENGTH_SHORT).show();
                return;
            }

            prefs.edit()
                .putString("ENTERPRISE_ID", eId)
                .putString("WEBHOOK_SECRET", secret)
                .apply();

            Toast.makeText(this, "Saved! Forwarding enabled in background.", Toast.LENGTH_SHORT).show();
            updateStatus();
            checkPermission();
        });

        Button btnRefreshLogs = findViewById(R.id.btnRefreshLogs);
        btnRefreshLogs.setOnClickListener(v -> refreshLogs());
        refreshLogs();
    }

    private void refreshLogs() {
        TextView textLogs = findViewById(R.id.textLogs);
        String logs = prefs.getString("APP_LOGS", "Waiting for SMS...");
        textLogs.setText(logs);
    }

    private void updateStatus() {
        if (!prefs.getString("ENTERPRISE_ID", "").isEmpty()) {
            statusText.setText(R.string.status_active);
            statusText.setTextColor(0xFF009900); // Green
        } else {
            statusText.setText(R.string.status_not_configured);
            statusText.setTextColor(0xFFFF0000); // Red
        }
    }

    private void checkPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS}, SMS_PERMISSION_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == SMS_PERMISSION_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, R.string.sms_permission_granted, Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(this, R.string.sms_permission_denied, Toast.LENGTH_LONG).show();
                statusText.setText(R.string.status_permission_denied);
                statusText.setTextColor(0xFFFF0000);
            }
        }
    }
}
