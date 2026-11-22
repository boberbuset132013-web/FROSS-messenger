package com.fross.messenger

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.pnv.FirebasePhoneNumberVerification
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private val auth by lazy { FirebaseAuth.getInstance() }
    private val db by lazy { FirebaseFirestore.getInstance() }
    private var requestListener: ListenerRegistration? = null
    private var renewingSession = false
    private val idTokenListener = FirebaseAuth.IdTokenListener { firebaseAuth ->
        val signedIn = firebaseAuth.currentUser
        if (signedIn != null && !renewingSession) {
            CoroutineScope(Dispatchers.Main).launch {
                try {
                    val claims = signedIn.getIdTokenResult(false).await().claims
                    if (claims["frossDeviceId"] != deviceId && !renewingSession) {
                        renewingSession = true
                        try { establishExistingDevice() } finally { renewingSession = false }
                    }
                } catch (_: Exception) { }
            }
        }
    }
    private lateinit var content: LinearLayout
    private lateinit var status: TextView
    private val deviceId by lazy { DevicePrefs.deviceId(this) }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        val signedIn = auth.currentUser
        if (signedIn == null) {
            showLogin()
        } else {
            base("FROSS", "Подготовка защищённого устройства…")
            renewingSession = true
            auth.addIdTokenListener(idTokenListener)
            CoroutineScope(Dispatchers.Main).launch {
                try {
                    val claims = signedIn.getIdTokenResult(true).await().claims
                    if (claims["frossDeviceId"] == deviceId) openSignedIn() else establishExistingDevice()
                } catch (error: Exception) {
                    showLogin(error.message ?: "Войдите в аккаунт FROSS.")
                } finally {
                    renewingSession = false
                }
            }
        }
        if (signedIn == null) auth.addIdTokenListener(idTokenListener)
    }

    override fun onDestroy() {
        requestListener?.remove()
        auth.removeIdTokenListener(idTokenListener)
        super.onDestroy()
    }

    private fun base(title: String, subtitle: String) {
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 28, 24, 24)
            setBackgroundColor(0xFF101116.toInt())
        }
        val scroll = ScrollView(this).apply { addView(content) }
        setContentView(scroll)
        content.addView(TextView(this).apply {
            text = title
            textSize = 28f
            setTextColor(0xFFF3F1FF.toInt())
            typeface = Typeface.DEFAULT_BOLD
        })
        content.addView(TextView(this).apply {
            text = subtitle
            textSize = 14f
            setTextColor(0xFFAAA7B8.toInt())
            setPadding(0, 6, 0, 20)
        })
        status = TextView(this).apply {
            textSize = 14f
            setTextColor(0xFFFFB86B.toInt())
            setPadding(0, 10, 0, 12)
        }
        content.addView(status)
    }

    private fun label(value: String) {
        content.addView(TextView(this).apply {
            text = value
            textSize = 14f
            setTextColor(0xFFE4E1F2.toInt())
            setPadding(0, 14, 0, 4)
        })
    }

    private fun input(hint: String, password: Boolean = false): EditText {
        return EditText(this).also {
            it.hint = hint
            it.setSingleLine(true)
            it.setTextColor(0xFFFFFFFF.toInt())
            it.setHintTextColor(0xFF858293.toInt())
            if (password) it.inputType = 129
            content.addView(it, LinearLayout.LayoutParams(-1, -2))
        }
    }

    private fun button(text: String, action: () -> Unit): Button {
        return Button(this).also { b ->
            b.text = text
            b.setOnClickListener { action() }
            val p = LinearLayout.LayoutParams(-1, -2)
            p.topMargin = 10
            content.addView(b, p)
        }
    }

    private fun showLogin(message: String = "") {
        requestListener?.remove()
        base("FROSS", "Защищённое приложение и бот подтверждения входа")
        status.text = message
        label("Email или username FROSS")
        val identifier = input("name@example.com или username")
        label("Пароль")
        val password = input("Пароль", password = true)
        button("Войти") {
            val raw = identifier.text.toString().trim()
            val email = if (raw.contains("@")) raw else raw.lowercase() + "@fross-ca5d6.firebaseapp.com"
            val pass = password.text.toString()
            if (raw.isBlank() || pass.isBlank()) {
                status.text = "Введите логин и пароль."
            } else {
                status.text = "Входим в аккаунт…"
                CoroutineScope(Dispatchers.Main).launch {
                    try {
                        val result = auth.signInWithEmailAndPassword(email, pass).await()
                        val token = result.user?.getIdTokenResult(true)?.await()
                        if (result.user?.providerData?.any { it.providerId == "password" } == true &&
                            result.user?.isEmailVerified != true && token?.claims?.get("legacyAccount") != true) {
                            auth.signOut()
                            showLogin("Сначала подтвердите email по ссылке из письма.")
                            return@launch
                        }
                        renewingSession = true
                        try { establishExistingDevice() } finally { renewingSession = false }
                    } catch (error: Exception) {
                        status.text = error.message ?: "Не удалось войти."
                    }
                }
            }
        }
    }

    private suspend fun establishExistingDevice() {
        try {
            val response = FrossApi.post("createTrustedDeviceSession", JSONObject().put("deviceId", deviceId))
            val token = response.getString("customToken")
            auth.signOut()
            auth.signInWithCustomToken(token).await()
            openSignedIn()
        } catch (error: Exception) {
            status.text = error.message ?: "Устройство ещё не зарегистрировано."
            button("Подтвердить номер телефона") { verifyPhone() }
        }
    }

    private fun verifyPhone() {
        status.text = "Запрашиваем подтверждение номера у оператора…"
        renewingSession = true
        FirebasePhoneNumberVerification.getInstance().getVerifiedPhoneNumber(this)
            .addOnSuccessListener { result ->
                CoroutineScope(Dispatchers.Main).launch {
                    try {
                        val body = JSONObject()
                            .put("pnvToken", result.getToken())
                            .put("deviceId", deviceId)
                            .put("deviceName", Build.MANUFACTURER + " " + Build.MODEL)
                        val response = FrossApi.post("verifyPhoneWithPnv", body)
                        val customToken = response.getString("customToken")
                        auth.signOut()
                        auth.signInWithCustomToken(customToken).await()
                        openSignedIn()
                    } catch (error: Exception) {
                        status.text = error.message ?: "Не удалось сохранить подтверждение."
                    } finally {
                        renewingSession = false
                    }
                }
            }
            .addOnFailureListener { error ->
                renewingSession = false
                status.text = when {
                    error.message?.contains("CARRIER_NOT_SUPPORTED") == true ->
                        "Ваш мобильный оператор пока не поддерживает подтверждение без SMS."
                    else -> error.message ?: "Проверка отменена или временно недоступна."
                }
            }
    }

    private fun openSignedIn() {
        val user = auth.currentUser ?: return showLogin()
        base("FROSS Security", "Системный бот · подтверждение входа в браузере")
        status.text = "Аккаунт защищён. Запросы на вход действуют 5 минут."
        button("Обновить запросы") { listenForRequests(user.uid) }
        button("Выйти") {
            requestListener?.remove()
            auth.signOut()
            showLogin()
        }
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            CoroutineScope(Dispatchers.Main).launch {
                try {
                    FrossApi.post("registerTrustedDevicePushToken", JSONObject()
                        .put("deviceId", deviceId)
                        .put("fcmToken", token))
                } catch (_: Exception) { }
            }
        }
        listenForRequests(user.uid)
    }

    private fun listenForRequests(uid: String) {
        requestListener?.remove()
        status.text = "FROSS Security слушает новые запросы…"
        requestListener = db.collection("browserLoginRequests")
            .whereEqualTo("uid", uid)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    status.text = "Не удалось получить запросы: " + error.message
                    return@addSnapshotListener
                }
                val requests = snapshot?.documents.orEmpty()
                    .filter { it.getString("status") == "pending" }
                    .sortedByDescending { it.getTimestamp("createdAt")?.toDate()?.time ?: 0L }
                renderRequests(requests)
            }
    }

    private fun renderRequests(requests: List<com.google.firebase.firestore.DocumentSnapshot>) {
        val keep = status.text
        // Keep the header and the sign-out / refresh controls; replace only request cards.
        for (i in content.childCount - 1 downTo 0) {
            val view = content.getChildAt(i)
            if (view.tag == "request-card" || view.tag == "request-empty") content.removeViewAt(i)
        }
        if (requests.isEmpty()) {
            content.addView(TextView(this).apply {
                tag = "request-empty"
                text = "Новых запросов нет."
                setTextColor(0xFFAAA7B8.toInt())
                setPadding(0, 22, 0, 8)
            })
            return
        }
        requests.forEach { request ->
            val requestId = request.id
            val card = LinearLayout(this).apply {
                tag = "request-card"
                orientation = LinearLayout.VERTICAL
                setPadding(16, 14, 16, 14)
                setBackgroundColor(0xFF20212A.toInt())
            }
            card.addView(TextView(this).apply {
                text = "Вход в FROSS через браузер"
                textSize = 17f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(0xFFFFFFFF.toInt())
            })
            card.addView(TextView(this).apply {
                text = "Устройство: " + (request.getString("browserLabel") ?: "Браузер") +
                    "\nСрок действия: 5 минут"
                setTextColor(0xFFCBC8D7.toInt())
                setPadding(0, 6, 0, 8)
            })
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
            val approve = Button(this).apply {
                text = "Подтвердить"
                setOnClickListener { decide(requestId, true) }
            }
            val reject = Button(this).apply {
                text = "Отклонить"
                setOnClickListener { decide(requestId, false) }
            }
            actions.addView(approve, LinearLayout.LayoutParams(0, -2, 1f))
            actions.addView(reject, LinearLayout.LayoutParams(0, -2, 1f))
            card.addView(actions)
            val lp = LinearLayout.LayoutParams(-1, -2)
            lp.topMargin = 14
            content.addView(card, lp)
        }
        status.text = keep
    }

    private fun decide(requestId: String, approve: Boolean) {
        status.text = if (approve) "Подтверждаем вход…" else "Отклоняем запрос…"
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val endpoint = if (approve) "approveBrowserLogin" else "rejectBrowserLogin"
                FrossApi.post(endpoint, JSONObject().put("requestId", requestId))
                status.text = if (approve) "Вход подтверждён." else "Запрос отклонён."
            } catch (error: Exception) {
                status.text = error.message ?: "Не удалось обработать запрос."
            }
        }
    }
}
