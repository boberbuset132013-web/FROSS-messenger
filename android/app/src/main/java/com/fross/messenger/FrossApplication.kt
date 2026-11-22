package com.fross.messenger

import android.app.Application
import android.util.Log
import com.google.firebase.pnv.FirebasePhoneNumberVerification

class FrossApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG && BuildConfig.FPNV_TEST_TOKEN.isNotBlank()) {
            try {
                FirebasePhoneNumberVerification.getInstance()
                    .enableTestSession(BuildConfig.FPNV_TEST_TOKEN)
            } catch (error: Exception) {
                Log.w("FROSS", "PNV test session could not be enabled", error)
            }
        }
    }
}
