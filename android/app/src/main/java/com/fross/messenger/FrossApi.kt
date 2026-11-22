package com.fross.messenger

import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object FrossApi {
    private const val BASE = "https://us-central1-fross-ca5d6.cloudfunctions.net/"

    suspend fun post(endpoint: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val user = FirebaseAuth.getInstance().currentUser
            ?: throw IllegalStateException("Сначала войдите в аккаунт FROSS.")
        val idToken = user.getIdToken(false).await().token
            ?: throw IllegalStateException("Не удалось получить токен Firebase.")
        val connection = (URL(BASE + endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 20000
            doOutput = true
            setRequestProperty("Authorization", "Bearer $idToken")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
        }
        try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = if (response.isBlank()) JSONObject() else JSONObject(response)
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException(json.optString("error", "Ошибка сервера: HTTP ${connection.responseCode}"))
            }
            json
        } finally {
            connection.disconnect()
        }
    }
}
