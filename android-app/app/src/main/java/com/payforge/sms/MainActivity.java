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
                Toast.makeText(this, "Fields cannot be empty", Toast.LENGTH_SHORT).show();
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
    }

    private void updateStatus() {
        if (!prefs.getString("ENTERPRISE_ID", "").isEmpty()) {
            statusText.setText("Status: Active & Listening");
            statusText.setTextColor(0xFF009900); // Green
        } else {
            statusText.setText("Status: Not Configured");
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
                Toast.makeText(this, "SMS Permission Granted", Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(this, "SMS Permission Denied. App will not work.", Toast.LENGTH_LONG).show();
                statusText.setText("Status: Permission Denied");
                statusText.setTextColor(0xFFFF0000);
            }
        }
    }
}
